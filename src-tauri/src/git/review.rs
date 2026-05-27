use std::path::Path;

use serde::Serialize;

use super::{
    git_success, non_empty_trimmed, run_git, WorktreeHandoffOperationState,
    WorktreeHandoffPreflight,
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReviewFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
    pub deleted: bool,
    pub renamed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoteInfo {
    pub remote_name: Option<String>,
    pub remote_url: Option<String>,
    pub upstream_branch: Option<String>,
    pub upstream_exists: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub push_disabled_reason: Option<String>,
    pub pull_request_disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReviewDisabledReasons {
    pub commit: Option<String>,
    pub discard: Option<String>,
    pub delete_untracked: Option<String>,
    pub handoff_apply: Option<String>,
    pub push: Option<String>,
    pub pull_request: Option<String>,
}

pub(super) struct ReviewDisabledReasonInput<'a> {
    pub(super) staged_files: usize,
    pub(super) unstaged_files: usize,
    pub(super) untracked_files: usize,
    pub(super) conflicted_files: usize,
    pub(super) operation: &'a WorktreeHandoffOperationState,
    pub(super) handoff: Option<&'a WorktreeHandoffPreflight>,
    pub(super) remote: &'a WorktreeRemoteInfo,
}

pub(super) fn worktree_remote_info(
    worktree: &Path,
    upstream_branch: Option<String>,
    ahead: Option<u32>,
    behind: Option<u32>,
) -> WorktreeRemoteInfo {
    let remote_name = upstream_branch
        .as_deref()
        .and_then(|branch| branch.split_once('/').map(|(remote, _)| remote.to_string()))
        .or_else(|| first_remote(worktree));
    let remote_url = remote_name
        .as_deref()
        .and_then(|remote| {
            run_git(
                worktree,
                &["config", "--get", &format!("remote.{remote}.url")],
            )
            .ok()
        })
        .and_then(non_empty_trimmed);
    let upstream_exists = run_git(worktree, &["rev-parse", "--verify", "@{upstream}"]).is_ok();
    let push_disabled_reason = future_push_disabled_reason(
        remote_name.as_deref(),
        remote_url.as_deref(),
        upstream_branch.as_deref(),
    );
    let pull_request_disabled_reason =
        future_pull_request_disabled_reason(remote_name.as_deref(), upstream_branch.as_deref());

    WorktreeRemoteInfo {
        remote_name,
        remote_url,
        upstream_branch,
        upstream_exists,
        ahead,
        behind,
        push_disabled_reason,
        pull_request_disabled_reason,
    }
}

fn first_remote(worktree: &Path) -> Option<String> {
    run_git(worktree, &["remote"]).ok().and_then(|output| {
        output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(ToString::to_string)
    })
}

fn future_push_disabled_reason(
    remote_name: Option<&str>,
    remote_url: Option<&str>,
    upstream_branch: Option<&str>,
) -> Option<String> {
    if upstream_branch.is_none() {
        return Some("no upstream configured".to_string());
    }
    if remote_name.is_none() {
        return Some("no remote configured".to_string());
    }
    if remote_url.is_none() {
        return Some("remote URL unavailable".to_string());
    }
    Some("push is not implemented yet".to_string())
}

fn future_pull_request_disabled_reason(
    remote_name: Option<&str>,
    upstream_branch: Option<&str>,
) -> Option<String> {
    if upstream_branch.is_none() {
        return Some("no upstream configured".to_string());
    }
    if remote_name.is_none() {
        return Some("no remote configured".to_string());
    }
    Some("pull request creation is not implemented yet".to_string())
}

pub(super) fn review_files_from_status(status: &[String]) -> Vec<WorktreeReviewFile> {
    status
        .iter()
        .filter_map(|line| review_file_from_status_line(line))
        .collect()
}

fn review_file_from_status_line(line: &str) -> Option<WorktreeReviewFile> {
    let path = status_path_from_line(line)?;
    let status = if line.len() >= 2 {
        line[..2].to_string()
    } else {
        line.to_string()
    };
    let staged_code = line.as_bytes().first().copied().unwrap_or(b' ');
    let unstaged_code = line.as_bytes().get(1).copied().unwrap_or(b' ');
    let untracked = line.starts_with("?? ");
    let conflicted = status_line_is_conflicted(line);
    let staged = !untracked && staged_code != b' ' && staged_code != b'?';
    let unstaged = !untracked && unstaged_code != b' ';
    let deleted = staged_code == b'D' || unstaged_code == b'D';
    let renamed = staged_code == b'R' || line.contains(" -> ");

    Some(WorktreeReviewFile {
        path,
        status,
        staged,
        unstaged,
        untracked,
        conflicted,
        deleted,
        renamed,
    })
}

fn status_path_from_line(line: &str) -> Option<String> {
    if line.len() < 4 {
        return None;
    }
    let path = &line[3..];
    if let Some((_, to)) = path.split_once(" -> ") {
        Some(to.to_string())
    } else {
        Some(path.to_string())
    }
}

pub(super) fn conflicted_files_from_status(status: &[String]) -> Vec<String> {
    review_files_from_status(status)
        .into_iter()
        .filter(|file| file.conflicted)
        .map(|file| file.path)
        .collect()
}

fn status_line_is_conflicted(line: &str) -> bool {
    let Some(staged) = line.as_bytes().first().copied() else {
        return false;
    };
    let Some(unstaged) = line.as_bytes().get(1).copied() else {
        return false;
    };
    matches!(
        (staged, unstaged),
        (b'D', b'D')
            | (b'A', b'U')
            | (b'U', b'D')
            | (b'U', b'A')
            | (b'D', b'U')
            | (b'A', b'A')
            | (b'U', b'U')
    )
}

pub(super) fn review_blockers(
    worktree: &Path,
    conflicted_files: &[String],
    operation: &WorktreeHandoffOperationState,
) -> Vec<String> {
    let mut blockers = Vec::new();
    if !git_success(worktree, &["rev-parse", "--show-toplevel"]) {
        blockers.push("employee worktree is not a git repository".to_string());
    }
    if !conflicted_files.is_empty() {
        blockers.push(format!(
            "worktree has {} conflicted file(s)",
            conflicted_files.len()
        ));
    }
    if operation.in_progress {
        let operation = operation.operation.as_deref().unwrap_or("git");
        blockers.push(format!("worktree has an in-progress {operation} operation"));
    }
    blockers
}

pub(super) fn review_disabled_reasons(
    input: ReviewDisabledReasonInput<'_>,
) -> WorktreeReviewDisabledReasons {
    let commit = if input.conflicted_files > 0 {
        Some("resolve conflicted files before committing".to_string())
    } else if input.operation.in_progress {
        Some("finish or abort the in-progress git operation before committing".to_string())
    } else if input.staged_files == 0 {
        Some("stage files before committing".to_string())
    } else {
        None
    };
    let discard = (input.unstaged_files == 0)
        .then(|| "select a file with unstaged changes to discard".to_string());
    let delete_untracked =
        (input.untracked_files == 0).then(|| "select an untracked file to delete".to_string());
    let handoff_apply = match input.handoff {
        Some(handoff) if handoff.can_apply => None,
        Some(handoff) if !handoff.blockers.is_empty() => Some(handoff.blockers.join("; ")),
        Some(_) => Some("handoff apply is not ready".to_string()),
        None => Some("handoff preflight is unavailable".to_string()),
    };

    WorktreeReviewDisabledReasons {
        commit,
        discard,
        delete_untracked,
        handoff_apply,
        push: input.remote.push_disabled_reason.clone(),
        pull_request: input.remote.pull_request_disabled_reason.clone(),
    }
}

pub(super) fn bounded_review_diff(cwd: &Path, args: &[&str]) -> String {
    match run_git(cwd, args) {
        Ok(output) => output,
        Err(error) if error.contains("output exceeded") => format!("[diff omitted: {error}]"),
        Err(error) => format!("[diff unavailable: {error}]"),
    }
}

pub(super) fn file_diff_or_marker(cwd: &Path, args: &[&str]) -> String {
    match run_git(cwd, args) {
        Ok(output) if output.contains("Binary files ") => {
            format!("binary file diff omitted\n{output}")
        }
        Ok(output) => output,
        Err(error) if error.contains("output exceeded") => format!("[diff omitted: {error}]"),
        Err(error) => format!("[diff unavailable: {error}]"),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs as std_fs, path::PathBuf};

    use super::super::{
        ahead_behind, handoff::WorktreeHandoffOperationState, parse_status_lines, run_git,
        upstream_branch,
    };
    use super::{
        conflicted_files_from_status, file_diff_or_marker, review_disabled_reasons,
        review_files_from_status, worktree_remote_info, ReviewDisabledReasonInput,
        WorktreeRemoteInfo,
    };

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("slavey-git-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn structured_review_groups_status_lines() {
        let status = parse_status_lines(
            "MM src/lib.rs\nA  staged.rs\n M unstaged.rs\n?? scratch.txt\nUU conflict.txt\nR  old.rs -> new.rs\n D deleted.rs\n",
        );

        let files = review_files_from_status(&status);
        let conflicted = conflicted_files_from_status(&status);

        assert!(files
            .iter()
            .any(|file| file.path == "src/lib.rs" && file.staged && file.unstaged));
        assert!(files
            .iter()
            .any(|file| file.path == "scratch.txt" && file.untracked));
        assert!(files
            .iter()
            .any(|file| file.path == "new.rs" && file.renamed));
        assert!(files
            .iter()
            .any(|file| file.path == "deleted.rs" && file.deleted));
        assert_eq!(conflicted, vec!["conflict.txt".to_string()]);
    }

    #[test]
    fn review_disabled_reasons_report_blockers_and_remote_readiness() {
        let operation = WorktreeHandoffOperationState {
            in_progress: false,
            operation: None,
            head: None,
            can_abort: false,
            message: None,
        };
        let remote = WorktreeRemoteInfo {
            remote_name: Some("origin".to_string()),
            remote_url: Some("https://example.test/repo.git".to_string()),
            upstream_branch: Some("origin/main".to_string()),
            upstream_exists: true,
            ahead: Some(1),
            behind: Some(0),
            push_disabled_reason: Some("push is not implemented yet".to_string()),
            pull_request_disabled_reason: Some(
                "pull request creation is not implemented yet".to_string(),
            ),
        };

        let reasons = review_disabled_reasons(ReviewDisabledReasonInput {
            staged_files: 0,
            unstaged_files: 1,
            untracked_files: 0,
            conflicted_files: 1,
            operation: &operation,
            handoff: None,
            remote: &remote,
        });

        assert_eq!(
            reasons.commit.as_deref(),
            Some("resolve conflicted files before committing")
        );
        assert!(reasons.discard.is_none());
        assert!(reasons.delete_untracked.is_some());
        assert_eq!(reasons.push.as_deref(), Some("push is not implemented yet"));
        assert_eq!(
            reasons.pull_request.as_deref(),
            Some("pull request creation is not implemented yet")
        );
    }

    #[test]
    fn remote_status_reports_upstream_and_read_only_push_state() {
        let root = test_root("remote-status");
        let remote = test_root("remote-status-bare");
        run_git(&remote, &["init", "--bare"]).unwrap();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Slavey Test"]).unwrap();
        run_git(&root, &["config", "user.email", "slavey@example.test"]).unwrap();
        run_git(&root, &["checkout", "-B", "main"]).unwrap();
        std_fs::write(root.join("README.md"), "base\n").unwrap();
        run_git(&root, &["add", "README.md"]).unwrap();
        run_git(&root, &["commit", "-m", "Initial"]).unwrap();
        run_git(
            &root,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        )
        .unwrap();
        run_git(&root, &["push", "-u", "origin", "main"]).unwrap();
        std_fs::write(root.join("feature.txt"), "feature\n").unwrap();
        run_git(&root, &["add", "feature.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "Local feature"]).unwrap();

        let upstream = upstream_branch(&root).unwrap();
        let (behind, ahead) = ahead_behind(&root, upstream.as_deref().unwrap()).unwrap();
        let remote_info = worktree_remote_info(&root, upstream, ahead, behind);

        assert_eq!(remote_info.remote_name.as_deref(), Some("origin"));
        assert!(remote_info.upstream_exists);
        assert_eq!(remote_info.ahead, Some(1));
        assert_eq!(remote_info.behind, Some(0));
        assert_eq!(
            remote_info.push_disabled_reason.as_deref(),
            Some("push is not implemented yet")
        );
    }

    #[test]
    fn file_diff_marks_binary_content() {
        let root = test_root("binary-diff");
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Slavey Test"]).unwrap();
        run_git(&root, &["config", "user.email", "slavey@example.test"]).unwrap();
        std_fs::write(root.join("binary.bin"), b"abc\0def").unwrap();
        run_git(&root, &["add", "binary.bin"]).unwrap();
        run_git(&root, &["commit", "-m", "Add binary"]).unwrap();
        std_fs::write(root.join("binary.bin"), b"abc\0changed").unwrap();

        let diff = file_diff_or_marker(&root, &["diff", "--", "binary.bin"]);

        assert!(diff.contains("binary file diff omitted"));
    }
}
