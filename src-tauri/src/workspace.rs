use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    events::{emit_log, LogLevel},
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
    let next_root = validate_workspace_root(&path)?;
    let current_root = state.workspace_root();
    if next_root == current_root {
        state.persistence.note_recent_workspace(&next_root);
        state.persist()?;
        return Ok(workspace_info_impl(&state));
    }

    let blockers = workspace_switch_blockers(&state);
    if !blockers.is_empty() {
        return Err(format!(
            "cannot switch workspace while {}",
            blockers.join(", ")
        ));
    }

    state.persistence.note_recent_workspace(&current_root);
    reset_workspace_bound_state(&state);
    state.set_workspace_root(next_root.clone());
    state.persistence.reset_workspace_bound_ui();
    state.persistence.note_recent_workspace(&next_root);
    state.persist()?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("workspace root set to {}", next_root.display()),
    );

    Ok(workspace_info_impl(&state))
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
    let (worktree_supported, worktree_support_message) =
        worktree_support(workspace_root, is_git_repo);

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

fn worktree_support(workspace_root: &Path, is_git_repo: bool) -> (bool, String) {
    if !is_git_repo {
        return (false, "workspace is not a git repository".to_string());
    }

    if git_success(workspace_root, &["worktree", "list", "--porcelain"]) {
        (true, "git worktree is available".to_string())
    } else {
        (
            false,
            "git worktree command is unavailable for this repository".to_string(),
        )
    }
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
    };

    use super::*;

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

        assert!(validate_workspace_root("").is_err());
        assert!(validate_workspace_root("relative/path").is_err());
        assert!(validate_workspace_root(missing.to_str().unwrap()).is_err());
        assert!(validate_workspace_root(file.to_str().unwrap()).is_err());
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
