mod actions;
mod activity;
mod activity_contract;
mod approvals;
mod codex_app_server;
mod diagnostics;
mod employees;
mod events;
mod fs;
mod git;
mod persistence;
mod processes;
mod terminal;
mod workspace;

use std::{path::PathBuf, sync::Arc};

use actions::{restore_actions, ActionManager};
use approvals::{restore_approvals, ApprovalManager};
use codex_app_server::CodexAppServerManager;
use employees::EmployeeManager;
use events::{emit_log, LogLevel};
use parking_lot::RwLock;
use persistence::{AppStateSnapshotInput, PersistenceManager};
use processes::ProcessManager;
use tauri::Manager;
use terminal::{AgentRuntimeStore, TerminalManager, TerminalSessionStore};

pub type WorkspaceRootHandle = Arc<RwLock<PathBuf>>;

pub struct AppState {
    workspace_root: WorkspaceRootHandle,
    pub employees: EmployeeManager,
    pub terminal: TerminalManager,
    pub codex_app_server: CodexAppServerManager,
    pub terminal_sessions: TerminalSessionStore,
    pub agent_runtime: AgentRuntimeStore,
    pub persistence: PersistenceManager,
    pub approvals: ApprovalManager,
    pub actions: ActionManager,
    pub processes: ProcessManager,
}

impl AppState {
    pub fn workspace_root(&self) -> PathBuf {
        self.workspace_root.read().clone()
    }

    pub fn workspace_root_handle(&self) -> WorkspaceRootHandle {
        Arc::clone(&self.workspace_root)
    }

    pub fn set_workspace_root(&self, workspace_root: PathBuf) {
        *self.workspace_root.write() = workspace_root;
    }

    pub fn persist(&self) -> Result<(), String> {
        self.persistence.save(self.snapshot_input())
    }

    pub fn snapshot(&self) -> persistence::PersistentAppState {
        self.persistence.snapshot(self.snapshot_input())
    }

    fn snapshot_input(&self) -> AppStateSnapshotInput {
        AppStateSnapshotInput {
            workspace_root: self.workspace_root(),
            employees: self.employees.list(),
            terminal_sessions: self.terminal_sessions.list(None),
            actions: self.actions.list(None),
            approvals: self.approvals.list(None),
            processes: self.processes.list(),
            process_logs: self.processes.log_snapshots(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            let approvals = ApprovalManager::default();
            let actions = ActionManager::default();
            let processes = ProcessManager::default();
            let terminal_sessions = TerminalSessionStore::default();
            let codex_app_server = CodexAppServerManager::default();
            let agent_runtime = AgentRuntimeStore::default();
            if let Some(persisted) = &persisted {
                employees.replace_all(persistence::restore_employees(
                    &workspace_root,
                    &persisted.employees,
                ));
                terminal_sessions.replace_all(terminal::restore_terminal_session_records(
                    &persisted.terminal_sessions,
                ));
                agent_runtime.sync_all_from_terminal_sessions(&terminal_sessions.list(None));
                let restored_actions = restore_actions(&persisted.actions);
                let restored_approvals = restore_approvals(&persisted.approvals, &restored_actions);
                approvals.replace_all(restored_approvals);
                actions.replace_all(restored_actions);
                processes.replace_all(persisted.processes.clone(), persisted.process_logs.clone());
            }
            let persistence = PersistenceManager::new(persistence_path, persisted.as_ref());
            emit_log(
                app.handle(),
                LogLevel::Info,
                format!("workspace root set to {}", workspace_root.display()),
            );
            let state = AppState {
                workspace_root: Arc::new(RwLock::new(workspace_root)),
                employees,
                terminal: TerminalManager::default(),
                codex_app_server,
                terminal_sessions,
                agent_runtime,
                persistence,
                approvals,
                actions,
                processes,
            };
            if persisted.is_some() {
                if let Err(error) = state.persist() {
                    emit_log(
                        app.handle(),
                        LogLevel::Warn,
                        format!("failed to persist restored app state: {error}"),
                    );
                }
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            activity::employee_activity_list,
            activity::employee_activity_get,
            diagnostics::diagnostics_summary,
            diagnostics::diagnostics_export_bundle,
            persistence::app_state_load,
            persistence::app_state_save,
            employees::employee_create,
            employees::employee_list,
            employees::employee_role_policies,
            employees::employee_remove,
            employees::employee_resume_from_standby,
            employees::employee_set_standby,
            employees::employee_set_working_folder,
            employees::employee_start_terminal,
            employees::employee_stop_terminal,
            codex_app_server::codex_task_submit,
            approvals::approval_create,
            approvals::approval_list,
            approvals::approval_get,
            approvals::approval_approve,
            approvals::approval_reject,
            actions::action_create,
            actions::action_list,
            actions::action_get,
            actions::action_request_approval,
            actions::action_approve,
            actions::action_reject,
            actions::action_run,
            actions::action_cancel,
            processes::process_spawn,
            processes::process_list,
            processes::process_logs,
            processes::process_kill,
            git::git_changes_for_path,
            git::git_file_diff_for_path,
            git::git_is_repo,
            git::git_worktree_create_for_employee,
            git::git_worktree_status_for_employee,
            git::git_worktree_remove_for_employee,
            git::git_worktree_diff_for_employee,
            git::git_worktree_review_for_employee,
            git::git_worktree_changed_files_for_employee,
            git::git_worktree_file_diff_for_employee,
            git::git_worktree_commit_preview_for_employee,
            git::git_worktree_commit_for_employee,
            git::git_worktree_log_for_employee,
            git::git_worktree_handoff_preview_for_employee,
            git::git_worktree_handoff_preflight_for_employee,
            git::git_worktree_apply_handoff_for_employee,
            git::git_worktree_abort_handoff_for_employee,
            git::git_worktree_stage_file,
            git::git_worktree_unstage_file,
            git::git_worktree_discard_file_for_employee,
            git::git_worktree_delete_untracked_file_for_employee,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_session_list,
            terminal::terminal_session_get,
            terminal::terminal_session_output,
            terminal::terminal_session_stop,
            terminal::terminal_session_rename,
            terminal::uploads::terminal_image_upload,
            terminal::uploads::terminal_image_upload_path,
            terminal::codex_cli_status,
            codex_app_server::codex_app_server_status,
            workspace::workspace_info,
            workspace::workspace_set_root,
            workspace::workspace_recent_list,
            workspace::workspace_recent_clear,
            persistence::settings_get,
            persistence::settings_update,
            fs::fs_list_dir,
            fs::fs_list_files,
            fs::fs_search,
            fs::fs_grep,
            fs::fs_glob,
            fs::fs_read_file,
            fs::fs_file_metadata,
            fs::fs_write_file,
            fs::fs_create_file,
            fs::fs_create_dir,
            fs::fs_rename,
            fs::fs_delete
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

    let cwd = default_workspace_root();
    let candidate = if cwd.file_name().is_some_and(|name| name == "src-tauri") {
        cwd.parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| cwd.clone())
    } else {
        cwd
    };

    canonicalize_or_original(candidate)
}

fn default_workspace_root() -> PathBuf {
    home_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

fn canonicalize_or_original(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

pub fn read_workspace_root(handle: &WorkspaceRootHandle) -> PathBuf {
    handle.read().clone()
}
