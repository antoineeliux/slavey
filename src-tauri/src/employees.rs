use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    actions::{ActionKind, ActionManager},
    approvals::ApprovalManager,
    events::{
        emit_employee_activity_updated, emit_employee_updated, emit_log,
        emit_terminal_session_updated, now_ms, LogLevel,
    },
    fs::resolve_existing_dir,
    persistence::{AppStateSnapshotInput, PersistenceManager},
    processes::ProcessManager,
    read_workspace_root,
    terminal::{
        codex_program_from_settings, TerminalLaunchProfile, TerminalProfileSessionRequest,
        TerminalSessionRuntime, TerminalSessionStatus, TerminalSessionStore, DEFAULT_PTY_SIZE,
    },
    AppState, WorkspaceRootHandle,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeStatus {
    Idle,
    Starting,
    Running,
    Standby,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeWorkingFolderRequest {
    pub employee_id: String,
    pub path: String,
}

#[derive(Clone, Default)]
pub struct EmployeeManager {
    employees: Arc<Mutex<HashMap<String, Employee>>>,
}

#[derive(Clone)]
struct TerminalPersistContext {
    workspace_root: WorkspaceRootHandle,
    employees: EmployeeManager,
    terminal_sessions: TerminalSessionStore,
    actions: ActionManager,
    approvals: ApprovalManager,
    processes: ProcessManager,
    persistence: PersistenceManager,
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

    let workspace_root = state.workspace_root();
    let cwd = match payload.cwd {
        Some(cwd) if !cwd.trim().is_empty() => resolve_existing_dir(&workspace_root, &cwd)?,
        _ => workspace_root,
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
    let Some(employee) = state.employees.get(&employee_id) else {
        return Ok(());
    };
    ensure_employee_can_remove(&employee)?;

    if let Some(removed) = state.employees.remove(&employee_id) {
        if let Some(session_id) = removed.terminal_session_id {
            stop_employee_session_runtime(&state, &removed.id, &session_id, &app);
            if let Some(record) = state.terminal_sessions.stop(&session_id) {
                state.agent_runtime.sync_from_terminal_session(&record);
                emit_terminal_session_updated(&app, record);
            }
        }
        emit_log(
            &app,
            LogLevel::Info,
            format!("removed employee {}", removed.name),
        );
        emit_employee_activity_updated(&app, Some(employee_id));
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
    start_terminal_with_profile(app, state, employee_id, TerminalLaunchProfile::Shell)
}

#[tauri::command]
pub fn employee_set_working_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: EmployeeWorkingFolderRequest,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&payload.employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let workspace_root = state.workspace_root();
    let cwd = resolve_employee_execution_dir(&workspace_root, &employee, Some(&payload.path))?;
    let cwd_label = cwd.to_string_lossy().to_string();
    let updated = state
        .employees
        .update(&payload.employee_id, |employee| {
            employee.cwd = cwd_label.clone();
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("set {} working folder to {}", updated.name, updated.cwd),
    );
    emit_employee_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn employee_set_standby(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let updated = state
        .employees
        .update(&employee_id, |employee| {
            employee.status = EmployeeStatus::Standby;
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("put {} on standby", updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

#[tauri::command]
pub fn employee_resume_from_standby(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let updated = state
        .employees
        .update(&employee_id, |employee| {
            resume_employee_from_standby(employee, &state.terminal_sessions);
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("resumed {} from standby", updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    persist_or_log(&app, &state);
    Ok(updated)
}

fn start_terminal_with_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    profile: TerminalLaunchProfile,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;

    if employee.terminal_session_id.is_some() {
        return Ok(employee);
    }

    let workspace_root = state.workspace_root();
    let cwd = resolve_employee_execution_dir(&workspace_root, &employee, None)?;
    let record_cwd = cwd.to_string_lossy().to_string();
    let starting = state
        .employees
        .update(&employee_id, |employee| {
            mark_terminal_starting(employee, profile);
        })
        .ok_or_else(|| "employee not found".to_string())?;
    emit_employee_updated(&app, starting);

    let session_id = format!("term-{}", Uuid::new_v4());
    let codex_program = codex_program_from_settings(&state.persistence.settings());
    let session_record = state.terminal_sessions.create(
        session_id.clone(),
        employee_id.clone(),
        profile,
        record_cwd,
    );
    state
        .agent_runtime
        .sync_from_terminal_session(&session_record);
    let employees = state.employees.clone();
    let terminal_sessions = state.terminal_sessions.clone();
    let agent_runtime = state.agent_runtime.clone();
    let output_app = app.clone();
    let output_terminal_sessions = state.terminal_sessions.clone();
    let on_output = Arc::new(move |session_id: &str, output: &str| {
        if let Some(record) = output_terminal_sessions.record_output(session_id, output) {
            agent_runtime.sync_from_terminal_session(&record);
            emit_terminal_session_updated(&output_app, record);
        }
    });
    let active_profile_app = app.clone();
    let active_profile_terminal_sessions = state.terminal_sessions.clone();
    let active_profile_agent_runtime = state.agent_runtime.clone();
    let on_active_profile_changed = Arc::new(
        move |session_id: &str, active_profile: TerminalLaunchProfile| {
            if let Some(record) =
                active_profile_terminal_sessions.set_active_profile(session_id, active_profile)
            {
                active_profile_agent_runtime.sync_from_terminal_session(&record);
                emit_terminal_session_updated(&active_profile_app, record);
            }
        },
    );
    let cwd_app = app.clone();
    let cwd_terminal_sessions = state.terminal_sessions.clone();
    let on_cwd_changed = Arc::new(move |session_id: &str, cwd: &str| {
        if let Some(record) = cwd_terminal_sessions.set_current_cwd(session_id, cwd) {
            emit_terminal_session_updated(&cwd_app, record);
        }
    });
    let notify_app = app.clone();
    let notify_terminal_sessions = state.terminal_sessions.clone();
    let notify_agent_runtime = state.agent_runtime.clone();
    let on_codex_turn_complete = Arc::new(move |session_id: &str, event_at: u64| {
        if let Some(record) =
            notify_terminal_sessions.record_codex_notify_agent_turn_complete(session_id, event_at)
        {
            notify_agent_runtime.sync_from_terminal_session(&record);
            emit_terminal_session_updated(&notify_app, record);
        }
    });
    let exit_app = app.clone();
    let exit_employee_id = employee_id.clone();
    let exit_session_id = session_id.clone();
    let exit_agent_runtime = state.agent_runtime.clone();
    let exit_persist_context = TerminalPersistContext {
        workspace_root: state.workspace_root_handle(),
        employees: state.employees.clone(),
        terminal_sessions: state.terminal_sessions.clone(),
        actions: state.actions.clone(),
        approvals: state.approvals.clone(),
        processes: state.processes.clone(),
        persistence: state.persistence.clone(),
    };

    let launch_result = state
        .terminal
        .create_profile_session(TerminalProfileSessionRequest {
            app: app.clone(),
            employee_id: employee_id.clone(),
            session_id: session_id.clone(),
            cwd,
            size: DEFAULT_PTY_SIZE,
            profile,
            codex_program,
            on_output,
            on_active_profile_changed,
            on_cwd_changed,
            on_codex_turn_complete,
            on_exit: move |exit_code| {
                let exit_code_i32 = i32::try_from(exit_code).unwrap_or(i32::MAX);
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

                if let Some(record) = terminal_sessions.finish(&exit_session_id, exit_code_i32) {
                    exit_agent_runtime.sync_from_terminal_session(&record);
                    emit_terminal_session_updated(&exit_app, record);
                }

                emit_log(
                    &exit_app,
                    LogLevel::Info,
                    format!(
                        "terminal session {} exited with code {}",
                        exit_session_id, exit_code
                    ),
                );
                persist_terminal_snapshot_or_log(&exit_app, &exit_persist_context);
            },
        });

    if let Err(error) = launch_result {
        if let Some(record) = state.terminal_sessions.fail_start(
            &session_id,
            format!("failed to start {} terminal", profile.current_command()),
        ) {
            state.agent_runtime.sync_from_terminal_session(&record);
            emit_terminal_session_updated(&app, record);
        }
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
            format!(
                "failed to start {} terminal: {error}",
                profile.current_command()
            ),
        );
        persist_or_log(&app, &state);
        return Err(error.to_string());
    }

    let running = state
        .employees
        .update(&employee_id, |employee| {
            mark_terminal_running(employee, &session_id, profile);
        })
        .ok_or_else(|| "employee not found".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!(
            "started {} terminal for {}",
            profile.current_command(),
            running.name
        ),
    );
    emit_employee_updated(&app, running.clone());
    emit_terminal_session_updated(&app, session_record);
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

    if let Some(session_id) = employee.terminal_session_id.clone() {
        stop_employee_session_runtime(&state, &employee_id, &session_id, &app);
        if let Some(record) = state.terminal_sessions.stop(&session_id) {
            state.agent_runtime.sync_from_terminal_session(&record);
            emit_terminal_session_updated(&app, record);
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

fn stop_employee_session_runtime(
    state: &State<'_, AppState>,
    employee_id: &str,
    session_id: &str,
    app: &AppHandle,
) {
    let runtime = state
        .terminal_sessions
        .get(session_id)
        .map(|session| session.runtime)
        .unwrap_or(TerminalSessionRuntime::Pty);
    if runtime == TerminalSessionRuntime::CodexAppServer {
        state.codex_app_server.stop_session(session_id);
        return;
    }
    if let Err(error) = state
        .terminal
        .kill_session_for_employee(employee_id, session_id)
    {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to kill terminal session {session_id}: {error}"),
        );
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

fn persist_terminal_snapshot_or_log(app: &AppHandle, context: &TerminalPersistContext) {
    if let Err(error) = persist_terminal_snapshot(context) {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist terminal state: {error}"),
        );
    }
}

fn persist_terminal_snapshot(context: &TerminalPersistContext) -> Result<(), String> {
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

fn ensure_employee_can_remove(employee: &Employee) -> Result<(), String> {
    if employee.worktree_path.is_some() {
        Err(
            "employee has a worktree; remove or archive the worktree before deleting employee"
                .to_string(),
        )
    } else {
        Ok(())
    }
}

fn mark_terminal_starting(employee: &mut Employee, profile: TerminalLaunchProfile) {
    employee.status = EmployeeStatus::Starting;
    employee.current_command = Some(profile.current_command().to_string());
}

fn mark_terminal_running(
    employee: &mut Employee,
    session_id: &str,
    profile: TerminalLaunchProfile,
) {
    employee.status = EmployeeStatus::Running;
    employee.terminal_session_id = Some(session_id.to_string());
    employee.current_command = Some(profile.current_command().to_string());
}

fn resume_employee_from_standby(employee: &mut Employee, terminal_sessions: &TerminalSessionStore) {
    if let Some(session_id) = employee.terminal_session_id.as_deref() {
        if let Some(session) = terminal_sessions.get(session_id) {
            if session.status == TerminalSessionStatus::Running {
                let profile = session.active_profile.unwrap_or(session.profile);
                employee.status = EmployeeStatus::Running;
                employee.current_command = Some(profile.current_command().to_string());
                return;
            }
        }
    }

    employee.status = EmployeeStatus::Idle;
    employee.terminal_session_id = None;
    employee.current_command = None;
}

pub fn resolve_employee_execution_dir(
    workspace_root: &Path,
    employee: &Employee,
    explicit_cwd: Option<&str>,
) -> Result<PathBuf, String> {
    let explicit_cwd = explicit_cwd.map(str::trim).filter(|cwd| !cwd.is_empty());

    if let Some(worktree_path) = employee
        .worktree_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let worktree = resolve_existing_dir(workspace_root, worktree_path)
            .map_err(|_| "employee worktree is not available".to_string())?;

        if let Some(cwd) = explicit_cwd {
            let resolved = resolve_existing_dir(workspace_root, cwd)?;
            if resolved.starts_with(&worktree) {
                return Ok(resolved);
            }
            return Err(
                "employee has an isolated worktree; cwd must be inside the worktree".to_string(),
            );
        }

        if let Ok(cwd) = resolve_existing_dir(workspace_root, &employee.cwd) {
            if cwd.starts_with(&worktree) {
                return Ok(cwd);
            }
        }

        return Ok(worktree);
    }

    if let Some(cwd) = explicit_cwd {
        return resolve_existing_dir(workspace_root, cwd);
    }

    resolve_existing_dir(workspace_root, &employee.cwd)
        .or_else(|_| Ok(workspace_root.to_path_buf()))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs as std_fs;

    fn sample_employee(worktree_path: Option<String>) -> Employee {
        Employee {
            id: "employee-1".to_string(),
            name: "Employee 1".to_string(),
            role: EmployeeRole::General,
            status: EmployeeStatus::Idle,
            cwd: "/tmp/workspace".to_string(),
            worktree_path,
            branch_name: None,
            terminal_session_id: None,
            current_command: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn sample_employee_with_cwd(cwd: PathBuf, worktree_path: Option<PathBuf>) -> Employee {
        let mut employee =
            sample_employee(worktree_path.map(|path| path.to_string_lossy().to_string()));
        employee.cwd = cwd.to_string_lossy().to_string();
        employee
    }

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("slavey-employee-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn employee_without_worktree_can_be_removed() {
        assert!(ensure_employee_can_remove(&sample_employee(None)).is_ok());
    }

    #[test]
    fn employee_with_worktree_cannot_be_removed() {
        let error = ensure_employee_can_remove(&sample_employee(Some(
            "/tmp/workspace/.slavey/worktrees/employee-1".to_string(),
        )))
        .unwrap_err();

        assert!(error.contains("employee has a worktree"));
    }

    #[test]
    fn shell_starting_state_sets_shell_current_command() {
        let mut employee = sample_employee(None);

        mark_terminal_starting(&mut employee, TerminalLaunchProfile::Shell);

        assert_eq!(employee.status, EmployeeStatus::Starting);
        assert_eq!(employee.current_command.as_deref(), Some("shell"));
    }

    #[test]
    fn codex_running_state_sets_codex_current_command() {
        let mut employee = sample_employee(None);

        mark_terminal_running(&mut employee, "term-1", TerminalLaunchProfile::Codex);

        assert_eq!(employee.status, EmployeeStatus::Running);
        assert_eq!(employee.terminal_session_id.as_deref(), Some("term-1"));
        assert_eq!(employee.current_command.as_deref(), Some("codex"));
    }

    #[test]
    fn resume_from_standby_restores_running_terminal_command() {
        let mut employee = sample_employee(None);
        employee.status = EmployeeStatus::Standby;
        employee.terminal_session_id = Some("term-1".to_string());
        employee.current_command = Some("shell".to_string());
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.set_active_profile("term-1", TerminalLaunchProfile::Codex);

        resume_employee_from_standby(&mut employee, &store);

        assert_eq!(employee.status, EmployeeStatus::Running);
        assert_eq!(employee.terminal_session_id.as_deref(), Some("term-1"));
        assert_eq!(employee.current_command.as_deref(), Some("codex"));
    }

    #[test]
    fn execution_dir_without_worktree_uses_employee_cwd() {
        let root = test_root("exec-cwd");
        let cwd = root.join("project");
        std_fs::create_dir_all(&cwd).unwrap();
        let employee = sample_employee_with_cwd(cwd.clone(), None);

        let resolved = resolve_employee_execution_dir(&root, &employee, None).unwrap();

        assert_eq!(resolved, cwd);
    }

    #[test]
    fn execution_dir_without_worktree_falls_back_to_workspace_root() {
        let root = test_root("exec-root");
        let employee = sample_employee_with_cwd(root.join("missing"), None);

        let resolved = resolve_employee_execution_dir(&root, &employee, None).unwrap();

        assert_eq!(resolved, root);
    }

    #[test]
    fn execution_dir_with_worktree_defaults_to_worktree() {
        let root = test_root("exec-worktree");
        let cwd = root.join("project");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&cwd).unwrap();
        std_fs::create_dir_all(&worktree).unwrap();
        let employee = sample_employee_with_cwd(cwd, Some(worktree.clone()));

        let resolved = resolve_employee_execution_dir(&root, &employee, None).unwrap();

        assert_eq!(resolved, worktree);
    }

    #[test]
    fn execution_dir_with_worktree_uses_employee_cwd_inside_worktree() {
        let root = test_root("exec-worktree-cwd");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        let nested = worktree.join("packages").join("app");
        std_fs::create_dir_all(&nested).unwrap();
        let employee = sample_employee_with_cwd(nested.clone(), Some(worktree));

        let resolved = resolve_employee_execution_dir(&root, &employee, None).unwrap();

        assert_eq!(resolved, nested);
    }

    #[test]
    fn execution_dir_with_worktree_accepts_explicit_cwd_inside_worktree() {
        let root = test_root("exec-worktree-explicit");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        let nested = worktree.join("packages").join("app");
        std_fs::create_dir_all(&nested).unwrap();
        let employee = sample_employee_with_cwd(root.clone(), Some(worktree));

        let resolved =
            resolve_employee_execution_dir(&root, &employee, Some(nested.to_str().unwrap()))
                .unwrap();

        assert_eq!(resolved, nested);
    }

    #[test]
    fn execution_dir_with_worktree_rejects_explicit_cwd_outside_worktree() {
        let root = test_root("exec-worktree-reject");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        let outside = root.join("src");
        std_fs::create_dir_all(&worktree).unwrap();
        std_fs::create_dir_all(&outside).unwrap();
        let employee = sample_employee_with_cwd(root.clone(), Some(worktree));

        let error =
            resolve_employee_execution_dir(&root, &employee, Some(outside.to_str().unwrap()))
                .unwrap_err();

        assert!(error.contains("cwd must be inside the worktree"));
    }
}
