use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    thread,
};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[cfg(unix)]
use std::{env, fs, os::unix::fs::PermissionsExt};

use crate::{
    employees::EmployeeStatus,
    events::{
        emit_employee_updated, emit_log, emit_terminal_data, emit_terminal_session_updated,
        LogLevel,
    },
    persistence::AppSettings,
    AppState,
};

const DEFAULT_CODEX_PROGRAM: &str = "codex";
const TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE: usize = 50;
const TERMINAL_LABEL_MAX_CHARS: usize = 80;
pub(crate) const TERMINAL_OUTPUT_BUFFER_MAX_BYTES: usize = 250_000;
pub(crate) const TERMINAL_OUTPUT_TRUNCATION_MARKER: &str = "\n[... earlier output truncated ...]\n";

mod agent_runtime;
mod codex_notify;
mod codex_status;
mod control_markers;
mod evidence;
#[cfg(test)]
mod session_fixture_tests;
mod session_store;
mod turn_resolver;
pub mod uploads;

pub(crate) use self::agent_runtime::{
    agent_kind_for_command, AgentKind, AgentRuntimeConfidence, AgentRuntimeSnapshot,
    AgentRuntimeSource, AgentRuntimeState, AgentRuntimeStore,
};
pub use self::codex_status::codex_cli_status_impl;
pub(crate) use self::session_store::{
    restore_terminal_session_records, TerminalSessionRecord, TerminalSessionRuntime,
    TerminalSessionStatus, TerminalSessionStore, TerminalStopReason, TerminalTurnState,
    TerminalTurnTransitionReason,
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
    size: Mutex<PtySize>,
    output: Mutex<String>,
}

type TerminalOutputCallback = Arc<dyn Fn(&str, &str) + Send + Sync>;
type TerminalActiveProfileCallback = Arc<dyn Fn(&str, TerminalLaunchProfile) + Send + Sync>;
type TerminalCwdCallback = Arc<dyn Fn(&str, &str) + Send + Sync>;
type TerminalCodexTurnCompleteCallback = codex_notify::TurnCompleteCallback;

#[derive(Clone)]
struct TerminalReaderCallbacks {
    output: TerminalOutputCallback,
    active_profile_changed: TerminalActiveProfileCallback,
    cwd_changed: TerminalCwdCallback,
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
    pub codex_program: String,
    pub on_output: TerminalOutputCallback,
    pub on_active_profile_changed: TerminalActiveProfileCallback,
    pub on_cwd_changed: TerminalCwdCallback,
    pub on_codex_turn_complete: TerminalCodexTurnCompleteCallback,
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
    pub path: Option<String>,
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
            codex_program: DEFAULT_CODEX_PROGRAM.to_string(),
            on_output: Arc::new(|_, _| {}),
            on_active_profile_changed: Arc::new(|_, _| {}),
            on_cwd_changed: Arc::new(|_, _| {}),
            on_codex_turn_complete: Arc::new(|_, _| {}),
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
            codex_program,
            on_output,
            on_active_profile_changed,
            on_cwd_changed,
            on_codex_turn_complete,
            on_exit,
        } = request;
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(size).context("failed to open PTY")?;
        let spec = terminal_command_spec(profile, &codex_program);
        let mut command = command_builder_from_spec(&spec);
        configure_terminal_environment(&mut command);
        if let Err(error) = configure_command_for_profile(&mut command, profile, &codex_program) {
            emit_log(
                &app,
                LogLevel::Warn,
                format!("failed to configure terminal profile environment: {error}"),
            );
        }
        let notify_bridge = match codex_notify::configure_bridge(&mut command, profile, &session_id)
        {
            Ok(bridge) => bridge,
            Err(error) => {
                emit_log(
                    &app,
                    LogLevel::Warn,
                    format!("failed to configure Codex notify bridge: {error}"),
                );
                None
            }
        };
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
            size: Mutex::new(size),
            output: Mutex::new(String::new()),
        });

        self.sessions
            .lock()
            .insert(session_id.clone(), Arc::clone(&session));

        spawn_reader(
            app.clone(),
            employee_id,
            session_id.clone(),
            reader,
            Arc::clone(&session),
            TerminalReaderCallbacks {
                output: Arc::clone(&on_output),
                active_profile_changed: Arc::clone(&on_active_profile_changed),
                cwd_changed: Arc::clone(&on_cwd_changed),
            },
        );
        if let Some(notify_bridge) = notify_bridge {
            let active_sessions = Arc::clone(&self.sessions);
            let is_session_active: codex_notify::SessionActiveCallback =
                Arc::new(move |session_id| active_sessions.lock().contains_key(session_id));
            let refresh_sessions = Arc::clone(&self.sessions);
            let refresh_session: codex_notify::RefreshCallback = Arc::new(move |session_id| {
                refresh_session_after_codex_notify(&refresh_sessions, session_id)
            });
            codex_notify::spawn_watcher(
                app.clone(),
                session_id.clone(),
                notify_bridge.event_dir,
                is_session_active,
                refresh_session,
                Arc::clone(&on_codex_turn_complete),
            );
        }

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
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        session
            .master
            .lock()
            .resize(size)
            .context("failed to resize PTY")?;
        *session.size.lock() = size;
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

    pub fn output_for_session(&self, employee_id: &str, session_id: &str) -> Result<String> {
        let session = self
            .sessions
            .lock()
            .get(session_id)
            .cloned()
            .with_context(|| format!("terminal session {session_id} not found"))?;
        ensure_session_owner(&session.employee_id, employee_id)?;
        let output = session.output.lock().clone();
        Ok(output)
    }

    pub fn has_active_sessions(&self) -> bool {
        !self.sessions.lock().is_empty()
    }

    pub fn clear_inactive_sessions(&self) {
        self.sessions.lock().clear();
    }
}

pub fn codex_program_from_settings(settings: &AppSettings) -> String {
    let trimmed = settings.codex_binary_path.trim();
    if trimmed.is_empty() {
        DEFAULT_CODEX_PROGRAM.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn terminal_command_spec(
    profile: TerminalLaunchProfile,
    codex_program: &str,
) -> TerminalCommandSpec {
    match profile {
        TerminalLaunchProfile::Shell => TerminalCommandSpec {
            program: default_shell(),
            args: Vec::new(),
            command_label: "shell",
        },
        TerminalLaunchProfile::Codex => TerminalCommandSpec {
            program: codex_program.to_string(),
            args: vec![
                "--no-alt-screen".to_string(),
                "--dangerously-bypass-approvals-and-sandbox".to_string(),
            ],
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

fn configure_terminal_environment(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn configure_command_for_profile(
    command: &mut CommandBuilder,
    profile: TerminalLaunchProfile,
    codex_program: &str,
) -> Result<()> {
    if profile == TerminalLaunchProfile::Shell {
        configure_shell_codex_detection(command, codex_program)?;
        configure_shell_cwd_detection(command)?;
    }
    Ok(())
}

#[cfg(unix)]
fn configure_shell_codex_detection(
    command: &mut CommandBuilder,
    codex_program: &str,
) -> Result<()> {
    let wrapper_dir = env::temp_dir().join(format!("slavey-codex-wrapper-{}", std::process::id()));
    fs::create_dir_all(&wrapper_dir)
        .with_context(|| format!("failed to create {}", wrapper_dir.display()))?;
    let wrapper_path = wrapper_dir.join("codex");
    fs::write(&wrapper_path, codex_wrapper_script())
        .with_context(|| format!("failed to write {}", wrapper_path.display()))?;
    fs::set_permissions(&wrapper_path, fs::Permissions::from_mode(0o755))
        .with_context(|| format!("failed to make {} executable", wrapper_path.display()))?;

    let existing_path = command.get_env("PATH").map(|path| path.to_os_string());
    let mut next_path = wrapper_dir.as_os_str().to_os_string();
    if let Some(existing_path) = existing_path {
        if !existing_path.as_os_str().is_empty() {
            next_path.push(":");
            next_path.push(existing_path);
        }
    }

    command.env("PATH", next_path);
    command.env("SLAVEY_CODEX_WRAPPER_DIR", wrapper_dir.as_os_str());
    if codex_program != DEFAULT_CODEX_PROGRAM {
        command.env("SLAVEY_CODEX_PATH", codex_program);
    }
    Ok(())
}

#[cfg(not(unix))]
fn configure_shell_codex_detection(
    _command: &mut CommandBuilder,
    _codex_program: &str,
) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn configure_shell_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let shell = default_shell();
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    match shell_name {
        "bash" => configure_bash_cwd_detection(command),
        "zsh" => configure_zsh_cwd_detection(command),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
fn configure_shell_cwd_detection(_command: &mut CommandBuilder) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn configure_bash_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let integration_dir =
        env::temp_dir().join(format!("slavey-shell-integration-{}", std::process::id()));
    fs::create_dir_all(&integration_dir)
        .with_context(|| format!("failed to create {}", integration_dir.display()))?;
    let rc_path = integration_dir.join("bashrc");
    fs::write(&rc_path, bash_cwd_integration_script())
        .with_context(|| format!("failed to write {}", rc_path.display()))?;
    command.arg("--rcfile");
    command.arg(rc_path.as_os_str());
    command.arg("-i");
    Ok(())
}

#[cfg(unix)]
fn configure_zsh_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let integration_dir =
        env::temp_dir().join(format!("slavey-zsh-integration-{}", std::process::id()));
    fs::create_dir_all(&integration_dir)
        .with_context(|| format!("failed to create {}", integration_dir.display()))?;
    let rc_path = integration_dir.join(".zshrc");
    fs::write(&rc_path, zsh_cwd_integration_script())
        .with_context(|| format!("failed to write {}", rc_path.display()))?;
    command.env("ZDOTDIR", integration_dir.as_os_str());
    command.arg("-i");
    Ok(())
}

#[cfg(unix)]
fn bash_cwd_integration_script() -> String {
    let source_line = home_dir()
        .map(|home| home.join(".bashrc"))
        .map(source_shell_file_line)
        .unwrap_or_default();
    format!(
        r#"{source_line}
_slavey_report_cwd() {{ printf '\033]777;slavey-cwd=%s\007' "$PWD"; }}
if [ -n "${{PROMPT_COMMAND:-}}" ]; then
  PROMPT_COMMAND="_slavey_report_cwd; $PROMPT_COMMAND"
else
  PROMPT_COMMAND="_slavey_report_cwd"
fi
_slavey_report_cwd
"#
    )
}

#[cfg(unix)]
fn zsh_cwd_integration_script() -> String {
    let source_line = home_dir()
        .map(|home| home.join(".zshrc"))
        .map(source_shell_file_line)
        .unwrap_or_default();
    format!(
        r#"{source_line}
_slavey_report_cwd() {{ printf '\033]777;slavey-cwd=%s\007' "$PWD"; }}
precmd_functions=(${{precmd_functions[@]}} _slavey_report_cwd)
_slavey_report_cwd
"#
    )
}

#[cfg(unix)]
fn source_shell_file_line(path: PathBuf) -> String {
    let path = shell_single_quote(&path.to_string_lossy());
    format!("if [ -r {path} ]; then . {path}; fi")
}

#[cfg(unix)]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

#[cfg(unix)]
fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

#[cfg(unix)]
fn codex_wrapper_script() -> &'static str {
    r#"#!/bin/sh
wrapper_dir=${SLAVEY_CODEX_WRAPPER_DIR:-}
configured_codex=${SLAVEY_CODEX_PATH:-}
notify_config=${SLAVEY_CODEX_NOTIFY_CONFIG:-}
printf '\033]777;slavey-codex=start\007'

real_codex=
if [ -n "$configured_codex" ]; then
  if [ -x "$configured_codex" ]; then
    real_codex=$configured_codex
  else
    printf 'Slavey codex wrapper: configured codex executable not found: %s\n' "$configured_codex" >&2
    printf '\033]777;slavey-codex=end\007'
    exit 127
  fi
fi

if [ -z "$real_codex" ]; then
  old_ifs=$IFS
  IFS=:
  for path_dir in $PATH; do
    if [ -z "$path_dir" ]; then
      path_dir=.
    fi
    if [ -n "$wrapper_dir" ] && [ "$path_dir" = "$wrapper_dir" ]; then
      continue
    fi
    candidate=$path_dir/codex
    if [ -x "$candidate" ]; then
      real_codex=$candidate
      break
    fi
  done
  IFS=$old_ifs
fi

if [ -z "$real_codex" ]; then
  printf 'Slavey codex wrapper: real codex executable not found\n' >&2
  printf '\033]777;slavey-codex=end\007'
  exit 127
fi

has_no_alt_screen=false
for arg in "$@"; do
  if [ "$arg" = "--no-alt-screen" ]; then
    has_no_alt_screen=true
    break
  fi
done
if [ "$has_no_alt_screen" = false ]; then
  set -- --no-alt-screen "$@"
fi
if [ -n "$notify_config" ]; then
  set -- --config "$notify_config" "$@"
fi

"$real_codex" "$@"
status=$?
printf '\033]777;slavey-codex=end\007'
exit "$status"
"#
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
    session: Arc<TerminalSession>,
    callbacks: TerminalReaderCallbacks,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut control_buffer = String::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let parsed =
                        control_markers::parse_terminal_control_markers(&data, &mut control_buffer);
                    for active_profile in parsed.active_profile_changes {
                        (callbacks.active_profile_changed)(&session_id, active_profile);
                    }
                    for cwd in parsed.cwd_changes {
                        (callbacks.cwd_changed)(&session_id, &cwd);
                    }
                    if !parsed.visible.is_empty() {
                        append_terminal_output(&session, &parsed.visible);
                        (callbacks.output)(&session_id, &parsed.visible);
                        emit_terminal_data(
                            &app,
                            employee_id.clone(),
                            session_id.clone(),
                            parsed.visible,
                        );
                    }
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
        if !control_buffer.is_empty() {
            append_terminal_output(&session, &control_buffer);
            (callbacks.output)(&session_id, &control_buffer);
            emit_terminal_data(&app, employee_id, session_id, control_buffer);
        }
    });
}

#[cfg(unix)]
fn refresh_session_after_codex_notify(
    sessions: &Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    session_id: &str,
) -> Result<()> {
    let Some(session) = sessions.lock().get(session_id).cloned() else {
        return Ok(());
    };
    let size = *session.size.lock();
    session
        .master
        .lock()
        .resize(size)
        .context("failed to refresh PTY after Codex notify")?;
    Ok(())
}

fn append_terminal_output(session: &TerminalSession, data: &str) {
    let mut output = session.output.lock();
    output.push_str(data);
    if output.len() <= TERMINAL_OUTPUT_BUFFER_MAX_BYTES {
        return;
    }

    let tail_limit = TERMINAL_OUTPUT_BUFFER_MAX_BYTES
        .saturating_sub(TERMINAL_OUTPUT_TRUNCATION_MARKER.len())
        .max(1);
    let mut split_at = output.len().saturating_sub(tail_limit);
    while split_at < output.len() && !output.is_char_boundary(split_at) {
        split_at += 1;
    }
    let tail = output[split_at..].to_string();
    *output = format!("{TERMINAL_OUTPUT_TRUNCATION_MARKER}{tail}");
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
pub fn codex_cli_status(state: State<'_, AppState>) -> CodexCliStatus {
    let codex_program = codex_program_from_settings(&state.persistence.settings());
    codex_cli_status_impl(&codex_program)
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
pub fn terminal_session_output(
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
) -> Result<String, String> {
    let existing = state
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))?;
    ensure_session_owner(&existing.employee_id, &employee_id).map_err(|error| error.to_string())?;
    if existing.status != TerminalSessionStatus::Running {
        return Ok(String::new());
    }
    if existing.runtime == TerminalSessionRuntime::CodexAppServer {
        return Ok(state.codex_app_server.output_for_session(&session_id));
    }
    state
        .terminal
        .output_for_session(&employee_id, &session_id)
        .or_else(|error| {
            let message = error.to_string();
            if message.contains("not found") {
                Ok(String::new())
            } else {
                Err(error)
            }
        })
        .map_err(|error| error.to_string())
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
        if existing.runtime == TerminalSessionRuntime::CodexAppServer {
            state.codex_app_server.stop_session(&session_id);
        } else {
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
    }

    let record = state
        .terminal_sessions
        .stop(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))?;
    state.agent_runtime.sync_from_terminal_session(&record);

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
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    session_id: String,
    input: String,
) -> Result<(), String> {
    state
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))
        .and_then(|session| {
            if session.runtime == TerminalSessionRuntime::CodexAppServer {
                Err("use codex_task_submit for Codex app-server sessions".to_string())
            } else {
                Ok(())
            }
        })?;
    state
        .terminal
        .write_to_session(&employee_id, &session_id, &input)
        .map_err(|error| error.to_string())?;
    if let Some(record) = state.terminal_sessions.record_input(&session_id, &input) {
        state.agent_runtime.sync_from_terminal_session(&record);
        emit_terminal_session_updated(&app, record);
    }
    Ok(())
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
        .terminal_sessions
        .get(&session_id)
        .ok_or_else(|| format!("terminal session {session_id} not found"))
        .and_then(|session| {
            if session.runtime == TerminalSessionRuntime::CodexAppServer {
                Err("Codex app-server sessions do not support PTY resize".to_string())
            } else {
                Ok(())
            }
        })?;
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
        let spec = terminal_command_spec(TerminalLaunchProfile::Shell, "codex");

        assert!(!spec.program.is_empty());
        assert!(spec.args.is_empty());
        assert_eq!(spec.command_label, "shell");
    }

    #[test]
    fn codex_profile_uses_no_alt_screen_with_approval_and_sandbox_bypass() {
        let spec = terminal_command_spec(TerminalLaunchProfile::Codex, "codex");

        assert_eq!(spec.program, "codex");
        assert_eq!(
            spec.args,
            vec![
                "--no-alt-screen",
                "--dangerously-bypass-approvals-and-sandbox",
            ],
        );
        assert_eq!(spec.command_label, "codex");
    }

    #[test]
    fn codex_profile_uses_configured_codex_program() {
        let spec = terminal_command_spec(
            TerminalLaunchProfile::Codex,
            "/Users/ada/.nvm/versions/node/v22/bin/codex",
        );

        assert_eq!(spec.program, "/Users/ada/.nvm/versions/node/v22/bin/codex");
        assert_eq!(spec.command_label, "codex");
    }

    #[cfg(unix)]
    #[test]
    fn shell_codex_wrapper_injects_notify_config_override() {
        let script = super::codex_wrapper_script();

        assert!(script.contains("SLAVEY_CODEX_NOTIFY_CONFIG"));
        assert!(script.contains("set -- --config \"$notify_config\" \"$@\""));
    }
}
