use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    employees::{resolve_employee_execution_dir, EmployeeStatus},
    events::{
        emit_employee_activity_updated, emit_employee_updated, emit_log, emit_terminal_data,
        emit_terminal_session_updated, LogLevel,
    },
    terminal::{
        codex_program_from_settings, AgentRuntimeStore, TerminalLaunchProfile,
        TerminalSessionRecord, TerminalSessionRuntime, TerminalSessionStatus, TerminalSessionStore,
    },
    AppState,
};

const APP_SERVER_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const APP_SERVER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const APP_SERVER_INITIALIZE_ID: u64 = 1;
const MAX_PROBE_MESSAGES: usize = 16;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppServerStatus {
    pub available: bool,
    pub user_agent: Option<String>,
    pub codex_home: Option<String>,
    pub platform_family: Option<String>,
    pub platform_os: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTaskSubmitRequest {
    pub employee_id: String,
    pub session_id: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CodexAppServerMessage {
    Response {
        id: String,
        result: Value,
    },
    Error {
        id: String,
        code: i64,
        message: String,
    },
    Notification {
        method: String,
        params: Value,
    },
    Request {
        id: String,
        method: String,
        params: Value,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum CodexAppServerEvent {
    Notification { method: String, params: Value },
    Request { method: String, params: Value },
}

type SessionEventHandler = Arc<dyn Fn(CodexAppServerEvent) + Send + Sync>;
type PendingResponseSender = SyncSender<Result<Value, String>>;
type PendingResponses = Arc<Mutex<HashMap<String, PendingResponseSender>>>;
type ThreadSessionMap = Arc<Mutex<HashMap<String, String>>>;
type SessionHandlerMap = Arc<Mutex<HashMap<String, SessionEventHandler>>>;

#[derive(Clone, Default)]
pub struct CodexAppServerManager {
    inner: Arc<CodexAppServerInner>,
}

#[derive(Default)]
struct CodexAppServerInner {
    process: Mutex<Option<CodexAppServerProcess>>,
    pending: PendingResponses,
    session_threads: ThreadSessionMap,
    thread_sessions: ThreadSessionMap,
    session_turns: ThreadSessionMap,
    session_handlers: SessionHandlerMap,
    transcripts: Arc<Mutex<HashMap<String, String>>>,
    next_request_id: AtomicU64,
}

struct CodexAppServerProcess {
    codex_program: String,
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
}

impl Drop for CodexAppServerProcess {
    fn drop(&mut self) {
        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct CodexTurnRequest {
    codex_program: String,
    session_id: String,
    cwd: String,
    workspace_root: String,
    prompt: String,
    handler: SessionEventHandler,
}

#[tauri::command]
pub fn codex_app_server_status(state: State<'_, AppState>) -> CodexAppServerStatus {
    let codex_program = codex_program_from_settings(&state.persistence.settings());
    codex_app_server_status_impl(&codex_program)
}

#[tauri::command]
pub fn codex_task_submit(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CodexTaskSubmitRequest,
) -> Result<TerminalSessionRecord, String> {
    codex_task_submit_impl(app, &state, payload)
}

pub fn codex_app_server_status_impl(codex_program: &str) -> CodexAppServerStatus {
    match probe_codex_app_server(codex_program) {
        Ok(result) => status_from_initialize_result(result),
        Err(error) => CodexAppServerStatus {
            available: false,
            user_agent: None,
            codex_home: None,
            platform_family: None,
            platform_os: None,
            message: app_server_probe_error_message(&error),
        },
    }
}

fn codex_task_submit_impl(
    app: AppHandle,
    state: &AppState,
    payload: CodexTaskSubmitRequest,
) -> Result<TerminalSessionRecord, String> {
    let prompt = payload.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Codex prompt cannot be empty".to_string());
    }

    let employee = state
        .employees
        .get(&payload.employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let workspace_root = state.workspace_root();
    let codex_program = codex_program_from_settings(&state.persistence.settings());
    let cwd = resolve_employee_execution_dir(&workspace_root, &employee, None)?;
    let cwd_label = cwd.to_string_lossy().to_string();
    let session_id = payload
        .session_id
        .clone()
        .or_else(|| employee.terminal_session_id.clone())
        .unwrap_or_else(|| format!("codex-app-{}", Uuid::new_v4()));

    let existing_session = state.terminal_sessions.get(&session_id);
    if let Some(existing_session) = existing_session.as_ref() {
        if existing_session.employee_id != payload.employee_id {
            return Err("session does not belong to employee".to_string());
        }
        if existing_session.runtime != TerminalSessionRuntime::CodexAppServer {
            return Err("active session is not managed by Codex app-server".to_string());
        }
        if existing_session.status != TerminalSessionStatus::Running {
            return Err("Codex app-server session is not running".to_string());
        }
    } else if employee.terminal_session_id.is_some() {
        return Err("employee already has an active non-Codex app-server session".to_string());
    }

    let session_record = existing_session.unwrap_or_else(|| {
        state.terminal_sessions.create_with_runtime(
            session_id.clone(),
            payload.employee_id.clone(),
            TerminalLaunchProfile::Codex,
            cwd_label.clone(),
            TerminalSessionRuntime::CodexAppServer,
        )
    });

    let updated_employee = state
        .employees
        .update(&payload.employee_id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session_id.clone());
        })
        .ok_or_else(|| "employee not found".to_string())?;
    emit_employee_updated(&app, updated_employee);

    let prompt_record = state
        .terminal_sessions
        .record_input(&session_id, "\r")
        .unwrap_or_else(|| session_record.clone());
    state
        .agent_runtime
        .sync_from_terminal_session(&prompt_record);
    emit_terminal_session_updated(&app, prompt_record.clone());
    append_app_server_transcript(
        &state.codex_app_server,
        &app,
        &payload.employee_id,
        &session_id,
        format!("\r\n› {prompt}\r\n"),
    );

    let handler = codex_session_event_handler(
        app.clone(),
        payload.employee_id.clone(),
        session_id.clone(),
        state.terminal_sessions.clone(),
        state.agent_runtime.clone(),
        state.codex_app_server.clone(),
    );
    if let Err(error) = state.codex_app_server.submit_turn(CodexTurnRequest {
        codex_program,
        session_id: session_id.clone(),
        cwd: cwd_label,
        workspace_root: workspace_root.to_string_lossy().to_string(),
        prompt,
        handler,
    }) {
        if let Some(record) = state
            .terminal_sessions
            .fail_start(&session_id, format!("Codex app-server failed: {error}"))
        {
            state.agent_runtime.sync_from_terminal_session(&record);
            emit_terminal_session_updated(&app, record);
        }
        if let Some(employee) = state.employees.update(&payload.employee_id, |employee| {
            employee.status = EmployeeStatus::Failed;
            employee.current_command = None;
            employee.terminal_session_id = None;
        }) {
            emit_employee_updated(&app, employee);
        }
        if let Err(persist_error) = state.persist() {
            emit_log(
                &app,
                LogLevel::Warn,
                format!("failed to persist Codex app-server failure: {persist_error}"),
            );
        }
        return Err(error.to_string());
    }

    if let Err(error) = state.persist() {
        emit_log(
            &app,
            LogLevel::Warn,
            format!("failed to persist Codex app-server session: {error}"),
        );
    }

    Ok(prompt_record)
}

impl CodexAppServerManager {
    fn submit_turn(&self, request: CodexTurnRequest) -> Result<()> {
        self.ensure_started(&request.codex_program)?;
        let thread_id = match self
            .inner
            .session_threads
            .lock()
            .get(&request.session_id)
            .cloned()
        {
            Some(thread_id) => thread_id,
            None => self.start_thread(&request)?,
        };

        self.inner
            .session_handlers
            .lock()
            .insert(request.session_id.clone(), request.handler);
        let result = self.send_request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{
                    "type": "text",
                    "text": request.prompt,
                    "text_elements": [],
                }],
                "cwd": request.cwd,
                "runtimeWorkspaceRoots": [request.workspace_root],
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "sandboxPolicy": { "type": "dangerFullAccess" },
            }),
            APP_SERVER_REQUEST_TIMEOUT,
        )?;
        if let Some(turn_id) = result.pointer("/turn/id").and_then(Value::as_str) {
            self.inner
                .session_turns
                .lock()
                .insert(request.session_id, turn_id.to_string());
        }
        Ok(())
    }

    fn start_thread(&self, request: &CodexTurnRequest) -> Result<String> {
        let result = self.send_request(
            "thread/start",
            json!({
                "cwd": request.cwd,
                "runtimeWorkspaceRoots": [request.workspace_root],
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "sandbox": "danger-full-access",
                "threadSource": "user",
                "sessionStartSource": "startup",
            }),
            APP_SERVER_REQUEST_TIMEOUT,
        )?;
        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("codex app-server thread/start response did not include thread.id")?
            .to_string();
        self.inner
            .session_threads
            .lock()
            .insert(request.session_id.clone(), thread_id.clone());
        self.inner
            .thread_sessions
            .lock()
            .insert(thread_id.clone(), request.session_id.clone());
        self.inner
            .session_handlers
            .lock()
            .insert(request.session_id.clone(), Arc::clone(&request.handler));
        Ok(thread_id)
    }

    pub fn stop_session(&self, session_id: &str) {
        let thread_id = self.inner.session_threads.lock().remove(session_id);
        if let Some(thread_id) = thread_id {
            self.inner.thread_sessions.lock().remove(&thread_id);
            let turn_id = self.inner.session_turns.lock().remove(session_id);
            if let Some(turn_id) = turn_id {
                let _ = self.send_request(
                    "turn/interrupt",
                    json!({ "threadId": thread_id, "turnId": turn_id }),
                    Duration::from_secs(2),
                );
            }
        }
        self.inner.session_handlers.lock().remove(session_id);
    }

    pub fn append_transcript(&self, session_id: &str, data: &str) {
        let mut transcripts = self.inner.transcripts.lock();
        let transcript = transcripts.entry(session_id.to_string()).or_default();
        transcript.push_str(data);
        if transcript.len() > crate::terminal::TERMINAL_OUTPUT_BUFFER_MAX_BYTES {
            let keep_from = transcript
                .char_indices()
                .rev()
                .take(crate::terminal::TERMINAL_OUTPUT_BUFFER_MAX_BYTES)
                .last()
                .map(|(index, _)| index)
                .unwrap_or(0);
            transcript.replace_range(..keep_from, "");
            transcript.insert_str(0, crate::terminal::TERMINAL_OUTPUT_TRUNCATION_MARKER);
        }
    }

    pub fn output_for_session(&self, session_id: &str) -> String {
        self.inner
            .transcripts
            .lock()
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    fn ensure_started(&self, codex_program: &str) -> Result<()> {
        {
            let process = self.inner.process.lock();
            if process
                .as_ref()
                .is_some_and(|process| process.codex_program == codex_program)
            {
                return Ok(());
            }
        }

        if self.inner.process.lock().take().is_some() {
            self.inner.session_threads.lock().clear();
            self.inner.thread_sessions.lock().clear();
            self.inner.session_turns.lock().clear();
            self.inner.session_handlers.lock().clear();
        }

        let mut child = Command::new(codex_program)
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("failed to spawn codex app-server")?;
        let stdin = child
            .stdin
            .take()
            .context("failed to open codex app-server stdin")?;
        let stdout = child
            .stdout
            .take()
            .context("failed to open codex app-server stdout")?;
        let stdin = Arc::new(Mutex::new(stdin));
        let child = Arc::new(Mutex::new(child));

        *self.inner.process.lock() = Some(CodexAppServerProcess {
            codex_program: codex_program.to_string(),
            stdin: Arc::clone(&stdin),
            child,
        });

        spawn_app_server_reader(
            stdout,
            Arc::clone(&stdin),
            Arc::clone(&self.inner.pending),
            Arc::clone(&self.inner.thread_sessions),
            Arc::clone(&self.inner.session_handlers),
        );

        let initialize_result = self.send_request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "slavey",
                    "title": "Slavey",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false,
                    "optOutNotificationMethods": [],
                },
            }),
            APP_SERVER_REQUEST_TIMEOUT,
        );
        if initialize_result.is_err() {
            self.inner.process.lock().take();
        }
        let _ = initialize_result?;
        Ok(())
    }

    fn send_request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        let id = self
            .inner
            .next_request_id
            .fetch_add(1, Ordering::SeqCst)
            .to_string();
        let (sender, receiver) = mpsc::sync_channel(1);
        self.inner.pending.lock().insert(id.clone(), sender);
        let request = json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let write_result = self.write_json_line(&request);
        if let Err(error) = write_result {
            self.inner.pending.lock().remove(&id);
            return Err(error);
        }

        match receiver.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => anyhow::bail!(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.inner.pending.lock().remove(&id);
                anyhow::bail!("codex app-server request {method} timed out")
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.inner.pending.lock().remove(&id);
                anyhow::bail!("codex app-server response channel closed")
            }
        }
    }

    fn write_json_line(&self, value: &Value) -> Result<()> {
        let process = self.inner.process.lock();
        let process = process
            .as_ref()
            .context("codex app-server process is not running")?;
        let mut stdin = process.stdin.lock();
        writeln!(stdin, "{value}").context("failed to write codex app-server request")?;
        stdin
            .flush()
            .context("failed to flush codex app-server request")
    }
}

fn spawn_app_server_reader(
    stdout: impl std::io::Read + Send + 'static,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: PendingResponses,
    thread_sessions: ThreadSessionMap,
    session_handlers: SessionHandlerMap,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    fail_pending_requests(&pending, "codex app-server closed stdout");
                    break;
                }
                Ok(_) => match parse_json_rpc_line(&line) {
                    Ok(message) => handle_app_server_message(
                        message,
                        &stdin,
                        &pending,
                        &thread_sessions,
                        &session_handlers,
                    ),
                    Err(error) => {
                        fail_pending_requests(
                            &pending,
                            &format!("failed to parse codex app-server message: {error}"),
                        );
                    }
                },
                Err(error) => {
                    fail_pending_requests(
                        &pending,
                        &format!("failed to read codex app-server stdout: {error}"),
                    );
                    break;
                }
            }
        }
    });
}

fn handle_app_server_message(
    message: CodexAppServerMessage,
    stdin: &Arc<Mutex<ChildStdin>>,
    pending: &PendingResponses,
    thread_sessions: &ThreadSessionMap,
    session_handlers: &SessionHandlerMap,
) {
    match message {
        CodexAppServerMessage::Response { id, result } => {
            if let Some(sender) = pending.lock().remove(&id) {
                let _ = sender.send(Ok(result));
            }
        }
        CodexAppServerMessage::Error { id, message, .. } => {
            if let Some(sender) = pending.lock().remove(&id) {
                let _ = sender.send(Err(message));
            }
        }
        CodexAppServerMessage::Notification { method, params } => {
            notify_session_handler(
                thread_id_for_params(&params).as_deref(),
                thread_sessions,
                session_handlers,
                CodexAppServerEvent::Notification { method, params },
            );
        }
        CodexAppServerMessage::Request { id, method, params } => {
            notify_session_handler(
                thread_id_for_params(&params).as_deref(),
                thread_sessions,
                session_handlers,
                CodexAppServerEvent::Request {
                    method: method.clone(),
                    params: params.clone(),
                },
            );
            let response = json!({
                "id": id,
                "result": default_server_request_response(&method),
            });
            let _ = writeln!(stdin.lock(), "{response}");
        }
    }
}

fn notify_session_handler(
    thread_id: Option<&str>,
    thread_sessions: &ThreadSessionMap,
    session_handlers: &SessionHandlerMap,
    event: CodexAppServerEvent,
) {
    let Some(thread_id) = thread_id else {
        return;
    };
    let session_id = thread_sessions.lock().get(thread_id).cloned();
    let handler =
        session_id.and_then(|session_id| session_handlers.lock().get(&session_id).cloned());
    if let Some(handler) = handler {
        handler(event);
    }
}

fn fail_pending_requests(pending: &PendingResponses, message: &str) {
    let senders = pending
        .lock()
        .drain()
        .map(|(_, sender)| sender)
        .collect::<Vec<_>>();
    for sender in senders {
        let _ = sender.send(Err(message.to_string()));
    }
}

fn thread_id_for_params(params: &Value) -> Option<String> {
    params
        .pointer("/threadId")
        .or_else(|| params.pointer("/thread/id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn default_server_request_response(method: &str) -> Value {
    match method {
        "item/commandExecution/requestApproval" => json!({ "decision": "decline" }),
        "item/fileChange/requestApproval" => json!({ "decision": "decline" }),
        "item/tool/requestUserInput" => json!({ "answers": {} }),
        "applyPatchApproval" | "execCommandApproval" => json!({ "decision": "denied" }),
        "item/permissions/requestApproval" => {
            json!({ "permissions": {}, "scope": "turn", "strictAutoReview": true })
        }
        _ => Value::Null,
    }
}

fn codex_session_event_handler(
    app: AppHandle,
    employee_id: String,
    session_id: String,
    terminal_sessions: TerminalSessionStore,
    agent_runtime: AgentRuntimeStore,
    app_server: CodexAppServerManager,
) -> SessionEventHandler {
    Arc::new(move |event| {
        let (method, params) = match event {
            CodexAppServerEvent::Notification { method, params } => (method, params),
            CodexAppServerEvent::Request { method, params } => (method, params),
        };
        let mut emitted_terminal_update = false;
        if let Some(snapshot) =
            agent_runtime.record_codex_app_server_notification(&session_id, &method, &params)
        {
            if method == "turn/completed"
                && snapshot.state == crate::terminal::AgentRuntimeState::WaitingPrompt
            {
                append_app_server_transcript(
                    &app_server,
                    &app,
                    &employee_id,
                    &session_id,
                    "\r\n[Codex] Waiting for next instruction.\r\n› ".to_string(),
                );
            }
            if let Some(record) =
                terminal_sessions.record_app_server_runtime_state(&session_id, snapshot.state)
            {
                emit_terminal_session_updated(&app, record);
                emitted_terminal_update = true;
            }
        }
        if let Some(data) = transcript_delta_for_app_server_event(&method, &params) {
            append_app_server_transcript(&app_server, &app, &employee_id, &session_id, data);
        }
        if method == "error" {
            let should_mark_failed = terminal_sessions
                .get(&session_id)
                .map(|record| record.status == TerminalSessionStatus::Running)
                .unwrap_or(false);
            if should_mark_failed {
                if let Some(record) =
                    terminal_sessions.fail_start(&session_id, "Codex app-server error")
                {
                    agent_runtime.sync_from_terminal_session(&record);
                    emit_terminal_session_updated(&app, record);
                    emitted_terminal_update = true;
                }
            }
        }
        if !emitted_terminal_update {
            emit_employee_activity_updated(&app, Some(employee_id.clone()));
        }
    })
}

fn transcript_delta_for_app_server_event(method: &str, params: &Value) -> Option<String> {
    match method {
        "turn/started" => Some("\r\n[Codex] Working...\r\n".to_string()),
        "item/agentMessage/delta"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/outputDelta"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/textDelta" => params
            .get("delta")
            .and_then(Value::as_str)
            .map(str::to_string),
        "item/started" => {
            let item = params.get("item")?;
            let item_type = item.get("type").and_then(Value::as_str)?;
            match item_type {
                "commandExecution" => item
                    .get("command")
                    .and_then(Value::as_str)
                    .map(|command| format!("\r\n$ {command}\r\n")),
                "fileChange" => Some("\r\n[Codex] Applying file changes...\r\n".to_string()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn append_app_server_transcript(
    app_server: &CodexAppServerManager,
    app: &AppHandle,
    employee_id: &str,
    session_id: &str,
    data: String,
) {
    app_server.append_transcript(session_id, &data);
    emit_terminal_data(app, employee_id.to_string(), session_id.to_string(), data);
}

fn probe_codex_app_server(codex_program: &str) -> Result<Value> {
    let mut child = Command::new(codex_program)
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn codex app-server")?;

    let mut stdin = child
        .stdin
        .take()
        .context("failed to open codex app-server stdin")?;
    let stdout = child
        .stdout
        .take()
        .context("failed to open codex app-server stdout")?;

    let (line_tx, line_rx) = mpsc::channel::<Result<String, String>>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = line_tx.send(Err("codex app-server closed stdout".to_string()));
                    break;
                }
                Ok(_) => {
                    if line_tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = line_tx.send(Err(format!(
                        "failed to read codex app-server stdout: {error}"
                    )));
                    break;
                }
            }
        }
    });

    let initialize = json!({
        "id": APP_SERVER_INITIALIZE_ID,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "slavey",
                "title": "Slavey",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "capabilities": {
                "experimentalApi": true,
                "requestAttestation": false,
                "optOutNotificationMethods": [],
            },
        },
    });
    writeln!(stdin, "{initialize}").context("failed to write codex app-server initialize")?;
    drop(stdin);

    let result = wait_for_initialize_response(line_rx);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn wait_for_initialize_response(line_rx: Receiver<Result<String, String>>) -> Result<Value> {
    let deadline = Instant::now() + APP_SERVER_PROBE_TIMEOUT;
    let mut observed = 0usize;
    loop {
        if observed >= MAX_PROBE_MESSAGES {
            anyhow::bail!("codex app-server did not return initialize response");
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            anyhow::bail!("codex app-server initialize timed out");
        };
        let line = match line_rx.recv_timeout(remaining) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => anyhow::bail!(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                anyhow::bail!("codex app-server initialize timed out")
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                anyhow::bail!("codex app-server stdout reader stopped")
            }
        };
        observed += 1;
        let message = parse_json_rpc_line(&line)?;
        match message {
            CodexAppServerMessage::Response { id, result }
                if id == APP_SERVER_INITIALIZE_ID.to_string() =>
            {
                return Ok(result);
            }
            CodexAppServerMessage::Error { id, message, .. }
                if id == APP_SERVER_INITIALIZE_ID.to_string() =>
            {
                anyhow::bail!("codex app-server initialize failed: {message}");
            }
            _ => {}
        }
    }
}

pub fn parse_json_rpc_line(line: &str) -> Result<CodexAppServerMessage> {
    let value = serde_json::from_str::<Value>(line.trim()).context("invalid JSON-RPC message")?;
    parse_json_rpc_message(value)
}

fn parse_json_rpc_message(value: Value) -> Result<CodexAppServerMessage> {
    let object = value
        .as_object()
        .context("JSON-RPC message must be an object")?;
    let id = object.get("id").and_then(request_id_key);
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);

    if let Some(method) = method {
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        return Ok(match id {
            Some(id) => CodexAppServerMessage::Request { id, method, params },
            None => CodexAppServerMessage::Notification { method, params },
        });
    }

    if let Some(id) = id {
        if let Some(result) = object.get("result") {
            return Ok(CodexAppServerMessage::Response {
                id,
                result: result.clone(),
            });
        }
        if let Some(error) = object.get("error").and_then(Value::as_object) {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown app-server error")
                .to_string();
            return Ok(CodexAppServerMessage::Error { id, code, message });
        }
    }

    anyhow::bail!("unsupported JSON-RPC message shape")
}

fn request_id_key(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn status_from_initialize_result(result: Value) -> CodexAppServerStatus {
    let user_agent = result
        .get("userAgent")
        .and_then(Value::as_str)
        .map(str::to_string);
    let codex_home = result
        .get("codexHome")
        .and_then(Value::as_str)
        .map(str::to_string);
    let platform_family = result
        .get("platformFamily")
        .and_then(Value::as_str)
        .map(str::to_string);
    let platform_os = result
        .get("platformOs")
        .and_then(Value::as_str)
        .map(str::to_string);
    let message = user_agent
        .clone()
        .unwrap_or_else(|| "Codex app-server is available".to_string());

    CodexAppServerStatus {
        available: true,
        user_agent,
        codex_home,
        platform_family,
        platform_os,
        message,
    }
}

fn app_server_probe_error_message(error: &anyhow::Error) -> String {
    let message = error.to_string();
    if message.contains("No such file") || message.contains("not found") {
        "Codex CLI not found".to_string()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_rpc_response() {
        let message =
            parse_json_rpc_line(r#"{"id":1,"result":{"userAgent":"codex/0.137.0"}}"#).unwrap();

        assert_eq!(
            message,
            CodexAppServerMessage::Response {
                id: "1".to_string(),
                result: json!({ "userAgent": "codex/0.137.0" }),
            }
        );
    }

    #[test]
    fn parses_json_rpc_notification_and_request() {
        let notification =
            parse_json_rpc_line(r#"{"method":"turn/started","params":{"threadId":"thread-1"}}"#)
                .unwrap();
        assert_eq!(
            notification,
            CodexAppServerMessage::Notification {
                method: "turn/started".to_string(),
                params: json!({ "threadId": "thread-1" }),
            }
        );

        let request = parse_json_rpc_line(
            r#"{"id":"approval-1","method":"item/commandExecution/requestApproval","params":{}}"#,
        )
        .unwrap();
        assert_eq!(
            request,
            CodexAppServerMessage::Request {
                id: "approval-1".to_string(),
                method: "item/commandExecution/requestApproval".to_string(),
                params: json!({}),
            }
        );
    }

    #[test]
    fn builds_status_from_initialize_response() {
        let status = status_from_initialize_result(json!({
            "userAgent": "slavey/0.1.0 codex/0.137.0",
            "codexHome": "/tmp/codex",
            "platformFamily": "unix",
            "platformOs": "macos",
        }));

        assert!(status.available);
        assert_eq!(status.codex_home.as_deref(), Some("/tmp/codex"));
        assert_eq!(status.platform_os.as_deref(), Some("macos"));
    }

    #[test]
    fn transcript_delta_extracts_agent_and_command_output() {
        assert_eq!(
            transcript_delta_for_app_server_event(
                "item/agentMessage/delta",
                &json!({ "delta": "done" })
            ),
            Some("done".to_string())
        );
        assert_eq!(
            transcript_delta_for_app_server_event(
                "item/started",
                &json!({ "item": { "type": "commandExecution", "command": "pwd" } })
            ),
            Some("\r\n$ pwd\r\n".to_string())
        );
    }

    #[test]
    fn default_approval_request_response_declines() {
        assert_eq!(
            default_server_request_response("item/commandExecution/requestApproval"),
            json!({ "decision": "decline" })
        );
        assert_eq!(
            default_server_request_response("item/tool/requestUserInput"),
            json!({ "answers": {} })
        );
    }
}
