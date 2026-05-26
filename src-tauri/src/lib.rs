mod actions;
mod approvals;
mod employees;
mod events;
mod fs;
mod git;
mod persistence;
mod terminal;

use std::path::PathBuf;

use actions::ActionManager;
use approvals::ApprovalManager;
use employees::EmployeeManager;
use events::{emit_log, LogLevel};
use persistence::PersistenceManager;
use tauri::Manager;
use terminal::TerminalManager;

pub struct AppState {
    pub workspace_root: PathBuf,
    pub employees: EmployeeManager,
    pub terminal: TerminalManager,
    pub persistence: PersistenceManager,
    pub approvals: ApprovalManager,
    pub actions: ActionManager,
}

impl AppState {
    fn new(
        workspace_root: PathBuf,
        employees: EmployeeManager,
        persistence: PersistenceManager,
    ) -> Self {
        Self {
            workspace_root,
            employees,
            terminal: TerminalManager::default(),
            persistence,
            approvals: ApprovalManager::default(),
            actions: ActionManager::default(),
        }
    }

    pub fn persist(&self) -> Result<(), String> {
        self.persistence
            .save(&self.workspace_root, self.employees.list())
    }

    pub fn snapshot(&self) -> persistence::PersistentAppState {
        self.persistence
            .snapshot(&self.workspace_root, self.employees.list())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let persistence_path = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| {
                    std::env::current_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                        .join(".slavey")
                        .join("config")
                })
                .join("state.json");
            let persisted = match persistence::load_from_disk(&persistence_path) {
                Ok(state) => state,
                Err(error) => {
                    emit_log(
                        app.handle(),
                        LogLevel::Warn,
                        format!("failed to load persisted app state: {error}"),
                    );
                    None
                }
            };
            let persisted_workspace = persisted
                .as_ref()
                .filter(|state| !state.workspace_root.trim().is_empty())
                .map(|state| PathBuf::from(&state.workspace_root));
            let workspace_root = resolve_workspace_root(persisted_workspace);
            let employees = EmployeeManager::default();
            if let Some(persisted) = &persisted {
                employees.replace_all(persistence::restore_employees(
                    &workspace_root,
                    &persisted.employees,
                ));
            }
            let persistence = PersistenceManager::new(persistence_path, persisted.as_ref());
            emit_log(
                app.handle(),
                LogLevel::Info,
                format!("workspace root set to {}", workspace_root.display()),
            );
            app.manage(AppState::new(workspace_root, employees, persistence));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            persistence::app_state_load,
            persistence::app_state_save,
            employees::employee_create,
            employees::employee_list,
            employees::employee_role_policies,
            employees::employee_remove,
            employees::employee_start_terminal,
            employees::employee_stop_terminal,
            approvals::approval_create,
            approvals::approval_list,
            approvals::approval_approve,
            approvals::approval_reject,
            actions::action_create,
            actions::action_list,
            actions::action_request_approval,
            actions::action_approve,
            actions::action_reject,
            actions::action_run,
            actions::action_cancel,
            git::git_is_repo,
            git::git_worktree_create_for_employee,
            git::git_worktree_status_for_employee,
            git::git_worktree_remove_for_employee,
            git::git_worktree_diff_for_employee,
            git::git_worktree_review_for_employee,
            terminal::terminal_write,
            terminal::terminal_resize,
            fs::fs_list_dir,
            fs::fs_read_file,
            fs::fs_write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Slavey");
}

fn resolve_workspace_root(persisted_workspace: Option<PathBuf>) -> PathBuf {
    if let Ok(root) = std::env::var("SLAVEY_WORKSPACE_ROOT") {
        return canonicalize_or_original(PathBuf::from(root));
    }

    if let Some(root) = persisted_workspace {
        if root.exists() {
            return canonicalize_or_original(root);
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidate = if cwd.file_name().is_some_and(|name| name == "src-tauri") {
        cwd.parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| cwd.clone())
    } else {
        cwd
    };

    canonicalize_or_original(candidate)
}

fn canonicalize_or_original(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}
