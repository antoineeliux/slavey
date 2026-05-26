use std::{
    fs as std_fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    employees::{Employee, EmployeeStatus},
    events::now_ms,
    fs::resolve_existing_dir,
    AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistentAppState {
    pub workspace_root: String,
    pub employees: Vec<Employee>,
    pub selected_employee_id: Option<String>,
    pub active_tab: Option<String>,
    pub recent_files: Vec<String>,
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

    pub fn snapshot(&self, workspace_root: &Path, employees: Vec<Employee>) -> PersistentAppState {
        let ui_state = self.ui_state.lock();
        PersistentAppState {
            workspace_root: workspace_root.to_string_lossy().to_string(),
            employees,
            selected_employee_id: ui_state.selected_employee_id.clone(),
            active_tab: ui_state.active_tab.clone(),
            recent_files: ui_state.recent_files.clone(),
            updated_at: now_ms(),
        }
    }

    pub fn save(&self, workspace_root: &Path, employees: Vec<Employee>) -> Result<(), String> {
        let snapshot = self.snapshot(workspace_root, employees);
        if let Some(parent) = self.path.parent() {
            std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let contents =
            serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
        std_fs::write(&self.path, contents).map_err(|error| error.to_string())
    }

    pub fn update_ui(&self, request: AppStateSaveRequest) {
        let mut ui_state = self.ui_state.lock();
        ui_state.selected_employee_id = request.selected_employee_id;
        ui_state.active_tab = request.active_tab;
        ui_state.recent_files = request.recent_files;
    }
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
