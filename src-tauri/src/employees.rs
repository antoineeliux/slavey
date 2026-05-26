use std::{collections::HashMap, path::PathBuf, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    actions::ActionKind,
    events::{emit_employee_updated, emit_log, now_ms, LogLevel},
    fs::resolve_existing_dir,
    terminal::DEFAULT_PTY_SIZE,
    AppState,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeStatus {
    Idle,
    Starting,
    Running,
    WaitingApproval,
    Blocked,
    Done,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeRole {
    Frontend,
    Backend,
    Reviewer,
    Tester,
    General,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePolicy {
    pub role: EmployeeRole,
    pub default_action_kinds: Vec<ActionKind>,
    pub requires_approval_for_shell: bool,
    pub requires_approval_for_file_write: bool,
    pub can_review: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Employee {
    pub id: String,
    pub name: String,
    pub role: EmployeeRole,
    pub status: EmployeeStatus,
    pub cwd: String,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub terminal_session_id: Option<String>,
    pub current_command: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeCreateRequest {
    pub name: String,
    pub role: EmployeeRole,
    pub cwd: Option<String>,
}

#[derive(Clone, Default)]
pub struct EmployeeManager {
    employees: Arc<Mutex<HashMap<String, Employee>>>,
}

impl EmployeeManager {
    pub fn create(&self, name: String, role: EmployeeRole, cwd: PathBuf) -> Employee {
        let now = now_ms();
        let employee = Employee {
            id: Uuid::new_v4().to_string(),
            name,
            role,
            status: EmployeeStatus::Idle,
            cwd: cwd.to_string_lossy().to_string(),
            worktree_path: None,
            branch_name: None,
            terminal_session_id: None,
            current_command: None,
            created_at: now,
            updated_at: now,
        };
        self.employees
            .lock()
            .insert(employee.id.clone(), employee.clone());
        employee
    }

    pub fn list(&self) -> Vec<Employee> {
        let mut employees = self
            .employees
            .lock()
            .values()
            .cloned()
            .collect::<Vec<Employee>>();
        employees.sort_by_key(|employee| employee.created_at);
        employees
    }

    pub fn get(&self, id: &str) -> Option<Employee> {
        self.employees.lock().get(id).cloned()
    }

    pub fn replace_all(&self, employees: Vec<Employee>) {
        let mut next = HashMap::new();
        for employee in employees {
            next.insert(employee.id.clone(), employee);
        }
        *self.employees.lock() = next;
    }

    pub fn update<F>(&self, id: &str, update: F) -> Option<Employee>
    where
        F: FnOnce(&mut Employee),
    {
        let mut employees = self.employees.lock();
        let employee = employees.get_mut(id)?;
        update(employee);
        employee.updated_at = now_ms();
        Some(employee.clone())
    }

    pub fn remove(&self, id: &str) -> Option<Employee> {
        self.employees.lock().remove(id)
    }
}

#[tauri::command]
pub fn employee_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: EmployeeCreateRequest,
) -> Result<Employee, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("employee name is required".to_string());
    }

    let cwd = match payload.cwd {
        Some(cwd) if !cwd.trim().is_empty() => resolve_existing_dir(&state.workspace_root, &cwd)?,
        _ => state.workspace_root.clone(),
    };

    let employee = state.employees.create(name.to_string(), payload.role, cwd);
    emit_log(
        &app,
        LogLevel::Info,
        format!("created employee {}", employee.name),
    );
    emit_employee_updated(&app, employee.clone());
    persist_or_log(&app, &state);
    Ok(employee)
}

#[tauri::command]
pub fn employee_list(state: State<'_, AppState>) -> Vec<Employee> {
    state.employees.list()
}

#[tauri::command]
pub fn employee_role_policies() -> Vec<RolePolicy> {
    default_role_policies()
}

#[tauri::command]
pub fn employee_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<(), String> {
    if let Some(employee) = state.employees.remove(&employee_id) {
        if let Some(session_id) = employee.terminal_session_id {
            let _ = state.terminal.kill_session(&session_id);
        }
        emit_log(
            &app,
            LogLevel::Info,
            format!("removed employee {}", employee.name),
        );
        persist_or_log(&app, &state);
    }
    Ok(())
}

#[tauri::command]
pub fn employee_start_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;

    if employee.terminal_session_id.is_some() {
        return Ok(employee);
    }

    let cwd = resolve_existing_dir(&state.workspace_root, &employee.cwd)?;
    let starting = state
        .employees
        .update(&employee_id, |employee| {
            employee.status = EmployeeStatus::Starting;
            employee.current_command = Some("shell".to_string());
        })
        .ok_or_else(|| "employee not found".to_string())?;
    emit_employee_updated(&app, starting);

    let session_id = format!("term-{}", Uuid::new_v4());
    let employees = state.employees.clone();
    let exit_app = app.clone();
    let exit_employee_id = employee_id.clone();
    let exit_session_id = session_id.clone();

    let launch_result = state.terminal.create_shell_session(
        app.clone(),
        employee_id.clone(),
        session_id.clone(),
        cwd,
        DEFAULT_PTY_SIZE,
        move |exit_code| {
            let next_status = if exit_code == 0 {
                EmployeeStatus::Done
            } else {
                EmployeeStatus::Failed
            };

            if let Some(updated) = employees.update(&exit_employee_id, |employee| {
                if employee.terminal_session_id.as_deref() == Some(exit_session_id.as_str()) {
                    if employee.status != EmployeeStatus::Stopped {
                        employee.status = next_status;
                    }
                    employee.terminal_session_id = None;
                    employee.current_command = None;
                }
            }) {
                emit_employee_updated(&exit_app, updated);
            }

            emit_log(
                &exit_app,
                LogLevel::Info,
                format!(
                    "terminal session {} exited with code {}",
                    exit_session_id, exit_code
                ),
            );
        },
    );

    if let Err(error) = launch_result {
        let failed = state
            .employees
            .update(&employee_id, |employee| {
                employee.status = EmployeeStatus::Failed;
                employee.current_command = None;
                employee.terminal_session_id = None;
            })
            .ok_or_else(|| "employee not found".to_string())?;
        emit_employee_updated(&app, failed);
        emit_log(
            &app,
            LogLevel::Error,
            format!("failed to start terminal: {error}"),
        );
        return Err(error.to_string());
    }

    let running = state
        .employees
        .update(&employee_id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.terminal_session_id = Some(session_id.clone());
            employee.current_command = Some("shell".to_string());
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("started terminal for {}", running.name),
    );
    emit_employee_updated(&app, running.clone());
    persist_or_log(&app, &state);
    Ok(running)
}

#[tauri::command]
pub fn employee_stop_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;

    if let Some(session_id) = employee.terminal_session_id {
        if let Err(error) = state.terminal.kill_session(&session_id) {
            emit_log(
                &app,
                LogLevel::Warn,
                format!("failed to kill terminal session {session_id}: {error}"),
            );
        }
    }

    let updated = state
        .employees
        .update(&employee_id, |employee| {
            employee.status = EmployeeStatus::Stopped;
            employee.current_command = None;
            employee.terminal_session_id = None;
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("stopped terminal for {}", updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
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

fn default_role_policies() -> Vec<RolePolicy> {
    vec![
        RolePolicy {
            role: EmployeeRole::Frontend,
            default_action_kinds: vec![ActionKind::ShellCommand, ActionKind::FileWrite],
            requires_approval_for_shell: true,
            requires_approval_for_file_write: true,
            can_review: false,
        },
        RolePolicy {
            role: EmployeeRole::Backend,
            default_action_kinds: vec![
                ActionKind::ShellCommand,
                ActionKind::FileWrite,
                ActionKind::GitOperation,
            ],
            requires_approval_for_shell: true,
            requires_approval_for_file_write: true,
            can_review: false,
        },
        RolePolicy {
            role: EmployeeRole::Reviewer,
            default_action_kinds: vec![ActionKind::GitOperation],
            requires_approval_for_shell: true,
            requires_approval_for_file_write: true,
            can_review: true,
        },
        RolePolicy {
            role: EmployeeRole::Tester,
            default_action_kinds: vec![ActionKind::ShellCommand, ActionKind::FileWrite],
            requires_approval_for_shell: true,
            requires_approval_for_file_write: true,
            can_review: false,
        },
        RolePolicy {
            role: EmployeeRole::General,
            default_action_kinds: vec![
                ActionKind::ShellCommand,
                ActionKind::FileWrite,
                ActionKind::GitOperation,
            ],
            requires_approval_for_shell: true,
            requires_approval_for_file_write: true,
            can_review: false,
        },
    ]
}
