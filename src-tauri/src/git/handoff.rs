use std::{
    fs as std_fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::parsing::{
    employee_worktree_is_clean, main_workspace_has_uncommitted_changes, parse_status_lines,
};
use super::review::conflicted_files_from_status;
use super::runner::bounded_git_output;
use super::{
    ahead_behind_between, current_branch, git_commits_between, git_failure_message, git_head,
    non_empty_trimmed, run_git, WorktreeCommit,
};

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
    pub main_conflicted_files: Vec<String>,
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

struct HandoffBlockerInput<'a> {
    employee_branch: Option<&'a str>,
    main_branch: Option<&'a str>,
    commits_to_apply: usize,
    employee_clean: bool,
    main_clean: bool,
    main_operation: &'a WorktreeHandoffOperationState,
}

pub(super) fn handoff_preflight_for_paths(
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
    let main_conflicted_files = conflicted_files_from_status(&main_status);
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
        main_conflicted_files,
        apply_strategy: "cherry_pick".to_string(),
        main_operation,
        blockers,
        can_apply,
        message,
    })
}

pub(super) fn apply_handoff_for_paths(
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

pub(super) fn abort_handoff_for_paths(
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

pub(super) fn handoff_operation_state(cwd: &Path) -> WorktreeHandoffOperationState {
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
    if git_state_path(cwd, "BISECT_LOG")
        .map(|path| path.exists())
        .unwrap_or(false)
    {
        return WorktreeHandoffOperationState {
            in_progress: true,
            operation: Some("bisect".to_string()),
            head: None,
            can_abort: false,
            message: Some("bisect in progress".to_string()),
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

#[cfg(test)]
mod tests {
    use std::{fs as std_fs, path::PathBuf};

    use super::{
        build_handoff_blockers, handoff_operation_state, handoff_preflight_for_paths,
        is_cherry_pick_conflict, HandoffBlockerInput, WorktreeHandoffOperationState,
    };
    use crate::git::run_git;

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
    fn operation_state_detects_bisect() {
        let root = test_root("bisect-state");
        run_git(&root, &["init"]).unwrap();
        std_fs::write(root.join(".git").join("BISECT_LOG"), "git bisect start\n").unwrap();

        let operation = handoff_operation_state(&root);

        assert!(operation.in_progress);
        assert_eq!(operation.operation.as_deref(), Some("bisect"));
    }

    #[test]
    fn handoff_preflight_lists_employee_only_commits_in_temp_repo() {
        let root = test_root("handoff-preflight-repo");
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Slavey Test"]).unwrap();
        run_git(&root, &["config", "user.email", "slavey@example.test"]).unwrap();
        run_git(&root, &["checkout", "-B", "main"]).unwrap();
        super::super::ensure_slavey_excluded(&root).unwrap();
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
}
