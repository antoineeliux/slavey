use std::{
    fs as std_fs,
    path::{Path, PathBuf},
};

use tauri::State;

use crate::{
    employees::{resolve_employee_execution_dir, Employee},
    AppState,
};

use super::run_git;

pub(super) fn employee_worktree(
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

pub(super) fn ensure_slavey_excluded(repo_root: &Path) -> Result<bool, String> {
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

pub(super) fn branch_name_for_employee(employee: &Employee) -> String {
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

pub(super) fn path_to_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}
