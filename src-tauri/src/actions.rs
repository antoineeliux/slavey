use std::{
    collections::HashMap,
    io::Read,
    path::PathBuf,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    approvals::{resolve_approval_for_action, ApprovalCreateRequest, ApprovalKind, ApprovalStatus},
    employees::EmployeeManager,
    events::{emit_action_updated, emit_approval_updated, emit_log, now_ms, LogLevel},
    fs::{resolve_existing_dir, write_file_in_workspace},
    persistence::PersistenceManager,
    processes::{configure_process_group, shell_command, terminate_process_tree},
    AppState,
};

pub const DEFAULT_ACTION_TIMEOUT_SECS: u64 = 120;
pub const MAX_ACTION_TIMEOUT_SECS: u64 = 600;
pub const MAX_ACTION_OUTPUT_BYTES: usize = 1024 * 1024;
pub const MAX_FILE_WRITE_CONTENT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    ShellCommand,
    FileWrite,
    GitOperation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    Draft,
    PendingApproval,
    Approved,
    Running,
    Succeeded,
    Failed,
    Rejected,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: String,
    pub employee_id: String,
    pub kind: ActionKind,
    pub title: String,
    pub description: String,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub path: Option<String>,
    pub contents: Option<String>,
    #[serde(default = "default_action_timeout_secs")]
    pub timeout_secs: u64,
    pub approval_id: Option<String>,
    pub status: ActionStatus,
    pub output: String,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCreateRequest {
    pub employee_id: String,
    pub kind: ActionKind,
    pub title: String,
    pub description: String,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub path: Option<String>,
    pub contents: Option<String>,
    pub timeout_secs: Option<u64>,
}

#[derive(Clone)]
struct RunningProcess {
    child: Arc<Mutex<Child>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct ActionManager {
    actions: Arc<Mutex<HashMap<String, Action>>>,
    running: Arc<Mutex<HashMap<String, RunningProcess>>>,
}

impl ActionManager {
    pub fn create(&self, payload: ActionCreateRequest) -> Result<Action, String> {
        let now = now_ms();
        let timeout_secs = normalize_timeout_secs(payload.timeout_secs)?;
        let action = Action {
            id: Uuid::new_v4().to_string(),
            employee_id: payload.employee_id,
            kind: payload.kind,
            title: payload.title,
            description: payload.description,
            cwd: payload.cwd,
            command: payload.command,
            path: payload.path,
            contents: payload.contents,
            timeout_secs,
            approval_id: None,
            status: ActionStatus::Draft,
            output: String::new(),
            error: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
        };
        self.actions
            .lock()
            .insert(action.id.clone(), action.clone());
        Ok(action)
    }

    pub fn list(&self) -> Vec<Action> {
        let mut actions = self.actions.lock().values().cloned().collect::<Vec<_>>();
        actions.sort_by_key(|action| action.created_at);
        actions
    }

    pub fn replace_all(&self, actions: Vec<Action>) {
        let mut next = HashMap::new();
        for action in actions {
            next.insert(action.id.clone(), action);
        }
        *self.actions.lock() = next;
        self.running.lock().clear();
    }

    pub fn get(&self, id: &str) -> Option<Action> {
        self.actions.lock().get(id).cloned()
    }

    pub fn request_approval(&self, id: &str, approval_id: &str) -> Result<Action, String> {
        self.transition(id, ActionStatus::PendingApproval, |action| {
            action.approval_id = Some(approval_id.to_string());
            action.error = None;
            Ok(())
        })
    }

    pub fn approve_by_approval(
        &self,
        action_id: &str,
        approval_id: &str,
    ) -> Result<Action, String> {
        self.transition(action_id, ActionStatus::Approved, |action| {
            ensure_action_approval(action, approval_id)?;
            action.error = None;
            Ok(())
        })
    }

    pub fn reject_by_approval(&self, action_id: &str, approval_id: &str) -> Result<Action, String> {
        self.transition(action_id, ActionStatus::Rejected, |action| {
            ensure_action_approval(action, approval_id)?;
            action.error = Some("approval rejected".to_string());
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    pub fn start_running(&self, id: &str) -> Result<Action, String> {
        self.transition(id, ActionStatus::Running, |action| {
            action.started_at = Some(now_ms());
            action.finished_at = None;
            action.output.clear();
            action.error = None;
            Ok(())
        })
    }

    pub fn finish_success(&self, id: &str, output: String) -> Result<Action, String> {
        self.transition(id, ActionStatus::Succeeded, |action| {
            action.output = output;
            action.error = None;
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    pub fn finish_failure(
        &self,
        id: &str,
        message: String,
        output: String,
    ) -> Result<Action, String> {
        self.transition(id, ActionStatus::Failed, |action| {
            action.output = output;
            action.error = Some(message);
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    pub fn cancel(&self, id: &str) -> Result<Action, String> {
        self.transition(id, ActionStatus::Cancelled, |action| {
            action.error = Some("action cancelled".to_string());
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    fn transition<F>(&self, id: &str, next: ActionStatus, update: F) -> Result<Action, String>
    where
        F: FnOnce(&mut Action) -> Result<(), String>,
    {
        let mut actions = self.actions.lock();
        let action = actions
            .get_mut(id)
            .ok_or_else(|| "action not found".to_string())?;
        validate_transition(action.status, next)?;
        update(action)?;
        action.status = next;
        action.updated_at = now_ms();
        Ok(action.clone())
    }

    fn register_running_process(
        &self,
        action_id: &str,
        child: Arc<Mutex<Child>>,
        cancel: Arc<AtomicBool>,
    ) {
        self.running
            .lock()
            .insert(action_id.to_string(), RunningProcess { child, cancel });
    }

    fn remove_running_process(&self, action_id: &str) {
        self.running.lock().remove(action_id);
    }

    fn cancel_running_process(&self, action_id: &str) {
        if let Some(running) = self.running.lock().remove(action_id) {
            running.cancel.store(true, Ordering::SeqCst);
            let mut child = running.child.lock();
            terminate_process_tree(&mut child);
        }
    }
}

pub fn restore_actions(actions: &[Action]) -> Vec<Action> {
    actions
        .iter()
        .cloned()
        .map(|mut action| {
            if action.status == ActionStatus::Running {
                action.status = ActionStatus::Failed;
                action.error = Some("app restarted before action completed".to_string());
                action.output = "app restarted before action completed".to_string();
                action.finished_at = Some(now_ms());
                action.updated_at = now_ms();
            }
            action
        })
        .collect()
}

fn default_action_timeout_secs() -> u64 {
    DEFAULT_ACTION_TIMEOUT_SECS
}

#[tauri::command]
pub fn action_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ActionCreateRequest,
) -> Result<Action, String> {
    validate_action_payload(&state, &payload)?;
    let action = state.actions.create(payload)?;
    emit_log(
        &app,
        LogLevel::Info,
        format!("created action {}", action.title),
    );
    emit_action_updated(&app, action.clone());
    persist_or_log(&app, &state);
    Ok(action)
}

#[tauri::command]
pub fn action_list(state: State<'_, AppState>) -> Vec<Action> {
    state.actions.list()
}

#[tauri::command]
pub fn action_request_approval(
    app: AppHandle,
    state: State<'_, AppState>,
    action_id: String,
) -> Result<Action, String> {
    let action = state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())?;
    if action.status != ActionStatus::Draft {
        return Err("only draft actions can request approval".to_string());
    }

    let approval_id = Uuid::new_v4().to_string();
    let updated = state.actions.request_approval(&action_id, &approval_id)?;
    let approval = state.approvals.create_with_id(
        approval_id,
        ApprovalCreateRequest {
            employee_id: updated.employee_id.clone(),
            action_id: Some(updated.id.clone()),
            kind: updated.kind.into(),
            title: updated.title.clone(),
            description: updated.description.clone(),
            command: updated.command.clone(),
            path: updated.path.clone(),
            cwd: updated.cwd.clone(),
        },
    );

    emit_approval_updated(&app, approval);
    emit_action_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn action_approve(
    app: AppHandle,
    state: State<'_, AppState>,
    action_id: String,
) -> Result<Action, String> {
    let action = state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())?;
    let approval_id = action
        .approval_id
        .ok_or_else(|| "action has no approval request".to_string())?;
    let (approval, updated) =
        resolve_approval_for_action(&state, &approval_id, ApprovalStatus::Approved)?;
    let updated = updated.ok_or_else(|| "approval is not linked to an action".to_string())?;
    emit_approval_updated(&app, approval);
    emit_action_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn action_reject(
    app: AppHandle,
    state: State<'_, AppState>,
    action_id: String,
) -> Result<Action, String> {
    let action = state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())?;
    let approval_id = action
        .approval_id
        .ok_or_else(|| "action has no approval request".to_string())?;
    let (approval, updated) =
        resolve_approval_for_action(&state, &approval_id, ApprovalStatus::Rejected)?;
    let updated = updated.ok_or_else(|| "approval is not linked to an action".to_string())?;
    emit_approval_updated(&app, approval);
    emit_action_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn action_run(
    app: AppHandle,
    state: State<'_, AppState>,
    action_id: String,
) -> Result<Action, String> {
    let action = state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())?;
    if action.status != ActionStatus::Approved {
        return Err("action must be approved before running".to_string());
    }

    let running = state.actions.start_running(&action_id)?;
    emit_action_updated(&app, running.clone());

    let context = ActionRunContext {
        workspace_root: state.workspace_root.clone(),
        employees: state.employees.clone(),
        approvals: state.approvals.clone(),
        actions: state.actions.clone(),
        persistence: state.persistence.clone(),
    };
    let actions = state.actions.clone();
    let run_app = app.clone();
    let run_action = running.clone();
    thread::spawn(move || {
        let result = run_action_impl(&context, &actions, &run_action);
        finish_background_action(&run_app, &context, &run_action.id, result);
    });

    persist_or_log(&app, &state);
    Ok(running)
}

#[tauri::command]
pub fn action_cancel(
    app: AppHandle,
    state: State<'_, AppState>,
    action_id: String,
) -> Result<Action, String> {
    let action = state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())?;
    if matches!(
        action.status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Rejected
            | ActionStatus::Cancelled
    ) {
        return Err(format!(
            "cannot cancel action with status {}",
            action_status_label(action.status)
        ));
    }

    if action.status == ActionStatus::Running {
        state.actions.cancel_running_process(&action_id);
    }

    let updated = state.actions.cancel(&action_id)?;
    if action.status == ActionStatus::PendingApproval {
        if let Some(approval_id) = action.approval_id {
            match state
                .approvals
                .resolve(&approval_id, ApprovalStatus::Rejected)
            {
                Ok(approval) => emit_approval_updated(&app, approval),
                Err(error) => emit_log(
                    &app,
                    LogLevel::Warn,
                    format!("failed to resolve cancelled action approval: {error}"),
                ),
            }
        }
    }

    emit_action_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

fn validate_action_payload(
    state: &State<'_, AppState>,
    payload: &ActionCreateRequest,
) -> Result<(), String> {
    if state.employees.get(&payload.employee_id).is_none() {
        return Err("employee not found".to_string());
    }
    if payload.title.trim().is_empty() {
        return Err("action title is required".to_string());
    }
    normalize_timeout_secs(payload.timeout_secs)?;

    match payload.kind {
        ActionKind::ShellCommand => {
            if payload.command.as_deref().unwrap_or("").trim().is_empty() {
                return Err("shell command action requires command".to_string());
            }
        }
        ActionKind::FileWrite => {
            if payload.path.as_deref().unwrap_or("").trim().is_empty() {
                return Err("file write action requires path".to_string());
            }
            let contents = payload
                .contents
                .as_deref()
                .ok_or_else(|| "file write action requires contents".to_string())?;
            ensure_file_write_size(contents)?;
        }
        ActionKind::GitOperation => {}
    }

    if let Some(cwd) = payload.cwd.as_deref() {
        resolve_existing_dir(&state.workspace_root, cwd)?;
    }

    Ok(())
}

fn validate_transition(from: ActionStatus, to: ActionStatus) -> Result<(), String> {
    let allowed = matches!(
        (from, to),
        (ActionStatus::Draft, ActionStatus::PendingApproval)
            | (ActionStatus::PendingApproval, ActionStatus::Approved)
            | (ActionStatus::PendingApproval, ActionStatus::Rejected)
            | (ActionStatus::Approved, ActionStatus::Running)
            | (ActionStatus::Approved, ActionStatus::Cancelled)
            | (ActionStatus::Running, ActionStatus::Succeeded)
            | (ActionStatus::Running, ActionStatus::Failed)
            | (ActionStatus::Running, ActionStatus::Cancelled)
            | (ActionStatus::Draft, ActionStatus::Cancelled)
            | (ActionStatus::PendingApproval, ActionStatus::Cancelled)
    );

    if allowed {
        Ok(())
    } else {
        Err(format!(
            "invalid action transition from {} to {}",
            action_status_label(from),
            action_status_label(to)
        ))
    }
}

fn ensure_action_approval(action: &Action, approval_id: &str) -> Result<(), String> {
    if action.approval_id.as_deref() == Some(approval_id) {
        Ok(())
    } else {
        Err("approval is not linked to this action".to_string())
    }
}

fn normalize_timeout_secs(timeout_secs: Option<u64>) -> Result<u64, String> {
    match timeout_secs {
        Some(0) => Err("timeoutSecs must be greater than zero".to_string()),
        Some(timeout) if timeout > MAX_ACTION_TIMEOUT_SECS => {
            Err(format!("timeoutSecs must be <= {MAX_ACTION_TIMEOUT_SECS}"))
        }
        Some(timeout) => Ok(timeout),
        None => Ok(DEFAULT_ACTION_TIMEOUT_SECS),
    }
}

fn ensure_file_write_size(contents: &str) -> Result<(), String> {
    if contents.len() > MAX_FILE_WRITE_CONTENT_BYTES {
        Err(format!(
            "file-write action contents exceed {} bytes",
            MAX_FILE_WRITE_CONTENT_BYTES
        ))
    } else {
        Ok(())
    }
}

fn action_status_label(status: ActionStatus) -> &'static str {
    match status {
        ActionStatus::Draft => "draft",
        ActionStatus::PendingApproval => "pending_approval",
        ActionStatus::Approved => "approved",
        ActionStatus::Running => "running",
        ActionStatus::Succeeded => "succeeded",
        ActionStatus::Failed => "failed",
        ActionStatus::Rejected => "rejected",
        ActionStatus::Cancelled => "cancelled",
    }
}

struct ActionRunContext {
    workspace_root: PathBuf,
    employees: EmployeeManager,
    approvals: crate::approvals::ApprovalManager,
    actions: ActionManager,
    persistence: PersistenceManager,
}

struct ActionFailure {
    message: String,
    output: String,
}

type ActionExecutionResult = Result<String, ActionFailure>;

impl ActionFailure {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            output: String::new(),
        }
    }

    fn with_output(message: impl Into<String>, output: &[u8]) -> Self {
        Self {
            message: message.into(),
            output: bytes_to_string(output),
        }
    }
}

impl From<String> for ActionFailure {
    fn from(message: String) -> Self {
        ActionFailure::new(message)
    }
}

fn run_action_impl(
    context: &ActionRunContext,
    actions: &ActionManager,
    action: &Action,
) -> ActionExecutionResult {
    if action_is_cancelled(actions, &action.id) {
        return Err(ActionFailure::new("action cancelled"));
    }

    match action.kind {
        ActionKind::ShellCommand => run_shell_action(context, actions, action),
        ActionKind::FileWrite => run_file_write_action(context, action),
        ActionKind::GitOperation => Err(ActionFailure::new(
            "git_operation actions are approval-only in this phase",
        )),
    }
}

fn finish_background_action(
    app: &AppHandle,
    context: &ActionRunContext,
    action_id: &str,
    result: ActionExecutionResult,
) {
    let updated = match result {
        Ok(output) => context.actions.finish_success(action_id, output),
        Err(failure) => context
            .actions
            .finish_failure(action_id, failure.message, failure.output),
    };

    match updated {
        Ok(action) => emit_action_updated(app, action),
        Err(error) => {
            if context
                .actions
                .get(action_id)
                .is_some_and(|action| action.status == ActionStatus::Cancelled)
            {
                return;
            }
            emit_log(
                app,
                LogLevel::Warn,
                format!("action {action_id} finished with stale state: {error}"),
            );
        }
    }

    if let Err(error) = persist_context_snapshot(context) {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist completed action: {error}"),
        );
    }
}

fn persist_context_snapshot(context: &ActionRunContext) -> Result<(), String> {
    context.persistence.save(
        &context.workspace_root,
        context.employees.list(),
        context.actions.list(),
        context.approvals.list(),
    )
}

fn persist_or_log(app: &AppHandle, state: &State<'_, AppState>) {
    if let Err(error) = state.persist() {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist app state: {error}"),
        );
    }
}

fn run_shell_action(
    context: &ActionRunContext,
    actions: &ActionManager,
    action: &Action,
) -> ActionExecutionResult {
    let cwd = match action.cwd.as_deref() {
        Some(cwd) if !cwd.trim().is_empty() => {
            resolve_existing_dir(&context.workspace_root, cwd).map_err(ActionFailure::from)?
        }
        _ => {
            let employee = context
                .employees
                .get(&action.employee_id)
                .ok_or_else(|| ActionFailure::new("employee not found"))?;
            resolve_existing_dir(&context.workspace_root, &employee.cwd)
                .map_err(ActionFailure::from)?
        }
    };
    let command = action
        .command
        .as_deref()
        .ok_or_else(|| ActionFailure::new("shell command action requires command"))?;

    let mut command = shell_command(command);
    command
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| ActionFailure::new(error.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ActionFailure::new("failed to capture stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ActionFailure::new("failed to capture stderr"))?;
    let child = Arc::new(Mutex::new(child));
    let cancel = Arc::new(AtomicBool::new(false));
    actions.register_running_process(&action.id, Arc::clone(&child), Arc::clone(&cancel));
    if action_is_cancelled(actions, &action.id) {
        actions.cancel_running_process(&action.id);
        return Err(ActionFailure::new("action cancelled"));
    }

    let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(64);
    spawn_pipe_reader(stdout, sender.clone());
    spawn_pipe_reader(stderr, sender);

    let deadline = Instant::now() + Duration::from_secs(action.timeout_secs);
    let mut output = Vec::new();

    loop {
        if let Err(failure) = drain_available_output(&receiver, &mut output) {
            terminate_child(&child);
            actions.remove_running_process(&action.id);
            return Err(failure);
        }

        if cancel.load(Ordering::SeqCst) {
            terminate_child(&child);
            actions.remove_running_process(&action.id);
            return Err(ActionFailure::with_output("action cancelled", &output));
        }

        let status = {
            let mut child = child.lock();
            child
                .try_wait()
                .map_err(|error| ActionFailure::new(error.to_string()))?
        };
        if let Some(status) = status {
            if let Err(failure) = drain_remaining_output(&receiver, &mut output) {
                terminate_child(&child);
                actions.remove_running_process(&action.id);
                return Err(failure);
            }
            actions.remove_running_process(&action.id);
            let combined = bytes_to_string(&output);
            return if status.success() {
                Ok(combined)
            } else {
                Err(ActionFailure {
                    message: format!("command exited with {status}"),
                    output: combined,
                })
            };
        }

        if Instant::now() >= deadline {
            terminate_child(&child);
            let _ = drain_remaining_output(&receiver, &mut output);
            actions.remove_running_process(&action.id);
            return Err(ActionFailure::with_output(
                format!(
                    "action timed out after {} seconds; process killed",
                    action.timeout_secs
                ),
                &output,
            ));
        }

        thread::sleep(Duration::from_millis(20));
    }
}

fn run_file_write_action(context: &ActionRunContext, action: &Action) -> ActionExecutionResult {
    let path = action
        .path
        .as_deref()
        .ok_or_else(|| ActionFailure::new("file write action requires path"))?;
    let contents = action
        .contents
        .as_deref()
        .ok_or_else(|| ActionFailure::new("file write action requires contents"))?;
    ensure_file_write_size(contents).map_err(ActionFailure::from)?;
    write_file_in_workspace(&context.workspace_root, path, contents)
        .map_err(ActionFailure::from)?;
    Ok(format!("wrote {path}"))
}

fn spawn_pipe_reader<R>(mut reader: R, sender: SyncSender<Vec<u8>>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if sender.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_available_output(
    receiver: &Receiver<Vec<u8>>,
    output: &mut Vec<u8>,
) -> Result<(), ActionFailure> {
    loop {
        match receiver.try_recv() {
            Ok(chunk) => append_output(output, &chunk)?,
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn drain_remaining_output(
    receiver: &Receiver<Vec<u8>>,
    output: &mut Vec<u8>,
) -> Result<(), ActionFailure> {
    let drain_deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => append_output(output, &chunk)?,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= drain_deadline => {
                return Ok(())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn append_output(output: &mut Vec<u8>, chunk: &[u8]) -> Result<(), ActionFailure> {
    if output.len().saturating_add(chunk.len()) > MAX_ACTION_OUTPUT_BYTES {
        let remaining = MAX_ACTION_OUTPUT_BYTES.saturating_sub(output.len());
        output.extend_from_slice(&chunk[..remaining]);
        return Err(ActionFailure::with_output(
            format!(
                "action output exceeded {} bytes; process killed",
                MAX_ACTION_OUTPUT_BYTES
            ),
            output,
        ));
    }
    output.extend_from_slice(chunk);
    Ok(())
}

fn terminate_child(child: &Arc<Mutex<Child>>) {
    let mut child = child.lock();
    terminate_process_tree(&mut child);
}

fn bytes_to_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

fn action_is_cancelled(actions: &ActionManager, action_id: &str) -> bool {
    actions
        .get(action_id)
        .is_some_and(|action| action.status == ActionStatus::Cancelled)
}

impl From<ActionKind> for ApprovalKind {
    fn from(value: ActionKind) -> Self {
        match value {
            ActionKind::ShellCommand => ApprovalKind::ShellCommand,
            ActionKind::FileWrite => ApprovalKind::FileWrite,
            ActionKind::GitOperation => ApprovalKind::GitOperation,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_action_request() -> ActionCreateRequest {
        ActionCreateRequest {
            employee_id: "employee-1".to_string(),
            kind: ActionKind::ShellCommand,
            title: "Run command".to_string(),
            description: "Test command".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
            path: None,
            contents: None,
            timeout_secs: None,
        }
    }

    #[test]
    fn transition_validation_accepts_expected_paths() {
        assert!(validate_transition(ActionStatus::Draft, ActionStatus::PendingApproval).is_ok());
        assert!(validate_transition(ActionStatus::PendingApproval, ActionStatus::Approved).is_ok());
        assert!(validate_transition(ActionStatus::Approved, ActionStatus::Running).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Succeeded).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Failed).is_ok());
        assert!(validate_transition(ActionStatus::Running, ActionStatus::Cancelled).is_ok());
    }

    #[test]
    fn transition_validation_rejects_invalid_paths() {
        assert!(validate_transition(ActionStatus::Draft, ActionStatus::Running).is_err());
        assert!(validate_transition(ActionStatus::Approved, ActionStatus::Rejected).is_err());
        assert!(validate_transition(ActionStatus::Succeeded, ActionStatus::Cancelled).is_err());
    }

    #[test]
    fn action_manager_rejects_invalid_transition() {
        let manager = ActionManager::default();
        let action = manager.create(sample_action_request()).unwrap();

        let error = manager.start_running(&action.id).unwrap_err();

        assert!(error.contains("invalid action transition"));
    }

    #[test]
    fn linked_action_moves_to_approved() {
        let manager = ActionManager::default();
        let action = manager.create(sample_action_request()).unwrap();
        manager.request_approval(&action.id, "approval-1").unwrap();

        let updated = manager
            .approve_by_approval(&action.id, "approval-1")
            .unwrap();

        assert_eq!(updated.status, ActionStatus::Approved);
    }

    #[test]
    fn linked_action_moves_to_rejected() {
        let manager = ActionManager::default();
        let action = manager.create(sample_action_request()).unwrap();
        manager.request_approval(&action.id, "approval-1").unwrap();

        let updated = manager
            .reject_by_approval(&action.id, "approval-1")
            .unwrap();

        assert_eq!(updated.status, ActionStatus::Rejected);
    }

    #[test]
    fn file_write_content_limit_is_enforced() {
        let contents = "x".repeat(MAX_FILE_WRITE_CONTENT_BYTES + 1);

        assert!(ensure_file_write_size(&contents).is_err());
    }

    #[test]
    fn timeout_limit_is_enforced() {
        assert_eq!(
            normalize_timeout_secs(None).unwrap(),
            DEFAULT_ACTION_TIMEOUT_SECS
        );
        assert!(normalize_timeout_secs(Some(0)).is_err());
        assert!(normalize_timeout_secs(Some(MAX_ACTION_TIMEOUT_SECS + 1)).is_err());
    }
}
