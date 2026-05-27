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
    employees::{resolve_employee_execution_dir, EmployeeManager},
    events::{emit_action_updated, emit_approval_updated, emit_log, now_ms, LogLevel},
    fs::write_file_in_workspace,
    persistence::{AppStateSnapshotInput, PersistenceManager},
    processes::{configure_process_group, shell_command, terminate_process_tree, ProcessManager},
    read_workspace_root,
    terminal::TerminalSessionStore,
    AppState, WorkspaceRootHandle,
};

pub const DEFAULT_ACTION_TIMEOUT_SECS: u64 = 120;
pub const MAX_ACTION_TIMEOUT_SECS: u64 = 600;
pub const MAX_ACTION_OUTPUT_BYTES: usize = 1024 * 1024;
pub const MAX_FILE_WRITE_CONTENT_BYTES: usize = 1024 * 1024;
pub const MAX_PERSISTED_ACTIONS: usize = 250;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionSource {
    User,
    Employee,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionFailureReason {
    CommandFailed,
    TimedOut,
    OutputLimitExceeded,
    FailedToStart,
    ValidationFailed,
    Unsupported,
    AppRestarted,
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
    #[serde(default, skip_serializing)]
    pub contents: Option<String>,
    #[serde(default = "default_action_source")]
    pub source: ActionSource,
    #[serde(default = "default_action_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default = "default_action_output_cap_bytes")]
    pub output_cap_bytes: usize,
    pub approval_id: Option<String>,
    pub status: ActionStatus,
    pub output: String,
    pub error: Option<String>,
    #[serde(default)]
    pub failure_reason: Option<ActionFailureReason>,
    #[serde(default)]
    pub cancellation_reason: Option<String>,
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

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionListFilter {
    pub employee_id: Option<String>,
    pub status: Option<ActionStatus>,
    pub kind: Option<ActionKind>,
    pub limit: Option<usize>,
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
            source: ActionSource::User,
            timeout_secs,
            output_cap_bytes: MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status: ActionStatus::Draft,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
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

    pub fn list(&self, filter: Option<&ActionListFilter>) -> Vec<Action> {
        let mut actions = self.actions.lock().values().cloned().collect::<Vec<_>>();
        if let Some(filter) = filter {
            actions.retain(|action| action_matches_filter(action, filter));
        }
        actions.sort_by_key(|action| action.created_at);
        if let Some(limit) = filter.and_then(|filter| filter.limit) {
            let keep = limit.min(actions.len());
            actions = actions.into_iter().rev().take(keep).collect::<Vec<_>>();
            actions.reverse();
        }
        actions
    }

    pub fn has_running(&self) -> bool {
        !self.running.lock().is_empty()
            || self
                .actions
                .lock()
                .values()
                .any(|action| action.status == ActionStatus::Running)
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
            action.failure_reason = None;
            action.cancellation_reason = None;
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
            action.failure_reason = None;
            Ok(())
        })
    }

    pub fn reject_by_approval(&self, action_id: &str, approval_id: &str) -> Result<Action, String> {
        self.transition(action_id, ActionStatus::Rejected, |action| {
            ensure_action_approval(action, approval_id)?;
            action.error = Some("approval rejected".to_string());
            action.failure_reason = None;
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
            action.failure_reason = None;
            action.cancellation_reason = None;
            Ok(())
        })
    }

    pub fn finish_success(&self, id: &str, output: String) -> Result<Action, String> {
        self.transition(id, ActionStatus::Succeeded, |action| {
            action.output = truncate_action_output(&output);
            action.error = None;
            action.failure_reason = None;
            action.cancellation_reason = None;
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    pub fn finish_failure(
        &self,
        id: &str,
        reason: ActionFailureReason,
        message: String,
        output: String,
    ) -> Result<Action, String> {
        self.transition(id, ActionStatus::Failed, |action| {
            action.output = truncate_action_output(&output);
            action.error = Some(message);
            action.failure_reason = Some(reason);
            action.finished_at = Some(now_ms());
            Ok(())
        })
    }

    pub fn cancel(&self, id: &str, reason: impl Into<String>) -> Result<Action, String> {
        let reason = reason.into();
        self.transition(id, ActionStatus::Cancelled, |action| {
            action.error = Some(reason.clone());
            action.cancellation_reason = Some(reason);
            action.failure_reason = Some(ActionFailureReason::Cancelled);
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
    prune_action_history_for_persistence(
        actions
            .iter()
            .cloned()
            .map(|mut action| {
                if action.status == ActionStatus::Running {
                    action.status = ActionStatus::Failed;
                    action.error = Some("app restarted before action completed".to_string());
                    action.output = "app restarted before action completed".to_string();
                    action.failure_reason = Some(ActionFailureReason::AppRestarted);
                    action.finished_at = Some(now_ms());
                    action.updated_at = now_ms();
                }
                if action.kind == ActionKind::FileWrite
                    && action.contents.is_none()
                    && !is_terminal_action_status(action.status)
                {
                    action.status = ActionStatus::Failed;
                    action.error = Some(
                        "file write contents are not persisted; recreate the action".to_string(),
                    );
                    action.failure_reason = Some(ActionFailureReason::ValidationFailed);
                    action.finished_at = Some(now_ms());
                    action.updated_at = now_ms();
                }
                action.output = truncate_action_output(&action.output);
                if action.output_cap_bytes == 0 {
                    action.output_cap_bytes = MAX_ACTION_OUTPUT_BYTES;
                }
                if matches!(action.status, ActionStatus::Cancelled)
                    && action.cancellation_reason.is_none()
                {
                    action.cancellation_reason = Some(
                        action
                            .error
                            .clone()
                            .unwrap_or_else(|| "action cancelled".to_string()),
                    );
                }
                action
            })
            .collect(),
    )
}

fn default_action_timeout_secs() -> u64 {
    DEFAULT_ACTION_TIMEOUT_SECS
}

fn default_action_output_cap_bytes() -> usize {
    MAX_ACTION_OUTPUT_BYTES
}

fn default_action_source() -> ActionSource {
    ActionSource::User
}

pub fn prune_action_history_for_persistence(actions: Vec<Action>) -> Vec<Action> {
    let mut normalized = actions
        .into_iter()
        .map(action_for_persistence)
        .collect::<Vec<_>>();
    let mut terminal = normalized
        .iter()
        .filter(|action| is_terminal_action_status(action.status))
        .map(|action| action.id.clone())
        .collect::<Vec<_>>();

    if terminal.len() <= MAX_PERSISTED_ACTIONS {
        normalized.sort_by_key(|action| action.created_at);
        return normalized;
    }

    terminal.sort_by_key(|id| {
        std::cmp::Reverse(
            normalized
                .iter()
                .find(|action| action.id == *id)
                .map(|action| action.updated_at.max(action.created_at))
                .unwrap_or_default(),
        )
    });
    let keep_terminal = terminal
        .into_iter()
        .take(MAX_PERSISTED_ACTIONS)
        .collect::<std::collections::HashSet<_>>();
    normalized.retain(|action| {
        !is_terminal_action_status(action.status) || keep_terminal.contains(&action.id)
    });
    normalized.sort_by_key(|action| action.created_at);
    normalized
}

pub fn action_for_persistence(mut action: Action) -> Action {
    action.contents = None;
    action.output = truncate_action_output(&action.output);
    if action.output_cap_bytes == 0 {
        action.output_cap_bytes = MAX_ACTION_OUTPUT_BYTES;
    }
    action
}

pub fn is_terminal_action_status(status: ActionStatus) -> bool {
    matches!(
        status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Rejected
            | ActionStatus::Cancelled
    )
}

fn action_matches_filter(action: &Action, filter: &ActionListFilter) -> bool {
    filter
        .employee_id
        .as_deref()
        .map(|employee_id| action.employee_id == employee_id)
        .unwrap_or(true)
        && filter
            .status
            .map(|status| action.status == status)
            .unwrap_or(true)
        && filter.kind.map(|kind| action.kind == kind).unwrap_or(true)
}

fn truncate_action_output(output: &str) -> String {
    if output.len() <= MAX_ACTION_OUTPUT_BYTES {
        return output.to_string();
    }
    let mut end = MAX_ACTION_OUTPUT_BYTES;
    while !output.is_char_boundary(end) {
        end -= 1;
    }
    output[..end].to_string()
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
pub fn action_list(state: State<'_, AppState>, filter: Option<ActionListFilter>) -> Vec<Action> {
    state.actions.list(filter.as_ref())
}

#[tauri::command]
pub fn action_get(state: State<'_, AppState>, action_id: String) -> Result<Action, String> {
    state
        .actions
        .get(&action_id)
        .ok_or_else(|| "action not found".to_string())
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

    let workspace_root = state.workspace_root();
    let context = ActionRunContext {
        execution_root: workspace_root,
        workspace_root: state.workspace_root_handle(),
        employees: state.employees.clone(),
        approvals: state.approvals.clone(),
        actions: state.actions.clone(),
        processes: state.processes.clone(),
        terminal_sessions: state.terminal_sessions.clone(),
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

    let updated = state
        .actions
        .cancel(&action_id, "action cancelled by user")?;
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
    let employee = state
        .employees
        .get(&payload.employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
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
        let workspace_root = state.workspace_root();
        resolve_employee_execution_dir(&workspace_root, &employee, Some(cwd))?;
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
    execution_root: PathBuf,
    workspace_root: WorkspaceRootHandle,
    employees: EmployeeManager,
    approvals: crate::approvals::ApprovalManager,
    actions: ActionManager,
    processes: ProcessManager,
    terminal_sessions: TerminalSessionStore,
    persistence: PersistenceManager,
}

#[derive(Debug)]
struct ActionFailure {
    reason: ActionFailureReason,
    message: String,
    output: String,
}

type ActionExecutionResult = Result<String, ActionFailure>;

impl ActionFailure {
    fn new(reason: ActionFailureReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
            output: String::new(),
        }
    }

    fn with_output(reason: ActionFailureReason, message: impl Into<String>, output: &[u8]) -> Self {
        Self {
            reason,
            message: message.into(),
            output: bytes_to_string(output),
        }
    }
}

impl From<String> for ActionFailure {
    fn from(message: String) -> Self {
        ActionFailure::new(ActionFailureReason::ValidationFailed, message)
    }
}

fn run_action_impl(
    context: &ActionRunContext,
    actions: &ActionManager,
    action: &Action,
) -> ActionExecutionResult {
    if action_is_cancelled(actions, &action.id) {
        return Err(ActionFailure::new(
            ActionFailureReason::Cancelled,
            "action cancelled",
        ));
    }

    match action.kind {
        ActionKind::ShellCommand => run_shell_action(context, actions, action),
        ActionKind::FileWrite => run_file_write_action(context, action),
        ActionKind::GitOperation => Err(ActionFailure::new(
            ActionFailureReason::Unsupported,
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
        Err(failure) => context.actions.finish_failure(
            action_id,
            failure.reason,
            failure.message,
            failure.output,
        ),
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
    let workspace_root = read_workspace_root(&context.workspace_root);
    context.persistence.save(AppStateSnapshotInput {
        workspace_root,
        employees: context.employees.list(),
        terminal_sessions: context.terminal_sessions.list(None),
        actions: context.actions.list(None),
        approvals: context.approvals.list(None),
        processes: context.processes.list(),
        process_logs: context.processes.log_snapshots(),
    })
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
    let employee = context.employees.get(&action.employee_id).ok_or_else(|| {
        ActionFailure::new(ActionFailureReason::ValidationFailed, "employee not found")
    })?;
    let cwd =
        resolve_employee_execution_dir(&context.execution_root, &employee, action.cwd.as_deref())
            .map_err(ActionFailure::from)?;
    let command = action.command.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "shell command action requires command",
        )
    })?;

    let mut command = shell_command(command);
    command
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        ActionFailure::new(ActionFailureReason::FailedToStart, error.to_string())
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::FailedToStart,
            "failed to capture stdout",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::FailedToStart,
            "failed to capture stderr",
        )
    })?;
    let child = Arc::new(Mutex::new(child));
    let cancel = Arc::new(AtomicBool::new(false));
    actions.register_running_process(&action.id, Arc::clone(&child), Arc::clone(&cancel));
    if action_is_cancelled(actions, &action.id) {
        actions.cancel_running_process(&action.id);
        return Err(ActionFailure::new(
            ActionFailureReason::Cancelled,
            "action cancelled",
        ));
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
            return Err(ActionFailure::with_output(
                ActionFailureReason::Cancelled,
                "action cancelled",
                &output,
            ));
        }

        let status = {
            let mut child = child.lock();
            child.try_wait().map_err(|error| {
                ActionFailure::new(ActionFailureReason::CommandFailed, error.to_string())
            })?
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
                    reason: ActionFailureReason::CommandFailed,
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
                ActionFailureReason::TimedOut,
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
    let path = action.path.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "file write action requires path",
        )
    })?;
    let contents = action.contents.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "file write action requires contents",
        )
    })?;
    ensure_file_write_size(contents).map_err(ActionFailure::from)?;
    let root = resolve_file_write_action_root(context, action)?;
    write_file_in_workspace(&root, path, contents).map_err(ActionFailure::from)?;
    Ok(format!("wrote {path}"))
}

fn resolve_file_write_action_root(
    context: &ActionRunContext,
    action: &Action,
) -> Result<PathBuf, ActionFailure> {
    let employee = context.employees.get(&action.employee_id).ok_or_else(|| {
        ActionFailure::new(ActionFailureReason::ValidationFailed, "employee not found")
    })?;
    resolve_employee_execution_dir(&context.execution_root, &employee, action.cwd.as_deref())
        .map_err(ActionFailure::from)
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
            ActionFailureReason::OutputLimitExceeded,
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
    use std::{fs as std_fs, path::Path, sync::Arc};

    use crate::{
        approvals::ApprovalManager,
        employees::{EmployeeManager, EmployeeRole},
    };
    use parking_lot::RwLock;

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

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("slavey-actions-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn test_context(root: &Path, worktree: Option<&Path>) -> (ActionRunContext, String) {
        let employees = EmployeeManager::default();
        let employee = employees.create(
            "Employee".to_string(),
            EmployeeRole::General,
            root.to_path_buf(),
        );
        if let Some(worktree) = worktree {
            employees.update(&employee.id, |employee| {
                let worktree = worktree.to_string_lossy().to_string();
                employee.worktree_path = Some(worktree.clone());
                employee.cwd = worktree;
            });
        }

        (
            ActionRunContext {
                execution_root: root.to_path_buf(),
                workspace_root: Arc::new(RwLock::new(root.to_path_buf())),
                employees,
                approvals: ApprovalManager::default(),
                actions: ActionManager::default(),
                processes: ProcessManager::default(),
                terminal_sessions: TerminalSessionStore::default(),
                persistence: PersistenceManager::new(root.join("state.json"), None),
            },
            employee.id,
        )
    }

    fn file_write_action(employee_id: String, path: impl Into<String>) -> Action {
        Action {
            id: "action-1".to_string(),
            employee_id,
            kind: ActionKind::FileWrite,
            title: "Write file".to_string(),
            description: "Test write".to_string(),
            cwd: None,
            command: None,
            path: Some(path.into()),
            contents: Some("written by action".to_string()),
            source: ActionSource::User,
            timeout_secs: DEFAULT_ACTION_TIMEOUT_SECS,
            output_cap_bytes: MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status: ActionStatus::Approved,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
            created_at: 1,
            updated_at: 1,
            started_at: None,
            finished_at: None,
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
    fn action_manager_lists_filters_and_gets_actions() {
        let manager = ActionManager::default();
        let first = manager.create(sample_action_request()).unwrap();
        let mut second_request = sample_action_request();
        second_request.employee_id = "employee-2".to_string();
        second_request.kind = ActionKind::FileWrite;
        second_request.path = Some("note.txt".to_string());
        second_request.contents = Some("ok".to_string());
        second_request.command = None;
        let second = manager.create(second_request).unwrap();
        manager.request_approval(&second.id, "approval-2").unwrap();

        let employee_two = manager.list(Some(&ActionListFilter {
            employee_id: Some("employee-2".to_string()),
            ..ActionListFilter::default()
        }));
        let pending = manager.list(Some(&ActionListFilter {
            status: Some(ActionStatus::PendingApproval),
            ..ActionListFilter::default()
        }));

        assert_eq!(manager.get(&first.id).unwrap().id, first.id);
        assert_eq!(employee_two.len(), 1);
        assert_eq!(employee_two[0].id, second.id);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, second.id);
    }

    #[test]
    fn cancelled_action_cannot_finish_successfully_later() {
        let manager = ActionManager::default();
        let action = manager.create(sample_action_request()).unwrap();
        manager.request_approval(&action.id, "approval-1").unwrap();
        manager
            .approve_by_approval(&action.id, "approval-1")
            .unwrap();
        manager.start_running(&action.id).unwrap();
        manager.cancel(&action.id, "test cancellation").unwrap();

        let error = manager
            .finish_success(&action.id, "late success".to_string())
            .unwrap_err();

        assert!(error.contains("invalid action transition"));
        let action = manager.get(&action.id).unwrap();
        assert_eq!(action.status, ActionStatus::Cancelled);
        assert_eq!(
            action.cancellation_reason.as_deref(),
            Some("test cancellation")
        );
    }

    #[test]
    fn persisted_action_history_is_capped_and_redacts_contents() {
        let actions = (0..(MAX_PERSISTED_ACTIONS + 5))
            .map(|index| shell_action_for_history(index as u64))
            .collect::<Vec<_>>();

        let pruned = prune_action_history_for_persistence(actions);

        assert_eq!(pruned.len(), MAX_PERSISTED_ACTIONS);
        assert!(pruned.iter().all(|action| action.contents.is_none()));
        assert!(!pruned.iter().any(|action| action.id == "action-0"));
        assert!(pruned.iter().any(|action| action.id == "action-254"));
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
    fn file_write_action_with_worktree_writes_inside_worktree_by_default() {
        let root = test_root("worktree-default");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, "notes.txt");

        run_file_write_action(&context, &action).unwrap();

        assert_eq!(
            std_fs::read_to_string(worktree.join("notes.txt")).unwrap(),
            "written by action"
        );
        assert!(!root.join("notes.txt").exists());
    }

    #[test]
    fn file_write_action_with_worktree_rejects_absolute_path_outside_worktree() {
        let root = test_root("worktree-absolute-outside");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, root.join("outside.txt").to_string_lossy());

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("outside the workspace"));
        assert!(!root.join("outside.txt").exists());
    }

    #[test]
    fn file_write_action_with_worktree_rejects_relative_path_outside_worktree() {
        let root = test_root("worktree-relative-outside");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, "../../outside.txt");

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("outside the workspace"));
    }

    #[test]
    fn file_write_action_without_worktree_writes_inside_workspace() {
        let root = test_root("workspace-default");
        let (context, employee_id) = test_context(&root, None);
        let action = file_write_action(employee_id, "notes.txt");

        run_file_write_action(&context, &action).unwrap();

        assert_eq!(
            std_fs::read_to_string(root.join("notes.txt")).unwrap(),
            "written by action"
        );
    }

    #[test]
    fn file_write_action_sensitive_paths_remain_blocked() {
        let root = test_root("sensitive");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, ".env");

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("blocked"));
        assert!(!worktree.join(".env").exists());
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

    fn shell_action_for_history(index: u64) -> Action {
        Action {
            id: format!("action-{index}"),
            employee_id: "employee-1".to_string(),
            kind: ActionKind::ShellCommand,
            title: "History".to_string(),
            description: "History".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
            path: None,
            contents: Some("redacted".to_string()),
            source: ActionSource::User,
            timeout_secs: DEFAULT_ACTION_TIMEOUT_SECS,
            output_cap_bytes: MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status: ActionStatus::Succeeded,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
            created_at: index,
            updated_at: index,
            started_at: Some(index),
            finished_at: Some(index),
        }
    }
}
