use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    process::{Command as ProcessCommand, Stdio},
    sync::Arc,
    thread,
};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    events::{emit_log, emit_terminal_data, LogLevel},
    AppState,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
        self.create_profile_session(
            app,
            employee_id,
            session_id,
            cwd,
            size,
            TerminalLaunchProfile::Shell,
            on_exit,
        )
    }

    pub fn create_profile_session<F>(
        &self,
        app: AppHandle,
        employee_id: String,
        session_id: String,
        cwd: PathBuf,
        size: PtySize,
        profile: TerminalLaunchProfile,
        on_exit: F,
    ) -> Result<()>
    where
        F: FnOnce(u32) + Send + 'static,
    {
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

        spawn_reader(app.clone(), employee_id, session_id.clone(), reader);

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

    pub fn kill_session(&self, session_id: &str) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .remove(session_id)
            .with_context(|| format!("terminal session {session_id} not found"))?;
        session
            .killer
            .lock()
            .kill()
            .context("failed to kill PTY process")?;
        Ok(())
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
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
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

pub fn codex_cli_status_impl() -> CodexCliStatus {
    match ProcessCommand::new("codex")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) if output.status.success() => {
            let version =
                first_output_line(&output.stdout).or_else(|| first_output_line(&output.stderr));
            CodexCliStatus {
                available: true,
                version: version.clone(),
                message: version.unwrap_or_else(|| "Codex CLI is available".to_string()),
            }
        }
        Ok(output) => {
            let message = first_output_line(&output.stderr)
                .or_else(|| first_output_line(&output.stdout))
                .unwrap_or_else(|| "Codex CLI did not report a version".to_string());
            CodexCliStatus {
                available: false,
                version: None,
                message,
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI not found on PATH".to_string(),
        },
        Err(error) => CodexCliStatus {
            available: false,
            version: None,
            message: format!("failed to check Codex CLI: {error}"),
        },
    }
}

fn first_output_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

#[tauri::command]
pub fn codex_cli_status() -> CodexCliStatus {
    codex_cli_status_impl()
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
