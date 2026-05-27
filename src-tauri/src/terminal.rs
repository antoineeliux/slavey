use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Arc,
    thread,
};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    employees::EmployeeStatus,
    events::{
        emit_employee_updated, emit_log, emit_terminal_data, emit_terminal_session_updated,
        LogLevel,
    },
    AppState,
};

const TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE: usize = 50;
const TERMINAL_LABEL_MAX_CHARS: usize = 80;

mod codex_status;
mod session_store;

pub use self::codex_status::codex_cli_status_impl;
pub(crate) use self::session_store::{
    restore_terminal_session_records, TerminalSessionRecord, TerminalSessionStatus,
    TerminalSessionStore, TerminalStopReason,
};

pub const DEFAULT_PTY_SIZE: PtySize = PtySize {
    rows: 30,
    cols: 100,
    pixel_width: 0,
    pixel_height: 0,
};

struct TerminalSession {
    employee_id: String,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send>>,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
}

pub struct TerminalProfileSessionRequest<F> {
    pub app: AppHandle,
    pub employee_id: String,
    pub session_id: String,
    pub cwd: PathBuf,
    pub size: PtySize,
    pub profile: TerminalLaunchProfile,
    pub on_output: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_exit: F,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalLaunchProfile {
    Shell,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalCommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub command_label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliStatus {
    pub available: bool,
    pub version: Option<String>,
    pub message: String,
}

impl TerminalLaunchProfile {
    pub fn current_command(self) -> &'static str {
        match self {
            TerminalLaunchProfile::Shell => "shell",
            TerminalLaunchProfile::Codex => "codex",
        }
    }

    fn display_label(self) -> &'static str {
        match self {
            TerminalLaunchProfile::Shell => "Shell",
            TerminalLaunchProfile::Codex => "Codex",
        }
    }
}

impl TerminalManager {
    pub fn create_shell_session<F>(
        &self,
        app: AppHandle,
        employee_id: String,
        session_id: String,
        cwd: PathBuf,
        size: PtySize,
        on_exit: F,
    ) -> Result<()>
    where
        F: FnOnce(u32) + Send + 'static,
    {
        self.create_profile_session(TerminalProfileSessionRequest {
            app,
            employee_id,
            session_id,
            cwd,
            size,
            profile: TerminalLaunchProfile::Shell,
            on_output: Arc::new(|_| {}),
            on_exit,
        })
    }

    pub fn create_profile_session<F>(&self, request: TerminalProfileSessionRequest<F>) -> Result<()>
    where
        F: FnOnce(u32) + Send + 'static,
    {
        let TerminalProfileSessionRequest {
            app,
            employee_id,
            session_id,
            cwd,
            size,
            profile,
            on_output,
            on_exit,
        } = request;
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(size).context("failed to open PTY")?;
        let spec = terminal_command_spec(profile);
        let mut command = command_builder_from_spec(&spec);
        command.cwd(cwd);

        let mut child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("failed to spawn {} terminal", spec.command_label))?;
        let killer = child.clone_killer();
        let reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("failed to create PTY writer")?;

        let session = Arc::new(TerminalSession {
            employee_id: employee_id.clone(),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(killer),
        });

        self.sessions
            .lock()
            .insert(session_id.clone(), Arc::clone(&session));

        spawn_reader(
            app.clone(),
            employee_id,
            session_id.clone(),
            reader,
            Arc::clone(&on_output),
        );

        let sessions = Arc::clone(&self.sessions);
        thread::spawn(move || {
            let exit_code = match child.wait() {
                Ok(status) => status.exit_code(),
                Err(error) => {
                    emit_log(
                        &app,
                        LogLevel::Error,
                        format!("terminal session {session_id} wait failed: {error}"),
                    );
                    1
                }
            };
            sessions.lock().remove(&session_id);
            on_exit(exit_code);
        });

        Ok(())
    }

    pub fn write_to_session(&self, employee_id: &str, session_id: &str, input: &str) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .with_context(|| format!("terminal session {session_id} not found"))?;
        ensure_session_owner(&session.employee_id, employee_id)?;
        let mut writer = session.writer.lock();
        writer
            .write_all(input.as_bytes())
            .context("failed to write to PTY")?;
        writer.flush().context("failed to flush PTY input")?;
        Ok(())
    }

    pub fn resize_session(
        &self,
        employee_id: &str,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .with_context(|| format!("terminal session {session_id} not found"))?;
        ensure_session_owner(&session.employee_id, employee_id)?;
        session
            .master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to resize PTY")?;
        Ok(())
    }

    pub fn kill_session_for_employee(&self, employee_id: &str, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get(session_id)
            .cloned()
            .with_context(|| format!("terminal session {session_id} not found"))?;
        ensure_session_owner(&session.employee_id, employee_id)?;
        sessions.remove(session_id);
        drop(sessions);
        session
            .killer
            .lock()
            .kill()
            .context("failed to kill PTY process")?;
        Ok(())
    }

    pub fn has_active_sessions(&self) -> bool {
        !self.sessions.lock().is_empty()
    }

    pub fn clear_inactive_sessions(&self) {
        self.sessions.lock().clear();
    }
}

pub fn terminal_command_spec(profile: TerminalLaunchProfile) -> TerminalCommandSpec {
    match profile {
        TerminalLaunchProfile::Shell => TerminalCommandSpec {
            program: default_shell(),
            args: Vec::new(),
            command_label: "shell",
        },
        TerminalLaunchProfile::Codex => TerminalCommandSpec {
            program: "codex".to_string(),
            args: vec!["--no-alt-screen".to_string()],
            command_label: "codex",
        },
    }
}

fn command_builder_from_spec(spec: &TerminalCommandSpec) -> CommandBuilder {
    let mut command = CommandBuilder::new(&spec.program);
    for arg in &spec.args {
        command.arg(arg.as_str());
    }
    command
}

fn ensure_session_owner(session_employee_id: &str, requested_employee_id: &str) -> Result<()> {
    if session_employee_id == requested_employee_id {
        Ok(())
    } else {
        anyhow::bail!("terminal session does not belong to employee {requested_employee_id}")
    }
}

fn spawn_reader(
    app: AppHandle,
    employee_id: String,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    on_output: Arc<dyn Fn(&str) + Send + Sync>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    on_output(&session_id);
                    emit_terminal_data(&app, employee_id.clone(), session_id.clone(), data);
                }
                Err(error) => {
                    emit_log(
                        &app,
                        LogLevel::Warn,
                        format!("terminal session {session_id} read failed: {error}"),
                    );
                    break;
                }
            }
        }
    });
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[tauri::command]
pub fn codex_cli_status() -> CodexCliStatus {
    codex_cli_status_impl()
}

#[tauri::command]
pub fn terminal_session_list(
    state: State<'_, AppState>,
    employee_id: Option<String>,
) -> Vec<TerminalSessionRecord> {
    state.terminal_sessions.list(employee_id.as_deref())
}

#[tauri::command]
pub fn terminal_session_get(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<TerminalSessionRecord, String> {
    state
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))
}

#[tauri::command]
pub fn terminal_session_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
) -> Result<TerminalSessionRecord, String> {
    let existing = state
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))?;
    ensure_session_owner(&existing.employee_id, &employee_id).map_err(|error| error.to_string())?;

    if existing.status == TerminalSessionStatus::Running {
        if let Err(error) = state
            .terminal
            .kill_session_for_employee(&employee_id, &session_id)
        {
            let message = error.to_string();
            if message.contains("does not belong") {
                return Err(message);
            }
            emit_log(
                &app,
                LogLevel::Warn,
                format!("failed to kill terminal session {session_id}: {message}"),
            );
        }
    }

    let record = state
        .terminal_sessions
        .stop(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))?;

    if state
        .employees
        .get(&employee_id)
        .and_then(|employee| employee.terminal_session_id)
        .as_deref()
        == Some(session_id.as_str())
    {
        if let Some(employee) = state.employees.update(&employee_id, |employee| {
            employee.status = EmployeeStatus::Stopped;
            employee.current_command = None;
            employee.terminal_session_id = None;
        }) {
            emit_employee_updated(&app, employee);
        }
    }

    emit_terminal_session_updated(&app, record.clone());
    if let Err(error) = state.persist() {
        emit_log(
            &app,
            LogLevel::Warn,
            format!("failed to persist terminal session stop: {error}"),
        );
    }
    Ok(record)
}

#[tauri::command]
pub fn terminal_session_rename(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
    label: String,
) -> Result<TerminalSessionRecord, String> {
    let existing = state
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))?;
    ensure_session_owner(&existing.employee_id, &employee_id).map_err(|error| error.to_string())?;
    let record = state.terminal_sessions.rename(&session_id, &label)?;
    emit_terminal_session_updated(&app, record.clone());
    if let Err(error) = state.persist() {
        emit_log(
            &app,
            LogLevel::Warn,
            format!("failed to persist terminal session rename: {error}"),
        );
    }
    Ok(record)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
    input: String,
) -> Result<(), String> {
    state
        .terminal
        .write_to_session(&employee_id, &session_id, &input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .terminal
        .resize_session(&employee_id, &session_id, cols, rows)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{ensure_session_owner, terminal_command_spec, TerminalLaunchProfile};

    #[test]
    fn accepts_matching_terminal_owner() {
        assert!(ensure_session_owner("employee-1", "employee-1").is_ok());
    }

    #[test]
    fn rejects_mismatched_terminal_owner() {
        assert!(ensure_session_owner("employee-1", "employee-2").is_err());
    }

    #[test]
    fn shell_profile_uses_default_shell_without_extra_args() {
        let spec = terminal_command_spec(TerminalLaunchProfile::Shell);

        assert!(!spec.program.is_empty());
        assert!(spec.args.is_empty());
        assert_eq!(spec.command_label, "shell");
    }

    #[test]
    fn codex_profile_uses_no_alt_screen() {
        let spec = terminal_command_spec(TerminalLaunchProfile::Codex);

        assert_eq!(spec.program, "codex");
        assert_eq!(spec.args, vec!["--no-alt-screen"]);
        assert_eq!(spec.command_label, "codex");
    }
}
