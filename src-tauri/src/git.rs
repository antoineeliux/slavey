use std::{
    fs as std_fs,
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

mod diff;
mod handoff;
mod parsing;
mod review;
mod runner;
mod worktree;

use self::diff::{
    remove_untracked_file, resolve_safe_worktree_relative_path, untracked_file_preview,
};
use self::handoff::{
    abort_handoff_for_paths, apply_handoff_for_paths, handoff_operation_state,
    handoff_preflight_for_paths,
};
pub use self::handoff::{
    WorktreeHandoffAbortResult, WorktreeHandoffApplyRequest, WorktreeHandoffApplyResult,
    WorktreeHandoffOperationState, WorktreeHandoffPreflight, WorktreeHandoffPreview,
};
use self::parsing::{
    commit_from_output, has_staged_changes, has_unstaged_change_for_path, is_untracked_file,
    parse_ahead_behind, parse_changed_files, parse_commit_log, parse_staged_files,
    validate_commit_message,
};
use self::review::{
    bounded_review_diff, conflicted_files_from_status, file_diff_or_marker, review_blockers,
    review_disabled_reasons, review_files_from_status, worktree_remote_info,
    ReviewDisabledReasonInput,
};
pub use self::review::{WorktreeRemoteInfo, WorktreeReviewDisabledReasons, WorktreeReviewFile};
use self::worktree::{
    branch_name_for_employee, employee_worktree, ensure_slavey_excluded, path_to_str,
};
pub(crate) use self::{
    parsing::parse_status_lines,
    runner::{git_success, run_git},
};

const MAX_REVIEW_RECENT_COMMITS: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathChanges {
    pub root: String,
    pub repo_root: Option<String>,
    pub is_repo: bool,
    pub clean: bool,
    pub status: Vec<String>,
    pub changed_files: Vec<String>,
    pub files: Vec<WorktreeReviewFile>,
}

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
    pub base_branch: Option<String>,
    pub upstream_branch: Option<String>,
    pub remote: WorktreeRemoteInfo,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub upstream_ahead: Option<u32>,
    pub upstream_behind: Option<u32>,
    pub clean: bool,
    pub status: Vec<String>,
    pub changed_files: Vec<String>,
    pub files: Vec<WorktreeReviewFile>,
    pub staged_files: Vec<String>,
    pub unstaged_files: Vec<String>,
    pub unstaged_diff: String,
    pub staged_diff: String,
    pub untracked_files: Vec<String>,
    pub conflicted_files: Vec<String>,
    pub recent_commits: Vec<WorktreeCommit>,
    pub handoff: Option<WorktreeHandoffPreflight>,
    pub operation: WorktreeHandoffOperationState,
    pub blockers: Vec<String>,
    pub disabled_reasons: WorktreeReviewDisabledReasons,
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
pub fn git_changes_for_path(
    state: State<'_, AppState>,
    root: String,
) -> Result<GitPathChanges, String> {
    let workspace_root = state.workspace_root();
    let root = resolve_existing_dir(&workspace_root, &root)?;
    let Some(repo_root) = repo_root_for_path(&workspace_root, &root)? else {
        return Ok(GitPathChanges {
            root: root.to_string_lossy().to_string(),
            repo_root: None,
            is_repo: false,
            clean: true,
            status: Vec::new(),
            changed_files: Vec::new(),
            files: Vec::new(),
        });
    };

    let status = parse_status_lines(&run_git(&repo_root, &["status", "--porcelain"])?);
    let changed_files = parse_changed_files(&status);
    let files = review_files_from_status(&status);
    Ok(GitPathChanges {
        root: root.to_string_lossy().to_string(),
        repo_root: Some(repo_root.to_string_lossy().to_string()),
        is_repo: true,
        clean: status.is_empty(),
        status,
        changed_files,
        files,
    })
}

#[tauri::command]
pub fn git_file_diff_for_path(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<String, String> {
    let workspace_root = state.workspace_root();
    let root = resolve_existing_dir(&workspace_root, &root)?;
    let repo_root = repo_root_for_path(&workspace_root, &root)?
        .ok_or_else(|| "folder is not inside a git repository".to_string())?;
    let relative = resolve_safe_worktree_relative_path(&repo_root, &path)?;
    let staged = file_diff_or_marker(&repo_root, &["diff", "--cached", "--", &relative]);
    let unstaged = file_diff_or_marker(&repo_root, &["diff", "--", &relative]);
    let status = parse_status_lines(&run_git(&repo_root, &["status", "--porcelain"])?);
    match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
        (true, true) if is_untracked_file(&status, &relative) => {
            untracked_file_preview(&repo_root, &relative)
        }
        (true, true) => Ok(String::new()),
        (false, true) => Ok(format!("staged diff\n{staged}")),
        (true, false) => Ok(format!("unstaged diff\n{unstaged}")),
        (false, false) => Ok(format!("staged diff\n{staged}\nunstaged diff\n{unstaged}")),
    }
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
    let branch_name = employee
        .branch_name
        .clone()
        .or_else(|| current_branch(&path).ok().flatten());
    let base_branch = current_branch(&workspace_root).ok().flatten();
    let upstream_branch = upstream_branch(&path).ok().flatten();
    let (behind, ahead) = base_branch
        .as_deref()
        .and_then(|base| ahead_behind(&path, base).ok())
        .unwrap_or((None, None));
    let (upstream_behind, upstream_ahead) = upstream_branch
        .as_deref()
        .and_then(|upstream| ahead_behind(&path, upstream).ok())
        .unwrap_or((None, None));
    let remote = worktree_remote_info(
        &path,
        upstream_branch.clone(),
        upstream_ahead,
        upstream_behind,
    );
    let status = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    let files = review_files_from_status(&status);
    let changed_files = parse_changed_files(&status);
    let staged_files = files
        .iter()
        .filter(|file| file.staged)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let unstaged_files = files
        .iter()
        .filter(|file| file.unstaged)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let untracked_files = files
        .iter()
        .filter(|file| file.untracked)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let conflicted_files = files
        .iter()
        .filter(|file| file.conflicted)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let clean = status.is_empty();
    let recent_commits = git_log(&path, MAX_REVIEW_RECENT_COMMITS).unwrap_or_default();
    let operation = handoff_operation_state(&path);
    let mut blockers = review_blockers(&path, &conflicted_files, &operation);
    let handoff = match handoff_preflight_for_paths(
        employee_id.clone(),
        &workspace_root,
        &path,
        branch_name.clone(),
    ) {
        Ok(preflight) => Some(preflight),
        Err(error) => {
            blockers.push(format!("handoff preflight unavailable: {error}"));
            None
        }
    };
    let disabled_reasons = review_disabled_reasons(ReviewDisabledReasonInput {
        staged_files: staged_files.len(),
        unstaged_files: unstaged_files.len(),
        untracked_files: untracked_files.len(),
        conflicted_files: conflicted_files.len(),
        operation: &operation,
        handoff: handoff.as_ref(),
        remote: &remote,
    });

    Ok(WorktreeReview {
        employee_id,
        worktree_path: path.to_string_lossy().to_string(),
        branch_name,
        base_branch,
        upstream_branch,
        remote,
        ahead,
        behind,
        upstream_ahead,
        upstream_behind,
        clean,
        status,
        changed_files,
        files,
        staged_files,
        unstaged_files,
        unstaged_diff: bounded_review_diff(&path, &["diff"]),
        staged_diff: bounded_review_diff(&path, &["diff", "--cached"]),
        untracked_files,
        conflicted_files,
        recent_commits,
        handoff,
        operation,
        blockers,
        disabled_reasons,
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
    let relative = resolve_safe_worktree_relative_path(&worktree, &path)?;
    let staged = file_diff_or_marker(&worktree, &["diff", "--cached", "--", &relative]);
    let unstaged = file_diff_or_marker(&worktree, &["diff", "--", &relative]);
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
    let conflicted_files = conflicted_files_from_status(&status);
    if !conflicted_files.is_empty() {
        return Err(format!(
            "commit is blocked until conflicted files are resolved: {}",
            conflicted_files.join(", ")
        ));
    }
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
    let relative = resolve_safe_worktree_relative_path(&worktree, &path)?;
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
    let relative = resolve_safe_worktree_relative_path(&worktree, &path)?;
    run_git(&worktree, &["restore", "--staged", "--", &relative])?;
    emit_employee_activity_updated(&app, Some(employee_id.clone()));
    git_worktree_review_for_employee(state, employee_id)
}

fn git_log(cwd: &Path, limit: usize) -> Result<Vec<WorktreeCommit>, String> {
    let limit = limit.clamp(1, 20).to_string();
    let output = run_git(
        cwd,
        &["log", "-n", &limit, "--pretty=format:%H%x1f%h%x1f%ct%x1f%s"],
    )?;
    Ok(parse_commit_log(&output))
}

fn repo_root_for_path(workspace_root: &Path, path: &Path) -> Result<Option<PathBuf>, String> {
    let Ok(output) = run_git(path, &["rev-parse", "--show-toplevel"]) else {
        return Ok(None);
    };
    let Some(repo_root) = non_empty_trimmed(output) else {
        return Ok(None);
    };
    resolve_existing_dir(workspace_root, &repo_root).map(Some)
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
