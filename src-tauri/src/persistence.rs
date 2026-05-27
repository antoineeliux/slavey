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
    actions::{prune_action_history_for_persistence, Action},
    approvals::{prune_approval_history_for_persistence, ApprovalRequest},
    employees::{Employee, EmployeeStatus},
    events::now_ms,
    fs::resolve_existing_dir,
    processes::{ManagedProcess, ProcessLogSnapshot},
    terminal::{TerminalLaunchProfile, TerminalSessionRecord},
    AppState,
};

pub const DEFAULT_MAX_TERMINAL_BUFFER_CHARS: usize = 250_000;
const MIN_TERMINAL_BUFFER_CHARS: usize = 20_000;
const MAX_TERMINAL_BUFFER_CHARS: usize = 2_000_000;
const MAX_RECENT_WORKSPACES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_terminal_profile")]
    pub default_terminal_profile: TerminalLaunchProfile,
    #[serde(default = "default_true")]
    pub require_confirmation_discard: bool,
    #[serde(default = "default_true")]
    pub require_confirmation_delete: bool,
    #[serde(default = "default_true")]
    pub require_confirmation_handoff_apply: bool,
    #[serde(default = "default_max_terminal_buffer_chars")]
    pub max_terminal_buffer_chars: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_terminal_profile: default_terminal_profile(),
            require_confirmation_discard: true,
            require_confirmation_delete: true,
            require_confirmation_handoff_apply: true,
            max_terminal_buffer_chars: DEFAULT_MAX_TERMINAL_BUFFER_CHARS,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsUpdateRequest {
    pub default_terminal_profile: Option<TerminalLaunchProfile>,
    pub require_confirmation_discard: Option<bool>,
    pub require_confirmation_delete: Option<bool>,
    pub require_confirmation_handoff_apply: Option<bool>,
    pub max_terminal_buffer_chars: Option<usize>,
}

fn default_terminal_profile() -> TerminalLaunchProfile {
    TerminalLaunchProfile::Shell
}

fn default_true() -> bool {
    true
}

fn default_max_terminal_buffer_chars() -> usize {
    DEFAULT_MAX_TERMINAL_BUFFER_CHARS
}

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
    pub recent_workspaces: Vec<String>,
    #[serde(default)]
    pub settings: AppSettings,
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

#[derive(Debug, Clone)]
pub struct AppStateSnapshotInput {
    pub workspace_root: PathBuf,
    pub employees: Vec<Employee>,
    pub terminal_sessions: Vec<TerminalSessionRecord>,
    pub actions: Vec<Action>,
    pub approvals: Vec<ApprovalRequest>,
    pub processes: Vec<ManagedProcess>,
    pub process_logs: Vec<ProcessLogSnapshot>,
}

#[derive(Debug, Clone, Default)]
struct PersistentUiState {
    selected_employee_id: Option<String>,
    active_tab: Option<String>,
    recent_files: Vec<String>,
    recent_workspaces: Vec<String>,
    settings: AppSettings,
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
                recent_workspaces: state.recent_workspaces.clone(),
                settings: normalize_settings(state.settings.clone()),
            })
            .unwrap_or_default();

        Self {
            path,
            ui_state: Arc::new(Mutex::new(ui_state)),
        }
    }

    pub fn snapshot(&self, input: AppStateSnapshotInput) -> PersistentAppState {
        let ui_state = self.ui_state.lock();
        let workspace_root = input.workspace_root.to_string_lossy().to_string();
        let actions = prune_action_history_for_persistence(input.actions);
        let approvals = prune_approval_history_for_persistence(input.approvals, &actions);
        PersistentAppState {
            workspace_root,
            employees: input.employees,
            terminal_sessions: input.terminal_sessions,
            actions,
            approvals,
            processes: input.processes,
            process_logs: input.process_logs,
            selected_employee_id: ui_state.selected_employee_id.clone(),
            active_tab: ui_state.active_tab.clone(),
            recent_files: ui_state.recent_files.clone(),
            recent_workspaces: ui_state.recent_workspaces.clone(),
            settings: ui_state.settings.clone(),
            updated_at: now_ms(),
        }
    }

    pub fn save(&self, input: AppStateSnapshotInput) -> Result<(), String> {
        let snapshot = self.snapshot(input);
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

    pub fn reset_workspace_bound_ui(&self) {
        let mut ui_state = self.ui_state.lock();
        ui_state.selected_employee_id = None;
        ui_state.active_tab = Some("terminal".to_string());
        ui_state.recent_files.clear();
    }

    pub fn settings(&self) -> AppSettings {
        self.ui_state.lock().settings.clone()
    }

    pub fn update_settings(
        &self,
        request: AppSettingsUpdateRequest,
    ) -> Result<AppSettings, String> {
        let mut ui_state = self.ui_state.lock();
        let mut settings = ui_state.settings.clone();
        if let Some(profile) = request.default_terminal_profile {
            settings.default_terminal_profile = profile;
        }
        if let Some(value) = request.require_confirmation_discard {
            settings.require_confirmation_discard = value;
        }
        if let Some(value) = request.require_confirmation_delete {
            settings.require_confirmation_delete = value;
        }
        if let Some(value) = request.require_confirmation_handoff_apply {
            settings.require_confirmation_handoff_apply = value;
        }
        if let Some(value) = request.max_terminal_buffer_chars {
            settings.max_terminal_buffer_chars = validate_terminal_buffer_size(value)?;
        }
        ui_state.settings = settings;
        Ok(ui_state.settings.clone())
    }

    pub fn recent_workspaces(&self) -> Vec<String> {
        self.ui_state.lock().recent_workspaces.clone()
    }

    pub fn note_recent_workspace(&self, workspace_root: &Path) -> Vec<String> {
        let path = workspace_root.to_string_lossy().to_string();
        let mut ui_state = self.ui_state.lock();
        ui_state.recent_workspaces.retain(|item| item != &path);
        ui_state.recent_workspaces.insert(0, path);
        ui_state.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);
        ui_state.recent_workspaces.clone()
    }

    pub fn clear_recent_workspaces(&self) -> Vec<String> {
        let mut ui_state = self.ui_state.lock();
        ui_state.recent_workspaces.clear();
        Vec::new()
    }
}

fn validate_terminal_buffer_size(value: usize) -> Result<usize, String> {
    if !(MIN_TERMINAL_BUFFER_CHARS..=MAX_TERMINAL_BUFFER_CHARS).contains(&value) {
        Err(format!(
            "maxTerminalBufferChars must be between {MIN_TERMINAL_BUFFER_CHARS} and {MAX_TERMINAL_BUFFER_CHARS}"
        ))
    } else {
        Ok(value)
    }
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    if let Ok(size) = validate_terminal_buffer_size(settings.max_terminal_buffer_chars) {
        settings.max_terminal_buffer_chars = size;
    } else {
        settings.max_terminal_buffer_chars = DEFAULT_MAX_TERMINAL_BUFFER_CHARS;
    }
    settings
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

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppSettings {
    state.persistence.settings()
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    payload: AppSettingsUpdateRequest,
) -> Result<AppSettings, String> {
    let settings = state.persistence.update_settings(payload)?;
    state.persist()?;
    Ok(settings)
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
            source: crate::actions::ActionSource::User,
            timeout_secs: 120,
            output_cap_bytes: crate::actions::MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
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

    fn empty_snapshot_input(workspace_root: PathBuf) -> AppStateSnapshotInput {
        AppStateSnapshotInput {
            workspace_root,
            employees: Vec::new(),
            terminal_sessions: Vec::new(),
            actions: Vec::new(),
            approvals: Vec::new(),
            processes: Vec::new(),
            process_logs: Vec::new(),
        }
    }

    #[test]
    fn save_and_load_valid_state() {
        let root = test_root("save-load");
        let path = root.join("state.json");
        let manager = PersistenceManager::new(path.clone(), None);

        manager.save(empty_snapshot_input(root.clone())).unwrap();
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
    fn settings_default_and_restore() {
        let root = test_root("settings");
        let path = root.join("state.json");
        let manager = PersistenceManager::new(path.clone(), None);

        assert_eq!(manager.settings(), AppSettings::default());

        let updated = manager
            .update_settings(AppSettingsUpdateRequest {
                default_terminal_profile: Some(crate::terminal::TerminalLaunchProfile::Codex),
                require_confirmation_discard: Some(false),
                require_confirmation_delete: Some(false),
                require_confirmation_handoff_apply: Some(true),
                max_terminal_buffer_chars: Some(100_000),
            })
            .unwrap();
        assert_eq!(
            updated.default_terminal_profile,
            crate::terminal::TerminalLaunchProfile::Codex
        );
        assert!(!updated.require_confirmation_discard);
        assert!(!updated.require_confirmation_delete);
        assert!(updated.require_confirmation_handoff_apply);
        assert_eq!(updated.max_terminal_buffer_chars, 100_000);

        manager.save(empty_snapshot_input(root)).unwrap();
        let loaded = load_from_disk(&path).unwrap().unwrap();
        let restored = PersistenceManager::new(path, Some(&loaded));

        assert_eq!(restored.settings(), updated);
    }

    #[test]
    fn invalid_terminal_buffer_setting_is_rejected() {
        let root = test_root("settings-invalid");
        let manager = PersistenceManager::new(root.join("state.json"), None);

        let error = manager
            .update_settings(AppSettingsUpdateRequest {
                max_terminal_buffer_chars: Some(10),
                ..AppSettingsUpdateRequest::default()
            })
            .unwrap_err();

        assert!(error.contains("maxTerminalBufferChars"));
    }

    #[test]
    fn restore_running_actions_as_failed() {
        let restored = restore_actions(&[sample_action(ActionStatus::Running)]);

        assert_eq!(restored[0].status, ActionStatus::Failed);
        assert_eq!(
            restored[0].error.as_deref(),
            Some("app restarted before action completed")
        );
        assert_eq!(
            restored[0].failure_reason,
            Some(crate::actions::ActionFailureReason::AppRestarted)
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
