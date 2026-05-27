use std::{
    collections::HashMap,
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    approvals::{resolve_approval_for_action, ApprovalCreateRequest, ApprovalKind, ApprovalStatus},
    employees::resolve_employee_execution_dir,
    events::{emit_action_updated, emit_approval_updated, emit_log, now_ms, LogLevel},
    processes::terminate_process_tree,
    AppState,
};

mod persistence;
mod runner;
mod transitions;

pub use self::persistence::{prune_action_history_for_persistence, restore_actions};
use self::{
    persistence::truncate_action_output,
    runner::{finish_background_action, run_action_impl, ActionRunContext},
    transitions::{
        action_status_label, ensure_action_approval, ensure_file_write_size,
        normalize_timeout_secs, validate_transition,
    },
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

fn default_action_timeout_secs() -> u64 {
    DEFAULT_ACTION_TIMEOUT_SECS
}

fn default_action_output_cap_bytes() -> usize {
    MAX_ACTION_OUTPUT_BYTES
}

fn default_action_source() -> ActionSource {
    ActionSource::User
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

fn persist_or_log(app: &AppHandle, state: &State<'_, AppState>) {
    if let Err(error) = state.persist() {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist app state: {error}"),
        );
    }
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
}
