use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    actions::{Action, ActionStatus},
    events::{emit_action_updated, emit_approval_updated, emit_log, now_ms, LogLevel},
    AppState,
};

pub const MAX_PERSISTED_APPROVALS: usize = 250;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalKind {
    ShellCommand,
    FileWrite,
    GitOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub employee_id: String,
    pub action_id: Option<String>,
    pub kind: ApprovalKind,
    pub title: String,
    pub description: String,
    pub command: Option<String>,
    pub path: Option<String>,
    pub cwd: Option<String>,
    pub status: ApprovalStatus,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalCreateRequest {
    pub employee_id: String,
    pub action_id: Option<String>,
    pub kind: ApprovalKind,
    pub title: String,
    pub description: String,
    pub command: Option<String>,
    pub path: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalListFilter {
    pub employee_id: Option<String>,
    pub status: Option<ApprovalStatus>,
    pub kind: Option<ApprovalKind>,
    pub pending_only: Option<bool>,
    pub limit: Option<usize>,
}

#[derive(Clone, Default)]
pub struct ApprovalManager {
    approvals: Arc<Mutex<HashMap<String, ApprovalRequest>>>,
}

impl ApprovalManager {
    pub fn create(&self, payload: ApprovalCreateRequest) -> ApprovalRequest {
        self.create_with_id(Uuid::new_v4().to_string(), payload)
    }

    pub fn create_with_id(&self, id: String, payload: ApprovalCreateRequest) -> ApprovalRequest {
        let now = now_ms();
        let approval = ApprovalRequest {
            id,
            employee_id: payload.employee_id,
            action_id: payload.action_id,
            kind: payload.kind,
            title: payload.title,
            description: payload.description,
            command: payload.command,
            path: payload.path,
            cwd: payload.cwd,
            status: ApprovalStatus::Pending,
            created_at: now,
            resolved_at: None,
        };
        self.approvals
            .lock()
            .insert(approval.id.clone(), approval.clone());
        approval
    }

    pub fn list(&self, filter: Option<&ApprovalListFilter>) -> Vec<ApprovalRequest> {
        let mut approvals = self
            .approvals
            .lock()
            .values()
            .cloned()
            .collect::<Vec<ApprovalRequest>>();
        if let Some(filter) = filter {
            approvals.retain(|approval| approval_matches_filter(approval, filter));
        }
        approvals.sort_by_key(|approval| approval.created_at);
        if let Some(limit) = filter.and_then(|filter| filter.limit) {
            let keep = limit.min(approvals.len());
            approvals = approvals.into_iter().rev().take(keep).collect::<Vec<_>>();
            approvals.reverse();
        }
        approvals
    }

    pub fn replace_all(&self, approvals: Vec<ApprovalRequest>) {
        let mut next = HashMap::new();
        for approval in approvals {
            next.insert(approval.id.clone(), approval);
        }
        *self.approvals.lock() = next;
    }

    pub fn get(&self, id: &str) -> Option<ApprovalRequest> {
        self.approvals.lock().get(id).cloned()
    }

    pub fn resolve(&self, id: &str, status: ApprovalStatus) -> Result<ApprovalRequest, String> {
        validate_resolution_target(status)?;
        let mut approvals = self.approvals.lock();
        let approval = approvals
            .get_mut(id)
            .ok_or_else(|| "approval not found".to_string())?;
        if approval.status != ApprovalStatus::Pending {
            return Err(format!(
                "approval is already {}",
                approval_status_label(approval.status)
            ));
        }
        approval.status = status;
        approval.resolved_at = Some(now_ms());
        Ok(approval.clone())
    }
}

#[tauri::command]
pub fn approval_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ApprovalCreateRequest,
) -> Result<ApprovalRequest, String> {
    if state.employees.get(&payload.employee_id).is_none() {
        return Err("employee not found".to_string());
    }
    if payload.title.trim().is_empty() {
        return Err("approval title is required".to_string());
    }

    let approval = state.approvals.create(payload);
    emit_log(
        &app,
        LogLevel::Info,
        format!("created approval request {}", approval.title),
    );
    emit_approval_updated(&app, approval.clone());
    persist_or_log(&app, &state);
    Ok(approval)
}

#[tauri::command]
pub fn approval_list(
    state: State<'_, AppState>,
    filter: Option<ApprovalListFilter>,
) -> Vec<ApprovalRequest> {
    state.approvals.list(filter.as_ref())
}

#[tauri::command]
pub fn approval_get(
    state: State<'_, AppState>,
    approval_id: String,
) -> Result<ApprovalRequest, String> {
    state
        .approvals
        .get(&approval_id)
        .ok_or_else(|| "approval not found".to_string())
}

#[tauri::command]
pub fn approval_approve(
    app: AppHandle,
    state: State<'_, AppState>,
    approval_id: String,
) -> Result<ApprovalRequest, String> {
    let (approval, action) =
        resolve_approval_for_action(&state, &approval_id, ApprovalStatus::Approved)?;
    if let Some(action) = action {
        emit_action_updated(&app, action);
    }
    emit_log(
        &app,
        LogLevel::Info,
        format!("approved request {}", approval.title),
    );
    emit_approval_updated(&app, approval.clone());
    persist_or_log(&app, &state);
    Ok(approval)
}

#[tauri::command]
pub fn approval_reject(
    app: AppHandle,
    state: State<'_, AppState>,
    approval_id: String,
) -> Result<ApprovalRequest, String> {
    let (approval, action) =
        resolve_approval_for_action(&state, &approval_id, ApprovalStatus::Rejected)?;
    if let Some(action) = action {
        emit_action_updated(&app, action);
    }
    emit_log(
        &app,
        LogLevel::Info,
        format!("rejected request {}", approval.title),
    );
    emit_approval_updated(&app, approval.clone());
    persist_or_log(&app, &state);
    Ok(approval)
}

pub(crate) fn resolve_approval_for_action(
    state: &State<'_, AppState>,
    approval_id: &str,
    status: ApprovalStatus,
) -> Result<(ApprovalRequest, Option<Action>), String> {
    validate_resolution_target(status)?;
    let current = state
        .approvals
        .get(approval_id)
        .ok_or_else(|| "approval not found".to_string())?;
    if current.status != ApprovalStatus::Pending {
        return Err(format!(
            "approval is already {}",
            approval_status_label(current.status)
        ));
    }

    let action = match (current.action_id.as_deref(), status) {
        (Some(action_id), ApprovalStatus::Approved) => {
            Some(state.actions.approve_by_approval(action_id, approval_id)?)
        }
        (Some(action_id), ApprovalStatus::Rejected) => {
            Some(state.actions.reject_by_approval(action_id, approval_id)?)
        }
        (Some(_), ApprovalStatus::Expired) => {
            return Err("linked approval expiration is not implemented yet".to_string())
        }
        (None, _) => None,
        (_, ApprovalStatus::Pending) => unreachable!("pending is not a resolution target"),
    };

    let approval = state.approvals.resolve(approval_id, status)?;
    Ok((approval, action))
}

fn validate_resolution_target(status: ApprovalStatus) -> Result<(), String> {
    if matches!(
        status,
        ApprovalStatus::Approved | ApprovalStatus::Rejected | ApprovalStatus::Expired
    ) {
        Ok(())
    } else {
        Err("approval can only resolve to approved, rejected, or expired".to_string())
    }
}

fn approval_status_label(status: ApprovalStatus) -> &'static str {
    match status {
        ApprovalStatus::Pending => "pending",
        ApprovalStatus::Approved => "approved",
        ApprovalStatus::Rejected => "rejected",
        ApprovalStatus::Expired => "expired",
    }
}

pub fn restore_approvals(
    approvals: &[ApprovalRequest],
    actions: &[Action],
) -> Vec<ApprovalRequest> {
    let action_by_id = actions
        .iter()
        .map(|action| (action.id.as_str(), action))
        .collect::<HashMap<_, _>>();
    prune_approval_history_for_persistence(
        approvals
            .iter()
            .cloned()
            .map(|mut approval| {
                if approval.status == ApprovalStatus::Pending {
                    if let Some(action_id) = approval.action_id.as_deref() {
                        match action_by_id.get(action_id) {
                            Some(action) if action.status == ActionStatus::PendingApproval => {}
                            _ => {
                                approval.status = ApprovalStatus::Rejected;
                                approval.resolved_at = Some(now_ms());
                            }
                        }
                    }
                }
                approval
            })
            .collect(),
        actions,
    )
}

pub fn prune_approval_history_for_persistence(
    approvals: Vec<ApprovalRequest>,
    actions: &[Action],
) -> Vec<ApprovalRequest> {
    let linked_approval_ids = actions
        .iter()
        .filter_map(|action| action.approval_id.as_deref())
        .collect::<std::collections::HashSet<_>>();
    let mut normalized = approvals;
    let mut terminal = normalized
        .iter()
        .filter(|approval| {
            approval.status != ApprovalStatus::Pending
                && !linked_approval_ids.contains(approval.id.as_str())
        })
        .map(|approval| approval.id.clone())
        .collect::<Vec<_>>();

    if terminal.len() > MAX_PERSISTED_APPROVALS {
        terminal.sort_by_key(|id| {
            std::cmp::Reverse(
                normalized
                    .iter()
                    .find(|approval| approval.id == *id)
                    .map(|approval| approval.resolved_at.unwrap_or(approval.created_at))
                    .unwrap_or_default(),
            )
        });
        let keep_terminal = terminal
            .into_iter()
            .take(MAX_PERSISTED_APPROVALS)
            .collect::<std::collections::HashSet<_>>();
        normalized.retain(|approval| {
            approval.status == ApprovalStatus::Pending
                || linked_approval_ids.contains(approval.id.as_str())
                || keep_terminal.contains(&approval.id)
        });
    }

    normalized.sort_by_key(|approval| approval.created_at);
    normalized
}

fn approval_matches_filter(approval: &ApprovalRequest, filter: &ApprovalListFilter) -> bool {
    if filter.pending_only.unwrap_or(false) && approval.status != ApprovalStatus::Pending {
        return false;
    }
    filter
        .employee_id
        .as_deref()
        .map(|employee_id| approval.employee_id == employee_id)
        .unwrap_or(true)
        && filter
            .status
            .map(|status| approval.status == status)
            .unwrap_or(true)
        && filter
            .kind
            .map(|kind| approval.kind == kind)
            .unwrap_or(true)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::{ActionCreateRequest, ActionKind, ActionManager, ActionStatus};

    fn approval_payload(action_id: Option<String>) -> ApprovalCreateRequest {
        ApprovalCreateRequest {
            employee_id: "employee-1".to_string(),
            action_id,
            kind: ApprovalKind::ShellCommand,
            title: "Approve command".to_string(),
            description: "Approve test command".to_string(),
            command: Some("pwd".to_string()),
            path: None,
            cwd: None,
        }
    }

    fn action_payload() -> ActionCreateRequest {
        ActionCreateRequest {
            employee_id: "employee-1".to_string(),
            kind: ActionKind::ShellCommand,
            title: "Run command".to_string(),
            description: "Run pwd".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
            path: None,
            contents: None,
            timeout_secs: None,
        }
    }

    #[test]
    fn approving_pending_approval_works() {
        let approvals = ApprovalManager::default();
        let approval = approvals.create(approval_payload(None));

        let updated = approvals
            .resolve(&approval.id, ApprovalStatus::Approved)
            .unwrap();

        assert_eq!(updated.status, ApprovalStatus::Approved);
        assert!(updated.resolved_at.is_some());
    }

    #[test]
    fn approving_already_rejected_approval_fails() {
        let approvals = ApprovalManager::default();
        let approval = approvals.create(approval_payload(None));
        approvals
            .resolve(&approval.id, ApprovalStatus::Rejected)
            .unwrap();

        let error = approvals
            .resolve(&approval.id, ApprovalStatus::Approved)
            .unwrap_err();

        assert!(error.contains("already rejected"));
    }

    #[test]
    fn approval_manager_lists_filters_and_gets_approvals() {
        let approvals = ApprovalManager::default();
        let first = approvals.create(approval_payload(None));
        let mut second_payload = approval_payload(None);
        second_payload.employee_id = "employee-2".to_string();
        second_payload.kind = ApprovalKind::FileWrite;
        let second = approvals.create(second_payload);
        approvals
            .resolve(&second.id, ApprovalStatus::Rejected)
            .unwrap();

        let pending = approvals.list(Some(&ApprovalListFilter {
            pending_only: Some(true),
            ..ApprovalListFilter::default()
        }));
        let employee_two = approvals.list(Some(&ApprovalListFilter {
            employee_id: Some("employee-2".to_string()),
            ..ApprovalListFilter::default()
        }));

        assert_eq!(approvals.get(&first.id).unwrap().id, first.id);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, first.id);
        assert_eq!(employee_two.len(), 1);
        assert_eq!(employee_two[0].id, second.id);
    }

    #[test]
    fn rejecting_already_approved_approval_fails() {
        let approvals = ApprovalManager::default();
        let approval = approvals.create(approval_payload(None));
        approvals
            .resolve(&approval.id, ApprovalStatus::Approved)
            .unwrap();

        let error = approvals
            .resolve(&approval.id, ApprovalStatus::Rejected)
            .unwrap_err();

        assert!(error.contains("already approved"));
    }

    #[test]
    fn linked_action_moves_from_pending_approval_to_approved() {
        let actions = ActionManager::default();
        let action = actions.create(action_payload()).unwrap();
        let approvals = ApprovalManager::default();
        let approval = approvals.create(approval_payload(Some(action.id.clone())));
        actions.request_approval(&action.id, &approval.id).unwrap();
        approvals
            .resolve(&approval.id, ApprovalStatus::Approved)
            .unwrap();

        let updated = actions
            .approve_by_approval(&action.id, &approval.id)
            .unwrap();

        assert_eq!(updated.status, ActionStatus::Approved);
    }

    #[test]
    fn linked_action_moves_from_pending_approval_to_rejected() {
        let actions = ActionManager::default();
        let action = actions.create(action_payload()).unwrap();
        let approvals = ApprovalManager::default();
        let approval = approvals.create(approval_payload(Some(action.id.clone())));
        actions.request_approval(&action.id, &approval.id).unwrap();
        approvals
            .resolve(&approval.id, ApprovalStatus::Rejected)
            .unwrap();

        let updated = actions
            .reject_by_approval(&action.id, &approval.id)
            .unwrap();

        assert_eq!(updated.status, ActionStatus::Rejected);
    }

    #[test]
    fn restore_rejects_pending_approval_for_terminal_action() {
        let mut action = ActionManager::default().create(action_payload()).unwrap();
        action.status = ActionStatus::Failed;
        let approval = ApprovalManager::default().create(approval_payload(Some(action.id.clone())));

        let restored = restore_approvals(&[approval], &[action]);

        assert_eq!(restored[0].status, ApprovalStatus::Rejected);
        assert!(restored[0].resolved_at.is_some());
    }

    #[test]
    fn restore_rejects_pending_approval_for_already_approved_action() {
        let mut action = ActionManager::default().create(action_payload()).unwrap();
        action.status = ActionStatus::Approved;
        let approval = ApprovalManager::default().create(approval_payload(Some(action.id.clone())));

        let restored = restore_approvals(&[approval], &[action]);

        assert_eq!(restored[0].status, ApprovalStatus::Rejected);
        assert!(restored[0].resolved_at.is_some());
    }
}
