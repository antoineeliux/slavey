use std::{
    fs as std_fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    employees::Employee,
    events::{emit_employee_updated, emit_log, LogLevel},
    fs::resolve_existing_dir,
    AppState,
};

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

#[tauri::command]
pub fn git_is_repo(state: State<'_, AppState>, path: Option<String>) -> bool {
    let root = match path {
        Some(path) if !path.trim().is_empty() => {
            match resolve_existing_dir(&state.workspace_root, &path) {
                Ok(path) => path,
                Err(_) => return false,
            }
        }
        _ => state.workspace_root.clone(),
    };

    git_success(&root, &["rev-parse", "--show-toplevel"])
}

#[tauri::command]
pub fn git_worktree_create_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    if !git_success(&state.workspace_root, &["rev-parse", "--show-toplevel"]) {
        return Err("workspace root is not a git repository".to_string());
    }

    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_some() {
        return Err("employee already has a worktree".to_string());
    }

    let worktree_root = state.workspace_root.join(".slavey").join("worktrees");
    std_fs::create_dir_all(&worktree_root).map_err(|error| error.to_string())?;
    if ensure_slavey_excluded(&state.workspace_root)? {
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
        &state.workspace_root,
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
        &state.workspace_root,
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
    let Some(worktree_path) = employee.worktree_path.clone() else {
        return Ok(WorktreeStatus {
            employee_id,
            has_worktree: false,
            worktree_path: None,
            branch_name: employee.branch_name,
            is_repo: false,
            dirty: false,
            changes: Vec::new(),
        });
    };

    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
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
    let Some(worktree_path) = employee.worktree_path else {
        return Ok(employee);
    };

    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
    let changes = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    if !changes.is_empty() {
        return Err(
            "worktree has uncommitted changes; review or discard before removing".to_string(),
        );
    }

    // TODO: add a deliberate force-remove path behind a git_operation approval.
    run_git(
        &state.workspace_root,
        &["worktree", "remove", path_to_str(&path)?],
    )?;

    let updated = state
        .employees
        .update(&employee_id, |employee| {
            employee.worktree_path = None;
            employee.branch_name = None;
            employee.cwd = state.workspace_root.to_string_lossy().to_string();
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
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let worktree_path = employee
        .worktree_path
        .ok_or_else(|| "employee has no worktree".to_string())?;
    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
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
    let worktree_path = employee
        .worktree_path
        .ok_or_else(|| "employee has no worktree".to_string())?;
    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
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

fn git_success(cwd: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err("git command failed".to_string())
        } else {
            Err(stderr)
        }
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

fn parse_status_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(ToString::to_string)
        .collect()
}

fn parse_untracked_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter_map(|line| line.strip_prefix("?? "))
        .map(ToString::to_string)
        .collect()
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
    use super::{parse_status_lines, parse_untracked_files};

    #[test]
    fn status_parser_detects_clean_output() {
        assert!(parse_status_lines("").is_empty());
        assert!(parse_status_lines("\n\n").is_empty());
    }

    #[test]
    fn status_parser_keeps_dirty_lines() {
        let changes = parse_status_lines(" M src/main.rs\n?? new.txt\n");
        assert_eq!(changes, vec![" M src/main.rs", "?? new.txt"]);
    }

    #[test]
    fn untracked_parser_extracts_only_untracked_paths() {
        let changes =
            parse_status_lines(" M src/main.rs\nA  staged.rs\n?? new.txt\n?? dir/file.rs\n");

        assert_eq!(
            parse_untracked_files(&changes),
            vec!["new.txt".to_string(), "dir/file.rs".to_string()]
        );
    }
}
