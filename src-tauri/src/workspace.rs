use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    events::{emit_employee_activity_updated, emit_log, LogLevel},
    git::{current_branch as git_current_branch, git_success, parse_status_lines, run_git},
    persistence::AppSettings,
    terminal::{codex_cli_status_impl, CodexCliStatus},
    AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub workspace_root: String,
    pub recent_workspaces: Vec<String>,
    pub settings: AppSettings,
    pub repo_health: RepoHealth,
    pub switch_blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHealth {
    pub is_existing_directory: bool,
    pub is_git_repo: bool,
    pub repo_root: Option<String>,
    pub current_branch: Option<String>,
    pub dirty: bool,
    pub git_user_name_configured: bool,
    pub git_user_email_configured: bool,
    pub worktree_supported: bool,
    pub worktree_support_message: String,
    pub worktree_blockers: Vec<String>,
    pub handoff_blockers: Vec<String>,
    pub codex_cli_status: CodexCliStatus,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct WorkspaceActivity {
    pub live_terminal_session: bool,
    pub running_terminal_record: bool,
    pub running_managed_process: bool,
    pub running_action: bool,
}

#[tauri::command]
pub fn workspace_info(state: State<'_, AppState>) -> WorkspaceInfo {
    workspace_info_impl(&state)
}

#[tauri::command]
pub fn workspace_set_root(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceInfo, String> {
    let previous_root = state.workspace_root();
    let info = workspace_set_root_impl(&state, &path)?;

    if info.workspace_root.as_str() != previous_root.to_string_lossy().as_ref() {
        emit_log(
            &app,
            LogLevel::Info,
            format!("workspace root set to {}", info.workspace_root),
        );
        emit_employee_activity_updated(&app, None);
    }

    Ok(info)
}

pub(crate) fn workspace_set_root_impl(
    state: &AppState,
    path: &str,
) -> Result<WorkspaceInfo, String> {
    let next_root = validate_workspace_root(path)?;
    let current_root = state.workspace_root();
    if next_root == current_root {
        state.persistence.note_recent_workspace(&next_root);
        state.persist()?;
        return Ok(workspace_info_impl(state));
    }

    let blockers = workspace_switch_blockers(state);
    if !blockers.is_empty() {
        return Err(format!(
            "cannot switch workspace while {}",
            blockers.join(", ")
        ));
    }

    state.persistence.note_recent_workspace(&current_root);
    reset_workspace_bound_state(state);
    state.set_workspace_root(next_root.clone());
    state.persistence.reset_workspace_bound_ui();
    state.persistence.note_recent_workspace(&next_root);
    state.persist()?;

    Ok(workspace_info_impl(state))
}

#[tauri::command]
pub fn workspace_recent_list(state: State<'_, AppState>) -> Vec<String> {
    state.persistence.recent_workspaces()
}

#[tauri::command]
pub fn workspace_recent_clear(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let recent = state.persistence.clear_recent_workspaces();
    state.persist()?;
    Ok(recent)
}

fn workspace_info_impl(state: &AppState) -> WorkspaceInfo {
    let workspace_root = state.workspace_root();
    WorkspaceInfo {
        workspace_root: workspace_root.to_string_lossy().to_string(),
        recent_workspaces: state.persistence.recent_workspaces(),
        settings: state.persistence.settings(),
        repo_health: repo_health_for_workspace(&workspace_root, codex_cli_status_impl()),
        switch_blockers: workspace_switch_blockers_from_activity(workspace_activity(state)),
    }
}

pub(crate) fn validate_workspace_root(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("workspace path is required".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err("workspace path must be absolute".to_string());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }
    ensure_workspace_root_not_sensitive(&canonical)?;

    Ok(canonical)
}

pub(crate) fn repo_health_for_workspace(
    workspace_root: &Path,
    codex_cli_status: CodexCliStatus,
) -> RepoHealth {
    let is_existing_directory = workspace_root.is_dir();
    if !is_existing_directory {
        return RepoHealth {
            is_existing_directory,
            is_git_repo: false,
            repo_root: None,
            current_branch: None,
            dirty: false,
            git_user_name_configured: false,
            git_user_email_configured: false,
            worktree_supported: false,
            worktree_support_message: "workspace path is not an existing directory".to_string(),
            worktree_blockers: vec!["workspace path is not an existing directory".to_string()],
            handoff_blockers: vec!["workspace path is not an existing directory".to_string()],
            codex_cli_status,
        };
    }

    let repo_root = run_git(workspace_root, &["rev-parse", "--show-toplevel"])
        .ok()
        .and_then(non_empty_trimmed);
    let is_git_repo = repo_root.is_some();
    let current_branch = is_git_repo
        .then(|| git_current_branch(workspace_root).ok().flatten())
        .flatten();
    let dirty = is_git_repo
        && run_git(workspace_root, &["status", "--porcelain"])
            .map(|output| !parse_status_lines(&output).is_empty())
            .unwrap_or(false);
    let git_user_name_configured = is_git_repo && git_config_present(workspace_root, "user.name");
    let git_user_email_configured = is_git_repo && git_config_present(workspace_root, "user.email");
    let worktree_command_available =
        is_git_repo && git_success(workspace_root, &["worktree", "list", "--porcelain"]);
    let worktree_blockers = worktree_feature_blockers(
        is_git_repo,
        git_user_name_configured,
        git_user_email_configured,
        worktree_command_available,
    );
    let handoff_blockers = handoff_feature_blockers(is_git_repo, current_branch.as_deref(), dirty);
    let worktree_supported = worktree_blockers.is_empty();
    let worktree_support_message = if worktree_supported {
        "git worktree is available".to_string()
    } else {
        worktree_blockers.join("; ")
    };

    RepoHealth {
        is_existing_directory,
        is_git_repo,
        repo_root,
        current_branch,
        dirty,
        git_user_name_configured,
        git_user_email_configured,
        worktree_supported,
        worktree_support_message,
        worktree_blockers,
        handoff_blockers,
        codex_cli_status,
    }
}

fn workspace_activity(state: &AppState) -> WorkspaceActivity {
    WorkspaceActivity {
        live_terminal_session: state.terminal.has_active_sessions(),
        running_terminal_record: state.terminal_sessions.has_running(),
        running_managed_process: state.processes.has_running(),
        running_action: state.actions.has_running(),
    }
}

pub(crate) fn workspace_switch_blockers_from_activity(activity: WorkspaceActivity) -> Vec<String> {
    let mut blockers = Vec::new();
    if activity.live_terminal_session || activity.running_terminal_record {
        blockers.push("a terminal session is active".to_string());
    }
    if activity.running_managed_process {
        blockers.push("a managed process is running".to_string());
    }
    if activity.running_action {
        blockers.push("an action is running".to_string());
    }
    blockers
}

fn workspace_switch_blockers(state: &AppState) -> Vec<String> {
    workspace_switch_blockers_from_activity(workspace_activity(state))
}

fn reset_workspace_bound_state(state: &AppState) {
    state.employees.replace_all(Vec::new());
    state.terminal.clear_inactive_sessions();
    state.terminal_sessions.replace_all(Vec::new());
    state.processes.clear();
    state.actions.replace_all(Vec::new());
    state.approvals.replace_all(Vec::new());
}

fn git_config_present(workspace_root: &Path, key: &str) -> bool {
    run_git(workspace_root, &["config", "--get", key])
        .ok()
        .and_then(non_empty_trimmed)
        .is_some()
}

fn worktree_feature_blockers(
    is_git_repo: bool,
    git_user_name_configured: bool,
    git_user_email_configured: bool,
    worktree_command_available: bool,
) -> Vec<String> {
    let mut blockers = Vec::new();
    if !is_git_repo {
        blockers.push("workspace is not a git repository".to_string());
        return blockers;
    }
    if !git_user_name_configured {
        blockers.push("git user.name is not configured".to_string());
    }
    if !git_user_email_configured {
        blockers.push("git user.email is not configured".to_string());
    }
    if !worktree_command_available {
        blockers.push("git worktree command is unavailable for this repository".to_string());
    }
    blockers
}

fn handoff_feature_blockers(
    is_git_repo: bool,
    current_branch: Option<&str>,
    dirty: bool,
) -> Vec<String> {
    let mut blockers = Vec::new();
    if !is_git_repo {
        blockers.push("workspace is not a git repository".to_string());
        return blockers;
    }
    if current_branch.is_none() {
        blockers.push("main workspace is not on a named branch".to_string());
    }
    if dirty {
        blockers.push("main workspace has uncommitted changes".to_string());
    }
    blockers
}

fn ensure_workspace_root_not_sensitive(path: &Path) -> Result<(), String> {
    if path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .any(is_sensitive_workspace_component)
    {
        Err("workspace path is blocked because it may contain secrets or credentials".to_string())
    } else {
        Ok(())
    }
}

fn is_sensitive_workspace_component(component: &str) -> bool {
    let lower = component.to_ascii_lowercase();
    lower == ".git"
        || lower == ".ssh"
        || lower == ".gnupg"
        || lower == "credentials"
        || lower == ".aws"
        || lower == ".config"
        || lower == ".npmrc"
        || lower == ".pypirc"
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs as std_fs,
        process::{Command, Stdio},
        sync::Arc,
    };

    use parking_lot::RwLock;

    use super::*;
    use crate::{
        actions::{Action, ActionKind, ActionManager, ActionStatus},
        approvals::{ApprovalCreateRequest, ApprovalKind, ApprovalManager},
        employees::{EmployeeManager, EmployeeRole},
        persistence::{load_from_disk, AppStateSaveRequest, PersistenceManager},
        processes::{ManagedProcess, ManagedProcessStatus, ProcessManager},
        terminal::{
            TerminalLaunchProfile, TerminalManager, TerminalSessionRecord, TerminalSessionStatus,
            TerminalSessionStore,
        },
    };

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("slavey-workspace-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn codex_status() -> CodexCliStatus {
        CodexCliStatus {
            available: false,
            version: None,
            message: "not checked in test".to_string(),
        }
    }

    fn test_state(workspace_root: PathBuf, persistence_path: PathBuf) -> AppState {
        AppState {
            workspace_root: Arc::new(RwLock::new(workspace_root)),
            employees: EmployeeManager::default(),
            terminal: TerminalManager::default(),
            terminal_sessions: TerminalSessionStore::default(),
            persistence: PersistenceManager::new(persistence_path, None),
            approvals: ApprovalManager::default(),
            actions: ActionManager::default(),
            processes: ProcessManager::default(),
        }
    }

    fn sample_action(employee_id: &str, status: ActionStatus) -> Action {
        Action {
            id: format!("action-{employee_id}"),
            employee_id: employee_id.to_string(),
            kind: ActionKind::ShellCommand,
            title: "Inspect".to_string(),
            description: "Inspect workspace".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
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
            started_at: None,
            finished_at: None,
        }
    }

    fn sample_process(employee_id: &str) -> ManagedProcess {
        ManagedProcess {
            id: format!("process-{employee_id}"),
            employee_id: Some(employee_id.to_string()),
            title: "Finished process".to_string(),
            command: "true".to_string(),
            cwd: "/tmp".to_string(),
            status: ManagedProcessStatus::Exited,
            exit_code: Some(0),
            created_at: 1,
            updated_at: 2,
        }
    }

    fn sample_terminal_session(employee_id: &str, cwd: &Path) -> TerminalSessionRecord {
        TerminalSessionRecord {
            session_id: format!("session-{employee_id}"),
            employee_id: employee_id.to_string(),
            profile: TerminalLaunchProfile::Shell,
            cwd: cwd.to_string_lossy().to_string(),
            status: TerminalSessionStatus::Stopped,
            exit_code: None,
            started_at: 1,
            ended_at: Some(2),
            stopped_at: Some(2),
            stop_reason: Some(crate::terminal::TerminalStopReason::UserStopped),
            label: "Shell session".to_string(),
            last_output_at: None,
            message: Some("stopped".to_string()),
        }
    }

    #[test]
    fn workspace_validation_canonicalizes_existing_directory() {
        let root = test_root("valid");
        let nested = root.join("nested");
        std_fs::create_dir_all(&nested).unwrap();

        let resolved = validate_workspace_root(nested.to_str().unwrap()).unwrap();

        assert_eq!(resolved, nested);
    }

    #[test]
    fn workspace_validation_rejects_empty_relative_missing_and_file() {
        let root = test_root("invalid");
        let file = root.join("file.txt");
        std_fs::write(&file, "not a dir").unwrap();
        let missing = root.join("missing");
        let sensitive = root.join(".ssh");
        std_fs::create_dir_all(&sensitive).unwrap();

        assert!(validate_workspace_root("").is_err());
        assert!(validate_workspace_root("relative/path").is_err());
        assert!(validate_workspace_root(missing.to_str().unwrap()).is_err());
        assert!(validate_workspace_root(file.to_str().unwrap()).is_err());
        assert!(validate_workspace_root(sensitive.to_str().unwrap()).is_err());
    }

    #[test]
    fn switching_blockers_report_active_workspace_work() {
        let blockers = workspace_switch_blockers_from_activity(WorkspaceActivity {
            live_terminal_session: true,
            running_terminal_record: false,
            running_managed_process: true,
            running_action: true,
        });

        assert_eq!(
            blockers,
            vec![
                "a terminal session is active",
                "a managed process is running",
                "an action is running"
            ]
        );
    }

    #[test]
    fn repo_health_reports_non_git_directory() {
        let root = test_root("non-git");

        let health = repo_health_for_workspace(&root, codex_status());

        assert!(health.is_existing_directory);
        assert!(!health.is_git_repo);
        assert_eq!(health.repo_root, None);
        assert!(!health.worktree_supported);
        assert_eq!(
            health.worktree_blockers,
            vec!["workspace is not a git repository".to_string()]
        );
        assert_eq!(
            health.handoff_blockers,
            vec!["workspace is not a git repository".to_string()]
        );
    }

    #[test]
    fn repo_health_reports_git_identity_and_dirty_state() {
        if !git_available() {
            return;
        }
        let root = test_root("git");
        run_git_test(&root, &["init"]);
        run_git_test(&root, &["config", "user.name", "Slavey Test"]);
        run_git_test(&root, &["config", "user.email", "slavey@example.test"]);
        std_fs::write(root.join("README.md"), "dirty\n").unwrap();

        let health = repo_health_for_workspace(&root, codex_status());

        assert!(health.is_existing_directory);
        assert!(health.is_git_repo);
        assert_eq!(health.repo_root.as_deref(), Some(root.to_str().unwrap()));
        assert!(health.dirty);
        assert!(health.git_user_name_configured);
        assert!(health.git_user_email_configured);
        assert!(health.worktree_blockers.is_empty());
        assert!(health
            .handoff_blockers
            .iter()
            .any(|blocker| blocker.contains("uncommitted changes")));
    }

    #[test]
    fn workspace_switch_blocks_active_terminal_session() {
        let root = test_root("switch-block-root");
        let next = test_root("switch-block-next");
        let state = test_state(root.clone(), root.join("state.json"));
        state.terminal_sessions.create(
            "session-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            root.to_string_lossy().to_string(),
        );

        let error = workspace_set_root_impl(&state, next.to_str().unwrap()).unwrap_err();

        assert!(error.contains("terminal session is active"));
        assert_eq!(state.workspace_root(), root);
    }

    #[test]
    fn successful_workspace_switch_clears_workspace_bound_state_and_persists_recent() {
        let root = test_root("switch-root");
        let next = test_root("switch-next");
        let state_path = root.join("state.json");
        let state = test_state(root.clone(), state_path.clone());

        let employee =
            state
                .employees
                .create("Ada".to_string(), EmployeeRole::General, root.clone());
        state
            .terminal_sessions
            .replace_all(vec![sample_terminal_session(&employee.id, &root)]);
        state
            .actions
            .replace_all(vec![sample_action(&employee.id, ActionStatus::Draft)]);
        state.approvals.create(ApprovalCreateRequest {
            employee_id: employee.id.clone(),
            action_id: None,
            kind: ApprovalKind::ShellCommand,
            title: "Review".to_string(),
            description: "Review command".to_string(),
            command: Some("pwd".to_string()),
            path: None,
            cwd: Some(root.to_string_lossy().to_string()),
        });
        state
            .processes
            .replace_all(vec![sample_process(&employee.id)], Vec::new());
        state.persistence.update_ui(AppStateSaveRequest {
            selected_employee_id: Some(employee.id),
            active_tab: Some("editor".to_string()),
            recent_files: vec!["README.md".to_string()],
        });

        let info = workspace_set_root_impl(&state, next.to_str().unwrap()).unwrap();
        let persisted = load_from_disk(&state_path).unwrap().unwrap();

        assert_eq!(info.workspace_root, next.to_string_lossy());
        assert_eq!(state.workspace_root(), next);
        assert!(state.employees.list().is_empty());
        assert!(state.terminal_sessions.list(None).is_empty());
        assert!(state.actions.list(None).is_empty());
        assert!(state.approvals.list(None).is_empty());
        assert!(state.processes.list().is_empty());
        assert_eq!(persisted.workspace_root, info.workspace_root);
        assert_eq!(persisted.selected_employee_id, None);
        assert_eq!(persisted.active_tab.as_deref(), Some("terminal"));
        assert!(persisted.recent_files.is_empty());
        assert_eq!(persisted.recent_workspaces[0], info.workspace_root);
        assert_eq!(persisted.recent_workspaces[1], root.to_string_lossy());
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn run_git_test(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "git command failed: {args:?}");
    }
}
