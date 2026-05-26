use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
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
        let now = now_ms();
        let approval = ApprovalRequest {
            id: Uuid::new_v4().to_string(),
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

    pub fn resolve(&self, id: &str, status: ApprovalStatus) -> Option<ApprovalRequest> {
        let mut approvals = self.approvals.lock();
        let approval = approvals.get_mut(id)?;
        approval.status = status;
        approval.resolved_at = Some(now_ms());
        Some(approval.clone())
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
    let approval = state
        .approvals
        .resolve(&approval_id, ApprovalStatus::Approved)
        .ok_or_else(|| "approval not found".to_string())?;
    if let Some(action) = state.actions.approve_by_approval(&approval.id) {
        emit_action_updated(&app, action);
    }
    emit_log(
        &app,
        LogLevel::Info,
        format!("approved request {}", approval.title),
    );
    emit_approval_updated(&app, approval.clone());
    Ok(approval)
}

#[tauri::command]
pub fn approval_reject(
    app: AppHandle,
    state: State<'_, AppState>,
    approval_id: String,
) -> Result<ApprovalRequest, String> {
    let approval = state
        .approvals
        .resolve(&approval_id, ApprovalStatus::Rejected)
        .ok_or_else(|| "approval not found".to_string())?;
    if let Some(action) = state.actions.reject_by_approval(&approval.id) {
        emit_action_updated(&app, action);
    }
    emit_log(
        &app,
        LogLevel::Info,
        format!("rejected request {}", approval.title),
    );
    emit_approval_updated(&app, approval.clone());
    Ok(approval)
}
