use std::{
    fs as std_fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    actions::Action,
    approvals::ApprovalRequest,
    employees::{Employee, EmployeeStatus},
    events::now_ms,
    fs::resolve_existing_dir,
    processes::{ManagedProcess, ProcessLogSnapshot},
    terminal::TerminalSessionRecord,
    AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistentAppState {
    #[serde(default)]
    pub workspace_root: String,
    #[serde(default)]
    pub employees: Vec<Employee>,
    #[serde(default)]
    pub terminal_sessions: Vec<TerminalSessionRecord>,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub approvals: Vec<ApprovalRequest>,
    #[serde(default)]
    pub processes: Vec<ManagedProcess>,
    #[serde(default)]
    pub process_logs: Vec<ProcessLogSnapshot>,
    #[serde(default)]
    pub selected_employee_id: Option<String>,
    #[serde(default)]
    pub active_tab: Option<String>,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSaveRequest {
    pub selected_employee_id: Option<String>,
    pub active_tab: Option<String>,
    pub recent_files: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct PersistentUiState {
    selected_employee_id: Option<String>,
    active_tab: Option<String>,
    recent_files: Vec<String>,
}

#[derive(Clone)]
pub struct PersistenceManager {
    path: PathBuf,
    ui_state: Arc<Mutex<PersistentUiState>>,
}

impl PersistenceManager {
    pub fn new(path: PathBuf, loaded: Option<&PersistentAppState>) -> Self {
        let ui_state = loaded
            .map(|state| PersistentUiState {
                selected_employee_id: state.selected_employee_id.clone(),
                active_tab: state.active_tab.clone(),
                recent_files: state.recent_files.clone(),
            })
            .unwrap_or_default();

        Self {
            path,
            ui_state: Arc::new(Mutex::new(ui_state)),
        }
    }

    pub fn snapshot(
        &self,
        workspace_root: &Path,
        employees: Vec<Employee>,
        terminal_sessions: Vec<TerminalSessionRecord>,
        actions: Vec<Action>,
        approvals: Vec<ApprovalRequest>,
        processes: Vec<ManagedProcess>,
        process_logs: Vec<ProcessLogSnapshot>,
    ) -> PersistentAppState {
        let ui_state = self.ui_state.lock();
        PersistentAppState {
            workspace_root: workspace_root.to_string_lossy().to_string(),
            employees,
            terminal_sessions,
            actions,
            approvals,
            processes,
            process_logs,
            selected_employee_id: ui_state.selected_employee_id.clone(),
            active_tab: ui_state.active_tab.clone(),
            recent_files: ui_state.recent_files.clone(),
            updated_at: now_ms(),
        }
    }

    pub fn save(
        &self,
        workspace_root: &Path,
        employees: Vec<Employee>,
        terminal_sessions: Vec<TerminalSessionRecord>,
        actions: Vec<Action>,
        approvals: Vec<ApprovalRequest>,
        processes: Vec<ManagedProcess>,
        process_logs: Vec<ProcessLogSnapshot>,
    ) -> Result<(), String> {
        let snapshot = self.snapshot(
            workspace_root,
            employees,
            terminal_sessions,
            actions,
            approvals,
            processes,
            process_logs,
        );
        if let Some(parent) = self.path.parent() {
            std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let contents =
            serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
        atomic_write_json(&self.path, contents.as_bytes())
    }

    pub fn update_ui(&self, request: AppStateSaveRequest) {
        let mut ui_state = self.ui_state.lock();
        ui_state.selected_employee_id = request.selected_employee_id;
        ui_state.active_tab = request.active_tab;
        ui_state.recent_files = request.recent_files;
    }
}

fn atomic_write_json(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "state path has no parent".to_string())?;
    std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "state path has no valid file name".to_string())?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    let result = (|| {
        let mut file = std_fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        std_fs::rename(&temp_path, path).map_err(|error| error.to_string())?;
        if let Ok(parent_dir) = std_fs::File::open(parent) {
            let _ = parent_dir.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = std_fs::remove_file(&temp_path);
    }

    result
}

pub fn load_from_disk(path: &Path) -> Result<Option<PersistentAppState>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = std_fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub fn restore_employees(root: &Path, employees: &[Employee]) -> Vec<Employee> {
    employees
        .iter()
        .cloned()
        .map(|mut employee| {
            let was_active = employee.terminal_session_id.is_some()
                || matches!(
                    employee.status,
                    EmployeeStatus::Starting
                        | EmployeeStatus::Running
                        | EmployeeStatus::WaitingApproval
                );
            employee.status = if was_active {
                EmployeeStatus::Stopped
            } else {
                EmployeeStatus::Idle
            };
            employee.terminal_session_id = None;
            employee.current_command = None;

            employee.cwd = resolve_existing_dir(root, &employee.cwd)
                .unwrap_or_else(|_| root.to_path_buf())
                .to_string_lossy()
                .to_string();

            employee.worktree_path = employee.worktree_path.and_then(|path| {
                resolve_existing_dir(root, &path)
                    .ok()
                    .map(|path| path.to_string_lossy().to_string())
            });

            if employee.worktree_path.is_none() {
                employee.branch_name = None;
            }

            employee
        })
        .collect()
}

#[tauri::command]
pub fn app_state_load(state: State<'_, AppState>) -> PersistentAppState {
    state.snapshot()
}

#[tauri::command]
pub fn app_state_save(
    state: State<'_, AppState>,
    payload: AppStateSaveRequest,
) -> Result<PersistentAppState, String> {
    state.persistence.update_ui(payload);
    state.persist()?;
    Ok(state.snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::{restore_actions, Action, ActionKind, ActionStatus};
    use crate::processes::{restore_managed_processes, ManagedProcess, ManagedProcessStatus};

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "slavey-persistence-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std_fs::create_dir_all(&root).unwrap();
        root
    }

    fn sample_action(status: ActionStatus) -> Action {
        Action {
            id: "action-1".to_string(),
            employee_id: "employee-1".to_string(),
            kind: ActionKind::ShellCommand,
            title: "Run command".to_string(),
            description: "Test command".to_string(),
            cwd: None,
            command: Some("sleep 1".to_string()),
            path: None,
            contents: None,
            timeout_secs: 120,
            approval_id: None,
            status,
            output: String::new(),
            error: None,
            created_at: 1,
            updated_at: 1,
            started_at: Some(2),
            finished_at: None,
        }
    }

    fn sample_process(status: ManagedProcessStatus) -> ManagedProcess {
        ManagedProcess {
            id: "process-1".to_string(),
            employee_id: Some("employee-1".to_string()),
            title: "Long process".to_string(),
            command: "sleep 999".to_string(),
            cwd: "/tmp".to_string(),
            status,
            exit_code: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn save_and_load_valid_state() {
        let root = test_root("save-load");
        let path = root.join("state.json");
        let manager = PersistenceManager::new(path.clone(), None);

        manager
            .save(
                &root,
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            )
            .unwrap();
        let loaded = load_from_disk(&path).unwrap().unwrap();

        assert_eq!(loaded.workspace_root, root.to_string_lossy());
        assert!(loaded.employees.is_empty());
        assert!(loaded.terminal_sessions.is_empty());
        assert!(loaded.actions.is_empty());
        assert!(loaded.approvals.is_empty());
        assert!(loaded.processes.is_empty());
        assert!(loaded.process_logs.is_empty());
    }

    #[test]
    fn restore_running_actions_as_failed() {
        let restored = restore_actions(&[sample_action(ActionStatus::Running)]);

        assert_eq!(restored[0].status, ActionStatus::Failed);
        assert_eq!(
            restored[0].error.as_deref(),
            Some("app restarted before action completed")
        );
        assert!(restored[0].finished_at.is_some());
    }

    #[test]
    fn restore_running_processes_as_failed() {
        let restored = restore_managed_processes(&[sample_process(ManagedProcessStatus::Running)]);

        assert_eq!(restored[0].status, ManagedProcessStatus::Failed);
        assert_eq!(restored[0].exit_code, None);
    }
}
