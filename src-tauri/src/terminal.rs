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
    employees::EmployeeStatus,
    events::{
        emit_employee_updated, emit_log, emit_terminal_data, emit_terminal_session_updated,
        LogLevel,
    },
    processes::{configure_process_group, terminate_process_tree},
    AppState,
};

const CODEX_STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const CODEX_STATUS_STDOUT_CAP: usize = 8 * 1024;
const CODEX_STATUS_STDERR_CAP: usize = 8 * 1024;
const COMMAND_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(100);
const TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE: usize = 50;
const TERMINAL_LABEL_MAX_CHARS: usize = 80;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStopReason {
    UserStopped,
    Exited,
    FailedToStart,
    AppRestarted,
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
    pub stopped_at: Option<u64>,
    #[serde(default)]
    pub stop_reason: Option<TerminalStopReason>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub last_output_at: Option<u64>,
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

    fn display_label(self) -> &'static str {
        match self {
            TerminalLaunchProfile::Shell => "Shell",
            TerminalLaunchProfile::Codex => "Codex",
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
            stopped_at: None,
            stop_reason: None,
            label: format!("{} session", profile.display_label()),
            last_output_at: None,
            message: None,
        };
        let mut records = self.records.lock();
        records.insert(record.session_id.clone(), record.clone());
        prune_employee_history(&mut records, &record.employee_id);
        record
    }

    pub fn list(&self, employee_id: Option<&str>) -> Vec<TerminalSessionRecord> {
        let mut records = self
            .records
            .lock()
            .values()
            .filter(|record| {
                employee_id
                    .map(|employee_id| record.employee_id == employee_id)
                    .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>();
        records.sort_by_key(|record| record.started_at);
        records
    }

    pub fn get(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        self.records.lock().get(session_id).cloned()
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
            let record = normalize_session_record(record);
            next.insert(record.session_id.clone(), record);
        }
        let employee_ids = next
            .values()
            .map(|record| record.employee_id.clone())
            .collect::<Vec<_>>();
        for employee_id in employee_ids {
            prune_employee_history(&mut next, &employee_id);
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
            Some(TerminalStopReason::FailedToStart),
            Some(message),
        )
    }

    pub fn stop(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return Some(record.clone());
        }
        set_terminal_stopped(
            record,
            TerminalSessionStatus::Stopped,
            None,
            Some(TerminalStopReason::UserStopped),
            Some("stopped by user".to_string()),
        );
        Some(record.clone())
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
        let now = crate::events::now_ms();
        record.ended_at = Some(now);
        record.stopped_at = Some(now);
        record.stop_reason = Some(TerminalStopReason::Exited);
        record.message = None;
        Some(record.clone())
    }

    pub fn touch_output(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        record.last_output_at = Some(crate::events::now_ms());
        Some(record.clone())
    }

    pub fn rename(&self, session_id: &str, label: &str) -> Result<TerminalSessionRecord, String> {
        let label = cleaned_session_label(label)?;
        let mut records = self.records.lock();
        let record = records
            .get_mut(session_id)
            .ok_or_else(|| format!("terminal session {session_id} not found"))?;
        record.label = label;
        Ok(record.clone())
    }

    fn update_terminal_status(
        &self,
        session_id: &str,
        status: TerminalSessionStatus,
        exit_code: Option<i32>,
        stop_reason: Option<TerminalStopReason>,
        message: Option<impl Into<String>>,
    ) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        set_terminal_stopped(
            record,
            status,
            exit_code,
            stop_reason,
            message.map(Into::into),
        );
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
                let now = crate::events::now_ms();
                record.ended_at = Some(now);
                record.stopped_at = Some(now);
                record.stop_reason = Some(TerminalStopReason::AppRestarted);
                record.message =
                    Some("app restarted before terminal session completed".to_string());
            }
            normalize_session_record(record)
        })
        .collect()
}

fn normalize_session_record(mut record: TerminalSessionRecord) -> TerminalSessionRecord {
    if record.label.trim().is_empty() {
        record.label = format!("{} session", record.profile.display_label());
    }
    if record.stopped_at.is_none() {
        record.stopped_at = record.ended_at;
    }
    record
}

fn set_terminal_stopped(
    record: &mut TerminalSessionRecord,
    status: TerminalSessionStatus,
    exit_code: Option<i32>,
    stop_reason: Option<TerminalStopReason>,
    message: Option<String>,
) {
    let now = crate::events::now_ms();
    record.status = status;
    record.exit_code = exit_code;
    record.ended_at = Some(now);
    record.stopped_at = Some(now);
    record.stop_reason = stop_reason;
    record.message = message;
}

fn prune_employee_history(records: &mut HashMap<String, TerminalSessionRecord>, employee_id: &str) {
    let mut employee_records = records
        .values()
        .filter(|record| record.employee_id == employee_id)
        .map(|record| {
            (
                record.session_id.clone(),
                record.started_at,
                record.status == TerminalSessionStatus::Running,
            )
        })
        .collect::<Vec<_>>();
    if employee_records.len() <= TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE {
        return;
    }

    employee_records.sort_by_key(|record| std::cmp::Reverse(record.1));
    for (session_id, _started_at, running) in employee_records
        .into_iter()
        .skip(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE)
    {
        if !running {
            records.remove(&session_id);
        }
    }
}

fn cleaned_session_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("terminal session label is required".to_string());
    }
    Ok(label.chars().take(TERMINAL_LABEL_MAX_CHARS).collect())
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
    use std::{
        path::PathBuf,
        process::Command as ProcessCommand,
        time::{Duration, Instant},
    };

    use super::{
        append_capped_bytes, codex_status_from_output, ensure_session_owner,
        restore_terminal_session_records, run_bounded_command, terminal_command_spec,
        BoundedCommandOutput, TerminalLaunchProfile, TerminalSessionRecord, TerminalSessionStatus,
        TerminalSessionStore, TerminalStopReason, TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE,
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
        assert_eq!(finished.stop_reason, Some(TerminalStopReason::Exited));
        assert!(finished.ended_at.is_some());
        assert!(finished.stopped_at.is_some());
    }

    #[test]
    fn terminal_session_store_lists_gets_and_filters_records() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.create(
            "term-2".to_string(),
            "employee-2".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let employee_records = store.list(Some("employee-1"));

        assert_eq!(employee_records.len(), 1);
        assert_eq!(employee_records[0].session_id, "term-1");
        assert_eq!(store.get("term-2").unwrap().employee_id, "employee-2");
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
        assert_eq!(stopped.stop_reason, Some(TerminalStopReason::UserStopped));
        assert!(finish_result.is_none());
        assert_eq!(store.list(None)[0].status, TerminalSessionStatus::Stopped);
    }

    #[test]
    fn stopping_already_stopped_session_is_safe() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        let first_stop = store.stop("term-1").unwrap();
        let second_stop = store.stop("term-1").unwrap();

        assert_eq!(second_stop.status, TerminalSessionStatus::Stopped);
        assert_eq!(second_stop.stop_reason, first_stop.stop_reason);
        assert_eq!(second_stop.stopped_at, first_stop.stopped_at);
    }

    #[test]
    fn terminal_session_rename_trims_and_rejects_empty_labels() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );

        let renamed = store.rename("term-1", "  Build watcher  ").unwrap();

        assert_eq!(renamed.label, "Build watcher");
        assert!(store.rename("term-1", "   ").is_err());
    }

    #[test]
    fn terminal_session_history_is_capped_per_employee() {
        let store = TerminalSessionStore::default();
        let records = (0..(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE + 5))
            .map(|index| sample_session_record("employee-1", index as u64))
            .collect::<Vec<_>>();

        store.replace_all(records);

        let records = store.list(Some("employee-1"));
        assert_eq!(records.len(), TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE);
        assert_eq!(records[0].started_at, 5);
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
            stopped_at: None,
            stop_reason: None,
            label: String::new(),
            last_output_at: None,
            message: None,
        }]);

        assert_eq!(restored[0].status, TerminalSessionStatus::Stopped);
        assert_eq!(
            restored[0].stop_reason,
            Some(TerminalStopReason::AppRestarted)
        );
        assert_eq!(restored[0].label, "Codex session");
        assert_eq!(
            restored[0].message.as_deref(),
            Some("app restarted before terminal session completed")
        );
        assert!(restored[0].ended_at.is_some());
        assert!(restored[0].stopped_at.is_some());
    }

    fn sample_session_record(employee_id: &str, started_at: u64) -> TerminalSessionRecord {
        TerminalSessionRecord {
            session_id: format!("term-{started_at}"),
            employee_id: employee_id.to_string(),
            profile: TerminalLaunchProfile::Shell,
            cwd: "/tmp".to_string(),
            status: TerminalSessionStatus::Stopped,
            exit_code: None,
            started_at,
            ended_at: Some(started_at + 1),
            stopped_at: Some(started_at + 1),
            stop_reason: Some(TerminalStopReason::UserStopped),
            label: "Shell session".to_string(),
            last_output_at: None,
            message: None,
        }
    }
}
