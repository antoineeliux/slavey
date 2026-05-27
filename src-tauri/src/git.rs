use std::{
    fs as std_fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    employees::{resolve_employee_execution_dir, Employee},
    events::{emit_employee_activity_updated, emit_employee_updated, emit_log, LogLevel},
    fs::resolve_existing_dir,
    AppState,
};

mod parsing;
mod runner;

use self::parsing::{
    commit_from_output, employee_worktree_is_clean, has_staged_changes,
    has_unstaged_change_for_path, is_untracked_file, main_workspace_has_uncommitted_changes,
    parse_ahead_behind, parse_changed_files, parse_commit_log, parse_staged_files,
    parse_untracked_files, validate_commit_message,
};
use self::runner::bounded_git_output;
pub(crate) use self::{
    parsing::parse_status_lines,
    runner::{git_success, run_git},
};

const MAX_UNTRACKED_PREVIEW_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub employee_id: String,
    pub has_worktree: bool,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub is_repo: bool,
    pub dirty: bool,
    pub changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReview {
    pub employee_id: String,
    pub worktree_path: String,
    pub branch_name: Option<String>,
    pub status: Vec<String>,
    pub unstaged_diff: String,
    pub staged_diff: String,
    pub untracked_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCommitPreview {
    pub employee_id: String,
    pub has_staged_changes: bool,
    pub staged_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffPreview {
    pub employee_id: String,
    pub current_branch: Option<String>,
    pub base_branch: Option<String>,
    pub upstream_branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub head: Option<WorktreeCommit>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffOperationState {
    pub in_progress: bool,
    pub operation: Option<String>,
    pub head: Option<String>,
    pub can_abort: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffPreflight {
    pub employee_id: String,
    pub employee_branch: Option<String>,
    pub main_branch: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub commits_to_apply: Vec<WorktreeCommit>,
    pub employee_clean: bool,
    pub main_clean: bool,
    pub apply_strategy: String,
    pub main_operation: WorktreeHandoffOperationState,
    pub blockers: Vec<String>,
    pub can_apply: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffApplyRequest {
    pub employee_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffApplyResult {
    pub employee_id: String,
    pub applied: bool,
    pub strategy: String,
    pub applied_commits: Vec<WorktreeCommit>,
    pub conflict: bool,
    pub error: Option<String>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffAbortResult {
    pub employee_id: String,
    pub aborted: bool,
    pub operation: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCommitRequest {
    pub employee_id: String,
    pub message: String,
}

#[tauri::command]
pub fn git_is_repo(state: State<'_, AppState>, path: Option<String>) -> bool {
    let workspace_root = state.workspace_root();
    let root = match path {
        Some(path) if !path.trim().is_empty() => {
            match resolve_existing_dir(&workspace_root, &path) {
                Ok(path) => path,
                Err(_) => return false,
            }
        }
        _ => workspace_root,
    };

    git_success(&root, &["rev-parse", "--show-toplevel"])
}

#[tauri::command]
pub fn git_worktree_create_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let workspace_root = state.workspace_root();
    if !git_success(&workspace_root, &["rev-parse", "--show-toplevel"]) {
        return Err("workspace root is not a git repository".to_string());
    }

    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_some() {
        return Err("employee already has a worktree".to_string());
    }

    let worktree_root = workspace_root.join(".slavey").join("worktrees");
    std_fs::create_dir_all(&worktree_root).map_err(|error| error.to_string())?;
    if ensure_slavey_excluded(&workspace_root)? {
        emit_log(&app, LogLevel::Info, "added .slavey/ to .git/info/exclude");
    }

    let worktree_path = worktree_root.join(&employee.id);
    if worktree_path.exists() {
        return Err(format!(
            "worktree path already exists: {}",
            worktree_path.display()
        ));
    }

    let branch_name = branch_name_for_employee(&employee);
    if git_success(
        &workspace_root,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch_name}"),
        ],
    ) {
        return Err(format!("branch already exists: {branch_name}"));
    }

    run_git(
        &workspace_root,
        &[
            "worktree",
            "add",
            "-b",
            &branch_name,
            path_to_str(&worktree_path)?,
            "HEAD",
        ],
    )?;

    let canonical_worktree = worktree_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let updated = state
        .employees
        .update(&employee_id, |employee| {
            let path = canonical_worktree.to_string_lossy().to_string();
            employee.worktree_path = Some(path.clone());
            employee.branch_name = Some(branch_name.clone());
            employee.cwd = path;
        })
        .ok_or_else(|| "employee not found".to_string())?;
    state.persist()?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("created worktree {} for {}", branch_name, updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    Ok(updated)
}

#[tauri::command]
pub fn git_worktree_status_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeStatus, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_none() {
        return Ok(WorktreeStatus {
            employee_id,
            has_worktree: false,
            worktree_path: None,
            branch_name: employee.branch_name,
            is_repo: false,
            dirty: false,
            changes: Vec::new(),
        });
    }

    let workspace_root = state.workspace_root();
    let path = resolve_employee_execution_dir(&workspace_root, &employee, None)?;
    let is_repo = git_success(&path, &["rev-parse", "--show-toplevel"]);
    let changes = if is_repo {
        parse_status_lines(&run_git(&path, &["status", "--porcelain"])?)
    } else {
        Vec::new()
    };
    let dirty = !changes.is_empty();

    Ok(WorktreeStatus {
        employee_id,
        has_worktree: true,
        worktree_path: Some(path.to_string_lossy().to_string()),
        branch_name: employee.branch_name,
        is_repo,
        dirty,
        changes,
    })
}

#[tauri::command]
pub fn git_worktree_remove_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_none() {
        return Ok(employee);
    }

    let workspace_root = state.workspace_root();
    let path = resolve_employee_execution_dir(&workspace_root, &employee, None)?;
    let changes = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    if !changes.is_empty() {
        return Err(
            "worktree has uncommitted changes; review or discard before removing".to_string(),
        );
    }

    // TODO: add a deliberate force-remove path behind a git_operation approval.
    run_git(
        &workspace_root,
        &["worktree", "remove", path_to_str(&path)?],
    )?;

    let updated = state
        .employees
        .update(&employee_id, |employee| {
            employee.worktree_path = None;
            employee.branch_name = None;
            employee.cwd = workspace_root.to_string_lossy().to_string();
        })
        .ok_or_else(|| "employee not found".to_string())?;
    state.persist()?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("removed worktree for {}", updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    Ok(updated)
}

#[tauri::command]
pub fn git_worktree_diff_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<String, String> {
    let (path, _) = employee_worktree(&state, &employee_id)?;
    run_git(&path, &["diff"])
}

#[tauri::command]
pub fn git_worktree_review_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeReview, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_none() {
        return Err("employee has no worktree".to_string());
    }
    let workspace_root = state.workspace_root();
    let path = resolve_employee_execution_dir(&workspace_root, &employee, None)?;
    let status = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    let untracked_files = parse_untracked_files(&status);

    Ok(WorktreeReview {
        employee_id,
        worktree_path: path.to_string_lossy().to_string(),
        branch_name: employee.branch_name,
        status,
        unstaged_diff: run_git(&path, &["diff"])?,
        staged_diff: run_git(&path, &["diff", "--cached"])?,
        untracked_files,
    })
}

#[tauri::command]
pub fn git_worktree_changed_files_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Vec<String>, String> {
    let (path, _) = employee_worktree(&state, &employee_id)?;
    let status = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    Ok(parse_changed_files(&status))
}

#[tauri::command]
pub fn git_worktree_file_diff_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<String, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    let staged = run_git(&worktree, &["diff", "--cached", "--", &relative])?;
    let unstaged = run_git(&worktree, &["diff", "--", &relative])?;
    let status = parse_status_lines(&run_git(&worktree, &["status", "--porcelain"])?);
    Ok(
        match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
            (true, true) if is_untracked_file(&status, &relative) => {
                untracked_file_preview(&worktree, &relative)?
            }
            (true, true) => String::new(),
            (false, true) => format!("staged diff\n{staged}"),
            (true, false) => format!("unstaged diff\n{unstaged}"),
            (false, false) => format!("staged diff\n{staged}\nunstaged diff\n{unstaged}"),
        },
    )
}

#[tauri::command]
pub fn git_worktree_commit_preview_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeCommitPreview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let status = parse_status_lines(&run_git(&worktree, &["status", "--porcelain"])?);
    let staged_files = parse_staged_files(&status);

    Ok(WorktreeCommitPreview {
        employee_id,
        has_staged_changes: !staged_files.is_empty(),
        staged_files,
    })
}

#[tauri::command]
pub fn git_worktree_commit_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: WorktreeCommitRequest,
) -> Result<WorktreeCommit, String> {
    let message = validate_commit_message(&payload.message)?;
    let (worktree, _) = employee_worktree(&state, &payload.employee_id)?;
    let status = parse_status_lines(&run_git(&worktree, &["status", "--porcelain"])?);
    if !has_staged_changes(&status) {
        return Err("commit requires staged changes".to_string());
    }

    let output = run_git(&worktree, &["commit", "-m", message])?;
    let commit = git_log(&worktree, 1)?
        .into_iter()
        .next()
        .or_else(|| commit_from_output(&output))
        .ok_or_else(|| "commit succeeded but metadata could not be read".to_string())?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("committed worktree changes {}", commit.short_hash),
    );
    emit_employee_activity_updated(&app, Some(payload.employee_id));
    Ok(commit)
}

#[tauri::command]
pub fn git_worktree_log_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
    limit: Option<usize>,
) -> Result<Vec<WorktreeCommit>, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    git_log(&worktree, limit.unwrap_or(5).clamp(1, 20))
}

#[tauri::command]
pub fn git_worktree_handoff_preview_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeHandoffPreview, String> {
    let (worktree, branch_name) = employee_worktree(&state, &employee_id)?;
    let worktree_branch = branch_name.or_else(|| current_branch(&worktree).ok().flatten());
    let upstream_branch = upstream_branch(&worktree).ok().flatten();
    let workspace_root = state.workspace_root();
    let base_branch = upstream_branch
        .clone()
        .or_else(|| current_branch(&workspace_root).ok().flatten());
    let (behind, ahead) = base_branch
        .as_deref()
        .and_then(|base| ahead_behind(&worktree, base).ok())
        .unwrap_or((None, None));
    let head = git_log(&worktree, 1).ok().and_then(|mut commits| {
        if commits.is_empty() {
            None
        } else {
            Some(commits.remove(0))
        }
    });

    Ok(WorktreeHandoffPreview {
        employee_id,
        current_branch: worktree_branch,
        base_branch,
        upstream_branch,
        ahead,
        behind,
        head,
        message: "Handoff apply is available through preflight".to_string(),
    })
}

#[tauri::command]
pub fn git_worktree_handoff_preflight_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeHandoffPreflight, String> {
    let (worktree, branch_name) = employee_worktree(&state, &employee_id)?;
    let workspace_root = state.workspace_root();
    handoff_preflight_for_paths(employee_id, &workspace_root, &worktree, branch_name)
}

#[tauri::command]
pub fn git_worktree_apply_handoff_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: WorktreeHandoffApplyRequest,
) -> Result<WorktreeHandoffApplyResult, String> {
    if !payload.confirmed {
        return Err("handoff apply requires explicit confirmation".to_string());
    }

    let (worktree, branch_name) = employee_worktree(&state, &payload.employee_id)?;
    let workspace_root = state.workspace_root();
    let result = apply_handoff_for_paths(
        payload.employee_id.clone(),
        &workspace_root,
        &worktree,
        branch_name,
    )?;

    if result.applied {
        emit_log(
            &app,
            LogLevel::Info,
            format!("applied {} handoff commit(s)", result.applied_commits.len()),
        );
    } else if result.conflict {
        emit_log(
            &app,
            LogLevel::Warn,
            "handoff cherry-pick stopped with conflicts; resolve or abort in main workspace",
        );
    } else if let Some(error) = &result.error {
        emit_log(
            &app,
            LogLevel::Error,
            format!("handoff apply failed: {error}"),
        );
    }

    emit_employee_activity_updated(&app, Some(payload.employee_id));
    Ok(result)
}

#[tauri::command]
pub fn git_worktree_abort_handoff_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeHandoffAbortResult, String> {
    let workspace_root = state.workspace_root();
    let result = abort_handoff_for_paths(employee_id.clone(), &workspace_root)?;
    if result.aborted {
        emit_log(&app, LogLevel::Info, "aborted main workspace cherry-pick");
    }
    emit_employee_activity_updated(&app, Some(employee_id));
    Ok(result)
}

#[tauri::command]
pub fn git_worktree_stage_file(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    run_git(&worktree, &["add", "--", &relative])?;
    emit_employee_activity_updated(&app, Some(employee_id.clone()));
    git_worktree_review_for_employee(state, employee_id)
}

#[tauri::command]
pub fn git_worktree_discard_file_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let status = parse_status_lines(&run_git(&worktree, &["status", "--porcelain"])?);
    let relative = resolve_safe_worktree_relative_path(&worktree, &path)?;
    if !has_unstaged_change_for_path(&status, &relative) {
        return Err("file has no unstaged change to discard".to_string());
    }

    run_git(&worktree, &["restore", "--", &relative])?;
    emit_employee_activity_updated(&app, Some(employee_id.clone()));
    git_worktree_review_for_employee(state, employee_id)
}

#[tauri::command]
pub fn git_worktree_delete_untracked_file_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let status = parse_status_lines(&run_git(&worktree, &["status", "--porcelain"])?);
    remove_untracked_file(&worktree, &status, &path)?;
    emit_employee_activity_updated(&app, Some(employee_id.clone()));
    git_worktree_review_for_employee(state, employee_id)
}

#[tauri::command]
pub fn git_worktree_unstage_file(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    run_git(&worktree, &["restore", "--staged", "--", &relative])?;
    emit_employee_activity_updated(&app, Some(employee_id.clone()));
    git_worktree_review_for_employee(state, employee_id)
}

fn employee_worktree(
    state: &State<'_, AppState>,
    employee_id: &str,
) -> Result<(PathBuf, Option<String>), String> {
    let employee = state
        .employees
        .get(employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_none() {
        return Err("employee has no worktree".to_string());
    }
    let workspace_root = state.workspace_root();
    Ok((
        resolve_employee_execution_dir(&workspace_root, &employee, None)?,
        employee.branch_name,
    ))
}

fn handoff_preflight_for_paths(
    employee_id: String,
    workspace_root: &Path,
    worktree: &Path,
    employee_branch: Option<String>,
) -> Result<WorktreeHandoffPreflight, String> {
    let employee_branch = employee_branch.or_else(|| current_branch(worktree).ok().flatten());
    let main_branch = current_branch(workspace_root).ok().flatten();
    let main_head = git_head(workspace_root)?;
    let employee_head = git_head(worktree)?;
    let (behind, ahead) =
        ahead_behind_between(workspace_root, &main_head, &employee_head).unwrap_or((None, None));
    let commits_to_apply = git_commits_between(workspace_root, &main_head, &employee_head)?;
    let employee_status = parse_status_lines(&run_git(worktree, &["status", "--porcelain"])?);
    let main_status = parse_status_lines(&run_git(workspace_root, &["status", "--porcelain"])?);
    let employee_clean = employee_worktree_is_clean(&employee_status);
    let main_clean = !main_workspace_has_uncommitted_changes(&main_status);
    let main_operation = handoff_operation_state(workspace_root);
    let blockers = build_handoff_blockers(HandoffBlockerInput {
        employee_branch: employee_branch.as_deref(),
        main_branch: main_branch.as_deref(),
        commits_to_apply: commits_to_apply.len(),
        employee_clean,
        main_clean,
        main_operation: &main_operation,
    });
    let can_apply = blockers.is_empty();
    let message = if can_apply {
        format!("ready to cherry-pick {} commit(s)", commits_to_apply.len())
    } else {
        format!("blocked by {} condition(s)", blockers.len())
    };

    Ok(WorktreeHandoffPreflight {
        employee_id,
        employee_branch,
        main_branch,
        ahead,
        behind,
        commits_to_apply,
        employee_clean,
        main_clean,
        apply_strategy: "cherry_pick".to_string(),
        main_operation,
        blockers,
        can_apply,
        message,
    })
}

fn apply_handoff_for_paths(
    employee_id: String,
    workspace_root: &Path,
    worktree: &Path,
    employee_branch: Option<String>,
) -> Result<WorktreeHandoffApplyResult, String> {
    let preflight = handoff_preflight_for_paths(
        employee_id.clone(),
        workspace_root,
        worktree,
        employee_branch,
    )?;
    if !preflight.can_apply {
        return Err(format!(
            "handoff preflight blocked apply: {}",
            preflight.blockers.join("; ")
        ));
    }

    let mut args = vec!["cherry-pick".to_string(), "--no-edit".to_string()];
    args.extend(
        preflight
            .commits_to_apply
            .iter()
            .map(|commit| commit.hash.clone()),
    );
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = bounded_git_output(workspace_root, &arg_refs)?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.success {
        return Ok(WorktreeHandoffApplyResult {
            employee_id,
            applied: true,
            strategy: preflight.apply_strategy,
            applied_commits: preflight.commits_to_apply,
            conflict: false,
            error: None,
            stdout,
            stderr,
        });
    }

    let conflict = is_cherry_pick_conflict(&stdout, &stderr);
    Ok(WorktreeHandoffApplyResult {
        employee_id,
        applied: false,
        strategy: preflight.apply_strategy,
        applied_commits: Vec::new(),
        conflict,
        error: Some(git_failure_message(&stdout, &stderr)),
        stdout,
        stderr,
    })
}

fn abort_handoff_for_paths(
    employee_id: String,
    workspace_root: &Path,
) -> Result<WorktreeHandoffAbortResult, String> {
    let state = handoff_operation_state(workspace_root);
    if state.operation.as_deref() != Some("cherry_pick") {
        return Ok(WorktreeHandoffAbortResult {
            employee_id,
            aborted: false,
            operation: state.operation,
            stdout: String::new(),
            stderr: String::new(),
            message: "no cherry-pick handoff is in progress".to_string(),
        });
    }

    let output = bounded_git_output(workspace_root, &["cherry-pick", "--abort"])?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.success {
        Ok(WorktreeHandoffAbortResult {
            employee_id,
            aborted: true,
            operation: Some("cherry_pick".to_string()),
            stdout,
            stderr,
            message: "cherry-pick aborted".to_string(),
        })
    } else {
        Err(git_failure_message(&stdout, &stderr))
    }
}

fn ensure_slavey_excluded(repo_root: &Path) -> Result<bool, String> {
    let exclude_path_output = run_git(repo_root, &["rev-parse", "--git-path", "info/exclude"])?;
    let raw_path = PathBuf::from(exclude_path_output.trim());
    let exclude_path = if raw_path.is_absolute() {
        raw_path
    } else {
        repo_root.join(raw_path)
    };

    if let Some(parent) = exclude_path.parent() {
        std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = std_fs::read_to_string(&exclude_path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ".slavey/") {
        return Ok(false);
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(".slavey/\n");
    std_fs::write(&exclude_path, next).map_err(|error| error.to_string())?;
    Ok(true)
}

fn git_log(cwd: &Path, limit: usize) -> Result<Vec<WorktreeCommit>, String> {
    let limit = limit.clamp(1, 20).to_string();
    let output = run_git(
        cwd,
        &["log", "-n", &limit, "--pretty=format:%H%x1f%h%x1f%ct%x1f%s"],
    )?;
    Ok(parse_commit_log(&output))
}

fn git_commits_between(cwd: &Path, base: &str, head: &str) -> Result<Vec<WorktreeCommit>, String> {
    let range = format!("{base}..{head}");
    let output = run_git(
        cwd,
        &[
            "log",
            "--reverse",
            "--pretty=format:%H%x1f%h%x1f%ct%x1f%s",
            &range,
        ],
    )?;
    Ok(parse_commit_log(&output))
}

fn git_head(cwd: &Path) -> Result<String, String> {
    let head = run_git(cwd, &["rev-parse", "--verify", "HEAD"])?;
    non_empty_trimmed(head).ok_or_else(|| "git HEAD could not be resolved".to_string())
}

pub(crate) fn current_branch(cwd: &Path) -> Result<Option<String>, String> {
    let branch = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(non_empty_trimmed(branch).filter(|branch| branch != "HEAD"))
}

fn upstream_branch(cwd: &Path) -> Result<Option<String>, String> {
    match run_git(
        cwd,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    ) {
        Ok(branch) => Ok(non_empty_trimmed(branch)),
        Err(_) => Ok(None),
    }
}

fn ahead_behind(cwd: &Path, base: &str) -> Result<(Option<u32>, Option<u32>), String> {
    let range = format!("{base}...HEAD");
    let output = run_git(cwd, &["rev-list", "--left-right", "--count", &range])?;
    Ok(parse_ahead_behind(&output))
}

fn ahead_behind_between(
    cwd: &Path,
    base: &str,
    head: &str,
) -> Result<(Option<u32>, Option<u32>), String> {
    let range = format!("{base}...{head}");
    let output = run_git(cwd, &["rev-list", "--left-right", "--count", &range])?;
    Ok(parse_ahead_behind(&output))
}

struct HandoffBlockerInput<'a> {
    employee_branch: Option<&'a str>,
    main_branch: Option<&'a str>,
    commits_to_apply: usize,
    employee_clean: bool,
    main_clean: bool,
    main_operation: &'a WorktreeHandoffOperationState,
}

fn build_handoff_blockers(input: HandoffBlockerInput<'_>) -> Vec<String> {
    let mut blockers = Vec::new();
    if input.employee_branch.is_none() {
        blockers.push("employee worktree is not on a named branch".to_string());
    }
    if input.main_branch.is_none() {
        blockers.push("main workspace is not on a named branch".to_string());
    }
    if input.commits_to_apply == 0 {
        blockers.push("employee branch has no commits to apply".to_string());
    }
    if !input.employee_clean {
        blockers.push("employee worktree has uncommitted changes".to_string());
    }
    if !input.main_clean {
        blockers.push("main workspace has uncommitted changes".to_string());
    }
    if input.main_operation.in_progress {
        let operation = input.main_operation.operation.as_deref().unwrap_or("git");
        blockers.push(format!(
            "main workspace has an in-progress {operation} operation"
        ));
    }
    blockers
}

fn handoff_operation_state(cwd: &Path) -> WorktreeHandoffOperationState {
    if let Some(head) = git_state_head(cwd, "CHERRY_PICK_HEAD") {
        return WorktreeHandoffOperationState {
            in_progress: true,
            operation: Some("cherry_pick".to_string()),
            head: Some(head),
            can_abort: true,
            message: Some("cherry-pick in progress".to_string()),
        };
    }
    if let Some(head) = git_state_head(cwd, "MERGE_HEAD") {
        return WorktreeHandoffOperationState {
            in_progress: true,
            operation: Some("merge".to_string()),
            head: Some(head),
            can_abort: false,
            message: Some("merge in progress".to_string()),
        };
    }
    if git_state_path(cwd, "rebase-merge")
        .map(|path| path.exists())
        .unwrap_or(false)
        || git_state_path(cwd, "rebase-apply")
            .map(|path| path.exists())
            .unwrap_or(false)
    {
        return WorktreeHandoffOperationState {
            in_progress: true,
            operation: Some("rebase".to_string()),
            head: None,
            can_abort: false,
            message: Some("rebase in progress".to_string()),
        };
    }

    WorktreeHandoffOperationState {
        in_progress: false,
        operation: None,
        head: None,
        can_abort: false,
        message: None,
    }
}

fn git_state_head(cwd: &Path, name: &str) -> Option<String> {
    let path = git_state_path(cwd, name)?;
    std_fs::read_to_string(path)
        .ok()
        .and_then(non_empty_trimmed)
}

fn git_state_path(cwd: &Path, name: &str) -> Option<PathBuf> {
    run_git(cwd, &["rev-parse", "--git-path", name])
        .ok()
        .and_then(non_empty_trimmed)
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
}

fn is_cherry_pick_conflict(stdout: &str, stderr: &str) -> bool {
    let combined = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    combined.contains("conflict")
        || combined.contains("after resolving the conflicts")
        || combined.contains("fix conflicts")
}

fn git_failure_message(stdout: &str, stderr: &str) -> String {
    let stderr = stderr.trim();
    let stdout = stdout.trim();
    match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("{stderr}\n{stdout}"),
        (false, true) => stderr.to_string(),
        (true, false) => stdout.to_string(),
        (true, true) => "git command failed".to_string(),
    }
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn resolve_safe_worktree_relative_path(worktree: &Path, input: &str) -> Result<String, String> {
    let relative = resolve_worktree_relative_path(worktree, input)?;
    ensure_not_sensitive_git_path(&relative)?;
    Ok(relative)
}

fn resolve_worktree_relative_path(worktree: &Path, input: &str) -> Result<String, String> {
    let input_path = PathBuf::from(input);
    if input_path.is_absolute() {
        let resolved = if input_path.exists() {
            input_path
                .canonicalize()
                .map_err(|error| error.to_string())?
        } else {
            return Err("absolute path must exist inside the worktree".to_string());
        };
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let candidate = worktree.join(input_path);
    if candidate.exists() {
        let resolved = candidate
            .canonicalize()
            .map_err(|error| error.to_string())?;
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_path_inside(worktree, &parent)?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    let resolved = parent.join(file_name);
    ensure_path_inside(worktree, &resolved)?;
    path_to_str(
        resolved
            .strip_prefix(worktree)
            .map_err(|_| "path is outside the worktree".to_string())?,
    )
    .map(ToString::to_string)
}

fn remove_untracked_file(worktree: &Path, status: &[String], input: &str) -> Result<(), String> {
    let relative = resolve_safe_worktree_relative_path(worktree, input)?;
    if !is_untracked_file(status, &relative) {
        return Err("file is not untracked".to_string());
    }

    let target = worktree.join(&relative);
    let metadata = std_fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("untracked directory deletion is not supported".to_string());
    }
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std_fs::remove_file(&target).map_err(|error| error.to_string())
    } else {
        Err("untracked path is not a file".to_string())
    }
}

fn untracked_file_preview(worktree: &Path, relative: &str) -> Result<String, String> {
    let path = worktree.join(relative);
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    ensure_path_inside(worktree, &resolved)?;
    let metadata = std_fs::metadata(&resolved).map_err(|error| error.to_string())?;
    let header = format!("untracked file preview\npath: {relative}\nstatus: untracked\n\n");

    if !metadata.is_file() {
        return Ok(format!("{header}[untracked path is not a regular file]"));
    }

    if metadata.len() > MAX_UNTRACKED_PREVIEW_BYTES as u64 {
        return Ok(format!(
            "{header}[file is too large to preview: {} bytes]",
            metadata.len()
        ));
    }

    let mut file = std_fs::File::open(&resolved).map_err(|error| error.to_string())?;
    let mut contents = Vec::new();
    file.by_ref()
        .take((MAX_UNTRACKED_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut contents)
        .map_err(|error| error.to_string())?;

    if contents.contains(&0) {
        return Ok(format!("{header}[binary file omitted from preview]"));
    }

    if contents.len() > MAX_UNTRACKED_PREVIEW_BYTES {
        contents.truncate(MAX_UNTRACKED_PREVIEW_BYTES);
        return Ok(format!(
            "{}{} \n[preview truncated at {} bytes]",
            header,
            String::from_utf8_lossy(&contents),
            MAX_UNTRACKED_PREVIEW_BYTES
        ));
    }

    Ok(format!("{header}{}", String::from_utf8_lossy(&contents)))
}

fn ensure_path_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("path is outside the worktree".to_string())
    }
}

fn ensure_not_sensitive_git_path(path: &str) -> Result<(), String> {
    if path.split(['/', '\\']).any(is_sensitive_name) {
        Err("path is blocked because it may contain secrets or credentials".to_string())
    } else {
        Ok(())
    }
}

fn is_sensitive_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == ".ssh"
        || lower == ".git"
        || lower == ".npmrc"
        || lower == ".pypirc"
        || lower == "credentials"
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
}

fn branch_name_for_employee(employee: &Employee) -> String {
    let sanitized = sanitize_branch_component(&employee.name);
    let fallback = employee.id.chars().take(8).collect::<String>();
    if sanitized.is_empty() {
        format!("slavey/{fallback}")
    } else {
        format!("slavey/{sanitized}-{fallback}")
    }
}

fn sanitize_branch_component(input: &str) -> String {
    input
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if matches!(character, '-' | '_' | ' ' | '.') {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn path_to_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs as std_fs, path::PathBuf};

    use super::{
        build_handoff_blockers, handoff_preflight_for_paths, is_cherry_pick_conflict,
        parse_status_lines, remove_untracked_file, resolve_safe_worktree_relative_path, run_git,
        untracked_file_preview, HandoffBlockerInput, WorktreeHandoffOperationState,
    };

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-git-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn preflight_blockers_report_unsafe_apply_conditions() {
        let operation = WorktreeHandoffOperationState {
            in_progress: true,
            operation: Some("cherry_pick".to_string()),
            head: Some("abc123".to_string()),
            can_abort: true,
            message: Some("cherry-pick in progress".to_string()),
        };

        let blockers = build_handoff_blockers(HandoffBlockerInput {
            employee_branch: None,
            main_branch: Some("main"),
            commits_to_apply: 0,
            employee_clean: false,
            main_clean: false,
            main_operation: &operation,
        });

        assert!(blockers
            .iter()
            .any(|blocker| blocker.contains("not on a named branch")));
        assert!(blockers
            .iter()
            .any(|blocker| blocker.contains("no commits to apply")));
        assert!(blockers
            .iter()
            .any(|blocker| blocker.contains("employee worktree has uncommitted changes")));
        assert!(blockers
            .iter()
            .any(|blocker| blocker.contains("main workspace has uncommitted changes")));
        assert!(blockers
            .iter()
            .any(|blocker| blocker.contains("in-progress cherry_pick")));
    }

    #[test]
    fn cherry_pick_conflict_parser_detects_git_conflict_output() {
        assert!(is_cherry_pick_conflict(
            "CONFLICT (content): Merge conflict in src/lib.rs",
            "error: could not apply abc123... Change file"
        ));
        assert!(is_cherry_pick_conflict(
            "",
            "hint: after resolving the conflicts, mark the corrected paths"
        ));
        assert!(!is_cherry_pick_conflict(
            "",
            "fatal: bad revision 'missing-branch'"
        ));
    }

    #[test]
    fn handoff_preflight_lists_employee_only_commits_in_temp_repo() {
        let root = test_root("handoff-preflight-repo");
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Slavey Test"]).unwrap();
        run_git(&root, &["config", "user.email", "slavey@example.test"]).unwrap();
        run_git(&root, &["checkout", "-B", "main"]).unwrap();
        super::ensure_slavey_excluded(&root).unwrap();
        std_fs::write(root.join("README.md"), "base\n").unwrap();
        run_git(&root, &["add", "README.md"]).unwrap();
        run_git(&root, &["commit", "-m", "Initial"]).unwrap();

        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(worktree.parent().unwrap()).unwrap();
        run_git(
            &root,
            &[
                "worktree",
                "add",
                "-b",
                "slavey/test",
                worktree.to_str().unwrap(),
                "HEAD",
            ],
        )
        .unwrap();
        std_fs::write(worktree.join("feature.txt"), "feature\n").unwrap();
        run_git(&worktree, &["add", "feature.txt"]).unwrap();
        run_git(&worktree, &["commit", "-m", "Add feature"]).unwrap();

        let preflight = handoff_preflight_for_paths(
            "employee-1".to_string(),
            &root,
            &worktree,
            Some("slavey/test".to_string()),
        )
        .unwrap();

        assert_eq!(preflight.employee_branch.as_deref(), Some("slavey/test"));
        assert_eq!(preflight.main_branch.as_deref(), Some("main"));
        assert_eq!(preflight.ahead, Some(1));
        assert_eq!(preflight.behind, Some(0));
        assert_eq!(preflight.commits_to_apply.len(), 1);
        assert_eq!(preflight.commits_to_apply[0].message, "Add feature");
        assert!(preflight.employee_clean);
        assert!(preflight.main_clean);
        assert!(preflight.can_apply);
    }

    #[test]
    fn untracked_preview_includes_bounded_text_content() {
        let root = test_root("untracked-preview");
        std_fs::write(root.join("new.txt"), "hello\nworld\n").unwrap();

        let preview = untracked_file_preview(&root, "new.txt").unwrap();

        assert!(preview.contains("untracked file preview"));
        assert!(preview.contains("path: new.txt"));
        assert!(preview.contains("hello\nworld"));
    }

    #[test]
    fn untracked_preview_rejects_paths_outside_worktree() {
        let root = test_root("untracked-preview-outside");
        let outside = root
            .parent()
            .unwrap()
            .join(format!("slavey-git-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "outside").unwrap();

        let error = untracked_file_preview(&root, outside.to_str().unwrap()).unwrap_err();

        assert!(error.contains("outside the worktree"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn untracked_preview_omits_binary_content() {
        let root = test_root("untracked-preview-binary");
        std_fs::write(root.join("binary.bin"), b"abc\0def").unwrap();

        let preview = untracked_file_preview(&root, "binary.bin").unwrap();

        assert!(preview.contains("binary file omitted"));
    }

    #[test]
    fn worktree_relative_path_rejects_parent_escape_for_destructive_ops() {
        let root = test_root("destructive-path-outside");
        let outside = root
            .parent()
            .unwrap()
            .join(format!("slavey-git-outside-{}.txt", uuid::Uuid::new_v4()));
        std_fs::write(&outside, "outside").unwrap();

        let error =
            resolve_safe_worktree_relative_path(&root, outside.to_str().unwrap()).unwrap_err();

        assert!(error.contains("outside the worktree"));
        let _ = std_fs::remove_file(outside);
    }

    #[test]
    fn worktree_relative_path_rejects_sensitive_paths_for_destructive_ops() {
        let root = test_root("destructive-path-sensitive");
        std_fs::write(root.join(".env"), "SECRET=1").unwrap();

        let error = resolve_safe_worktree_relative_path(&root, ".env").unwrap_err();

        assert!(error.contains("secrets or credentials"));
    }

    #[test]
    fn untracked_file_delete_removes_only_status_marked_file() {
        let root = test_root("untracked-delete");
        std_fs::write(root.join("scratch.txt"), "temporary").unwrap();
        let status = parse_status_lines("?? scratch.txt\n");

        remove_untracked_file(&root, &status, "scratch.txt").unwrap();

        assert!(!root.join("scratch.txt").exists());
    }

    #[test]
    fn untracked_file_delete_rejects_tracked_or_unknown_file() {
        let root = test_root("untracked-delete-reject");
        std_fs::write(root.join("tracked.txt"), "keep").unwrap();
        let status = parse_status_lines(" M tracked.txt\n");

        let error = remove_untracked_file(&root, &status, "tracked.txt").unwrap_err();

        assert!(error.contains("not untracked"));
        assert!(root.join("tracked.txt").exists());
    }

    #[test]
    fn untracked_file_delete_rejects_directories() {
        let root = test_root("untracked-delete-dir");
        std_fs::create_dir(root.join("scratch-dir")).unwrap();
        let status = parse_status_lines("?? scratch-dir/\n");

        let error = remove_untracked_file(&root, &status, "scratch-dir").unwrap_err();

        assert!(error.contains("directory deletion is not supported"));
        assert!(root.join("scratch-dir").exists());
    }
}
