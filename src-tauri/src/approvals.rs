use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    actions::Action,
    events::{emit_action_updated, emit_approval_updated, emit_log, now_ms, LogLevel},
    AppState,
};

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

    pub fn list(&self) -> Vec<ApprovalRequest> {
        let mut approvals = self
            .approvals
            .lock()
            .values()
            .cloned()
            .collect::<Vec<ApprovalRequest>>();
        approvals.sort_by_key(|approval| approval.created_at);
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
pub fn approval_list(state: State<'_, AppState>) -> Vec<ApprovalRequest> {
    state.approvals.list()
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
}
