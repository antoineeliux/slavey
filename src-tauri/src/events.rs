use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    actions::Action,
    approvals::ApprovalRequest,
    employees::Employee,
    processes::{ManagedProcess, ProcessLogs},
    terminal::TerminalSessionRecord,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataPayload {
    pub employee_id: String,
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionUpdatedPayload {
    pub session: TerminalSessionRecord,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeUpdatedPayload {
    pub employee: Employee,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogPayload {
    pub id: String,
    pub level: LogLevel,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalUpdatedPayload {
    pub approval: ApprovalRequest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionUpdatedPayload {
    pub action: Action,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUpdatedPayload {
    pub process: ManagedProcess,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivityUpdatedPayload {
    pub employee_id: Option<String>,
}

pub fn emit_terminal_data(
    app: &AppHandle,
    employee_id: impl Into<String>,
    session_id: impl Into<String>,
    data: String,
) {
    let payload = TerminalDataPayload {
        employee_id: employee_id.into(),
        session_id: session_id.into(),
        data,
    };
    let _ = app.emit("terminal:data", payload);
}

pub fn emit_terminal_session_updated(app: &AppHandle, session: TerminalSessionRecord) {
    let employee_id = session.employee_id.clone();
    let _ = app.emit(
        "terminal:session-updated",
        TerminalSessionUpdatedPayload { session },
    );
    emit_employee_activity_updated(app, Some(employee_id));
}

pub fn emit_employee_updated(app: &AppHandle, employee: Employee) {
    let employee_id = employee.id.clone();
    let _ = app.emit("employee:updated", EmployeeUpdatedPayload { employee });
    emit_employee_activity_updated(app, Some(employee_id));
}

pub fn emit_approval_updated(app: &AppHandle, approval: ApprovalRequest) {
    let employee_id = approval.employee_id.clone();
    let _ = app.emit("approval:updated", ApprovalUpdatedPayload { approval });
    emit_employee_activity_updated(app, Some(employee_id));
}

pub fn emit_action_updated(app: &AppHandle, action: Action) {
    let employee_id = action.employee_id.clone();
    let _ = app.emit("action:updated", ActionUpdatedPayload { action });
    emit_employee_activity_updated(app, Some(employee_id));
}

pub fn emit_process_updated(app: &AppHandle, process: ManagedProcess) {
    let employee_id = process.employee_id.clone();
    let _ = app.emit("process:updated", ProcessUpdatedPayload { process });
    if let Some(employee_id) = employee_id {
        emit_employee_activity_updated(app, Some(employee_id));
    }
}

pub fn emit_process_log(app: &AppHandle, payload: ProcessLogs) {
    let _ = app.emit("process:log", payload);
}

pub fn emit_log(app: &AppHandle, level: LogLevel, message: impl Into<String>) {
    let payload = AppLogPayload {
        id: uuid::Uuid::new_v4().to_string(),
        level,
        message: message.into(),
        timestamp: now_ms(),
    };
    let _ = app.emit("app:log", payload);
}

pub fn emit_employee_activity_updated(app: &AppHandle, employee_id: Option<String>) {
    let _ = app.emit(
        "employee:activity-updated",
        EmployeeActivityUpdatedPayload { employee_id },
    );
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
