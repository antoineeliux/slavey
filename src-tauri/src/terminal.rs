use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command as ProcessCommand, Stdio},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    events::{emit_log, emit_terminal_data, LogLevel},
    processes::{configure_process_group, terminate_process_tree},
    AppState,
};

const CODEX_STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const CODEX_STATUS_STDOUT_CAP: usize = 8 * 1024;
const CODEX_STATUS_STDERR_CAP: usize = 8 * 1024;
const COMMAND_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(100);

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalLaunchProfile {
    Shell,
    Codex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRecord {
    pub session_id: String,
    pub employee_id: String,
    pub profile: TerminalLaunchProfile,
    pub cwd: String,
    pub status: TerminalSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub message: Option<String>,
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

#[derive(Clone, Default)]
pub struct TerminalSessionStore {
    records: Arc<Mutex<HashMap<String, TerminalSessionRecord>>>,
}

impl TerminalLaunchProfile {
    pub fn current_command(self) -> &'static str {
        match self {
            TerminalLaunchProfile::Shell => "shell",
            TerminalLaunchProfile::Codex => "codex",
        }
    }
}

impl TerminalSessionStore {
    pub fn create(
        &self,
        session_id: String,
        employee_id: String,
        profile: TerminalLaunchProfile,
        cwd: String,
    ) -> TerminalSessionRecord {
        let now = crate::events::now_ms();
        let record = TerminalSessionRecord {
            session_id,
            employee_id,
            profile,
            cwd,
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: now,
            ended_at: None,
            message: None,
        };
        self.records
            .lock()
            .insert(record.session_id.clone(), record.clone());
        record
    }

    pub fn list(&self) -> Vec<TerminalSessionRecord> {
        let mut records = self.records.lock().values().cloned().collect::<Vec<_>>();
        records.sort_by_key(|record| record.started_at);
        records
    }

    pub fn has_running(&self) -> bool {
        self.records
            .lock()
            .values()
            .any(|record| record.status == TerminalSessionStatus::Running)
    }

    pub fn replace_all(&self, records: Vec<TerminalSessionRecord>) {
        let mut next = HashMap::new();
        for record in records {
            next.insert(record.session_id.clone(), record);
        }
        *self.records.lock() = next;
    }

    pub fn fail_start(
        &self,
        session_id: &str,
        message: impl Into<String>,
    ) -> Option<TerminalSessionRecord> {
        self.update_terminal_status(
            session_id,
            TerminalSessionStatus::Failed,
            None,
            Some(message),
        )
    }

    pub fn stop(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        self.update_terminal_status(
            session_id,
            TerminalSessionStatus::Stopped,
            None,
            Some("stopped by user"),
        )
    }

    pub fn finish(&self, session_id: &str, exit_code: i32) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return None;
        }
        record.status = if exit_code == 0 {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Failed
        };
        record.exit_code = Some(exit_code);
        record.ended_at = Some(crate::events::now_ms());
        record.message = None;
        Some(record.clone())
    }

    fn update_terminal_status(
        &self,
        session_id: &str,
        status: TerminalSessionStatus,
        exit_code: Option<i32>,
        message: Option<impl Into<String>>,
    ) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        record.status = status;
        record.exit_code = exit_code;
        record.ended_at = Some(crate::events::now_ms());
        record.message = message.map(Into::into);
        Some(record.clone())
    }
}

pub fn restore_terminal_session_records(
    records: &[TerminalSessionRecord],
) -> Vec<TerminalSessionRecord> {
    records
        .iter()
        .cloned()
        .map(|mut record| {
            if record.status == TerminalSessionStatus::Running {
                record.status = TerminalSessionStatus::Stopped;
                record.exit_code = None;
                record.ended_at = Some(crate::events::now_ms());
                record.message =
                    Some("app restarted before terminal session completed".to_string());
            }
            record
        })
        .collect()
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
    let mut command = ProcessCommand::new("codex");
    command.arg("--version");
    command.env("CI", "true");
    command.env("NO_COLOR", "1");
    command.env("TERM", "dumb");

    match run_bounded_command(
        command,
        CODEX_STATUS_TIMEOUT,
        CODEX_STATUS_STDOUT_CAP,
        CODEX_STATUS_STDERR_CAP,
    ) {
        Ok(output) => codex_status_from_output(output),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI not found".to_string(),
        },
        Err(error) => CodexCliStatus {
            available: false,
            version: None,
            message: codex_status_error_message(error.kind()),
        },
    }
}

#[derive(Debug, Clone)]
struct BoundedCommandOutput {
    status_code: Option<i32>,
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandOutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
struct CommandOutputChunk {
    stream: CommandOutputStream,
    bytes: Vec<u8>,
}

fn run_bounded_command(
    mut command: ProcessCommand,
    timeout: Duration,
    stdout_cap: usize,
    stderr_cap: usize,
) -> std::io::Result<BoundedCommandOutput> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);

    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("failed to capture stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("failed to capture stderr"))?;
    let (sender, receiver) = mpsc::channel();
    spawn_command_output_reader(stdout, CommandOutputStream::Stdout, sender.clone());
    spawn_command_output_reader(stderr, CommandOutputStream::Stderr, sender);

    let deadline = Instant::now() + timeout;
    let mut output = BoundedCommandOutput {
        status_code: None,
        success: false,
        stdout: Vec::new(),
        stderr: Vec::new(),
        timed_out: false,
        stdout_truncated: false,
        stderr_truncated: false,
    };

    loop {
        drain_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
        if let Some(status) = child.try_wait()? {
            output.status_code = status.code();
            output.success = status.success();
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        if output.stdout_truncated || output.stderr_truncated {
            terminate_status_child(&mut child);
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        let now = Instant::now();
        if now >= deadline {
            output.timed_out = true;
            terminate_status_child(&mut child);
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        let remaining = deadline.saturating_duration_since(now);
        let wait = remaining.min(Duration::from_millis(20));
        match receiver.recv_timeout(wait) {
            Ok(chunk) => append_command_output(&mut output, chunk, stdout_cap, stderr_cap),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
    }
}

fn spawn_command_output_reader<R>(
    mut reader: R,
    stream: CommandOutputStream,
    sender: mpsc::Sender<CommandOutputChunk>,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if sender
                        .send(CommandOutputChunk {
                            stream,
                            bytes: buffer[..read].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_command_output(
    receiver: &mpsc::Receiver<CommandOutputChunk>,
    output: &mut BoundedCommandOutput,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    while let Ok(chunk) = receiver.try_recv() {
        append_command_output(output, chunk, stdout_cap, stderr_cap);
    }
}

fn drain_remaining_command_output(
    receiver: &mpsc::Receiver<CommandOutputChunk>,
    output: &mut BoundedCommandOutput,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    let deadline = Instant::now() + COMMAND_OUTPUT_DRAIN_TIMEOUT;
    loop {
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(chunk) => append_command_output(output, chunk, stdout_cap, stderr_cap),
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn append_command_output(
    output: &mut BoundedCommandOutput,
    chunk: CommandOutputChunk,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    match chunk.stream {
        CommandOutputStream::Stdout => {
            append_capped_bytes(
                &mut output.stdout,
                &chunk.bytes,
                stdout_cap,
                &mut output.stdout_truncated,
            );
        }
        CommandOutputStream::Stderr => {
            append_capped_bytes(
                &mut output.stderr,
                &chunk.bytes,
                stderr_cap,
                &mut output.stderr_truncated,
            );
        }
    }
}

fn append_capped_bytes(target: &mut Vec<u8>, bytes: &[u8], cap: usize, truncated: &mut bool) {
    if *truncated {
        return;
    }
    let remaining = cap.saturating_sub(target.len());
    if bytes.len() > remaining {
        target.extend_from_slice(&bytes[..remaining]);
        *truncated = true;
    } else {
        target.extend_from_slice(bytes);
    }
}

fn terminate_status_child(child: &mut Child) {
    terminate_process_tree(child);
}

fn codex_status_from_output(output: BoundedCommandOutput) -> CodexCliStatus {
    if output.timed_out {
        return CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI version check timed out".to_string(),
        };
    }

    if output.stdout_truncated || output.stderr_truncated {
        return CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI version check produced too much output".to_string(),
        };
    }

    if output.success {
        let version =
            first_output_line(&output.stdout).or_else(|| first_output_line(&output.stderr));
        CodexCliStatus {
            available: true,
            version: version.clone(),
            message: version.unwrap_or_else(|| "Codex CLI is available".to_string()),
        }
    } else {
        CodexCliStatus {
            available: false,
            version: None,
            message: match output.status_code {
                Some(code) => format!("Codex CLI version check failed with exit code {code}"),
                None => "Codex CLI version check failed".to_string(),
            },
        }
    }
}

fn codex_status_error_message(kind: std::io::ErrorKind) -> String {
    match kind {
        std::io::ErrorKind::PermissionDenied => {
            "Codex CLI could not be executed due to permissions".to_string()
        }
        _ => "failed to check Codex CLI".to_string(),
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
pub fn terminal_session_list(state: State<'_, AppState>) -> Vec<TerminalSessionRecord> {
    state.terminal_sessions.list()
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
    use std::{
        path::PathBuf,
        process::Command as ProcessCommand,
        time::{Duration, Instant},
    };

    use super::{
        append_capped_bytes, codex_status_from_output, ensure_session_owner,
        restore_terminal_session_records, run_bounded_command, terminal_command_spec,
        BoundedCommandOutput, TerminalLaunchProfile, TerminalSessionRecord, TerminalSessionStatus,
        TerminalSessionStore,
    };

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

    #[test]
    fn codex_status_parses_successful_version_from_stdout() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: Some(0),
            success: true,
            stdout: b"codex 1.2.3\n".to_vec(),
            stderr: Vec::new(),
            timed_out: false,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(status.available);
        assert_eq!(status.version.as_deref(), Some("codex 1.2.3"));
    }

    #[test]
    fn codex_status_hides_failure_output() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: Some(2),
            success: false,
            stdout: Vec::new(),
            stderr: b"auth config path should not be surfaced\n".to_vec(),
            timed_out: false,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(!status.available);
        assert_eq!(
            status.message,
            "Codex CLI version check failed with exit code 2"
        );
    }

    #[test]
    fn codex_status_reports_timeout() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: None,
            success: false,
            stdout: Vec::new(),
            stderr: Vec::new(),
            timed_out: true,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(!status.available);
        assert_eq!(status.message, "Codex CLI version check timed out");
    }

    #[test]
    fn capped_output_helper_truncates_without_growing_past_cap() {
        let mut target = b"abcd".to_vec();
        let mut truncated = false;

        append_capped_bytes(&mut target, b"efgh", 6, &mut truncated);

        assert_eq!(target, b"abcdef");
        assert!(truncated);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_command_times_out() {
        let mut command = ProcessCommand::new("/bin/sh");
        command.args(["-c", "sleep 2"]);
        let start = Instant::now();

        let output = run_bounded_command(command, Duration::from_millis(50), 1024, 1024).unwrap();

        assert!(output.timed_out);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn terminal_session_store_creates_and_finishes_record() {
        let store = TerminalSessionStore::default();
        let record = store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            PathBuf::from("/tmp").to_string_lossy().to_string(),
        );

        assert_eq!(record.status, TerminalSessionStatus::Running);

        let finished = store.finish("term-1", 0).unwrap();

        assert_eq!(finished.status, TerminalSessionStatus::Exited);
        assert_eq!(finished.exit_code, Some(0));
        assert!(finished.ended_at.is_some());
    }

    #[test]
    fn stopped_terminal_session_is_not_overwritten_by_wait_exit() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let stopped = store.stop("term-1").unwrap();
        let finish_result = store.finish("term-1", 1);

        assert_eq!(stopped.status, TerminalSessionStatus::Stopped);
        assert!(finish_result.is_none());
        assert_eq!(store.list()[0].status, TerminalSessionStatus::Stopped);
    }

    #[test]
    fn restore_running_terminal_session_as_stopped_with_restart_message() {
        let restored = restore_terminal_session_records(&[TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            cwd: "/tmp".to_string(),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            message: None,
        }]);

        assert_eq!(restored[0].status, TerminalSessionStatus::Stopped);
        assert_eq!(
            restored[0].message.as_deref(),
            Some("app restarted before terminal session completed")
        );
        assert!(restored[0].ended_at.is_some());
    }
}
