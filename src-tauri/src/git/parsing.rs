use super::WorktreeCommit;

pub(crate) fn parse_status_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(ToString::to_string)
        .collect()
}

pub(super) fn parse_untracked_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter_map(|line| line.strip_prefix("?? "))
        .map(ToString::to_string)
        .collect()
}

pub(super) fn is_untracked_file(status: &[String], path: &str) -> bool {
    let normalized_path = normalize_git_path_for_compare(path);
    parse_untracked_files(status)
        .iter()
        .any(|untracked| normalize_git_path_for_compare(untracked) == normalized_path)
}

pub(super) fn parse_changed_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter_map(|line| parse_status_path(line))
        .collect()
}

pub(super) fn parse_staged_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter(|line| has_staged_change_line(line))
        .filter_map(|line| parse_status_path(line))
        .collect()
}

pub(super) fn main_workspace_has_uncommitted_changes(status: &[String]) -> bool {
    !status.is_empty()
}

pub(super) fn employee_worktree_is_clean(status: &[String]) -> bool {
    status.is_empty()
}

pub(super) fn has_staged_changes(status: &[String]) -> bool {
    status.iter().any(|line| has_staged_change_line(line))
}

fn has_staged_change_line(line: &str) -> bool {
    let Some(staged) = line.as_bytes().first() else {
        return false;
    };
    *staged != b' ' && *staged != b'?'
}

pub(super) fn has_unstaged_change_for_path(status: &[String], path: &str) -> bool {
    let normalized_path = normalize_git_path(path);
    status.iter().any(|line| {
        !line.starts_with("?? ")
            && line
                .as_bytes()
                .get(1)
                .is_some_and(|unstaged| *unstaged != b' ')
            && parse_status_path(line)
                .map(|status_path| normalize_git_path(&status_path) == normalized_path)
                .unwrap_or(false)
    })
}

fn parse_status_path(line: &str) -> Option<String> {
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

pub(super) fn validate_commit_message(message: &str) -> Result<&str, String> {
    let message = message.trim();
    if message.is_empty() {
        Err("commit message is required".to_string())
    } else {
        Ok(message)
    }
}

pub(super) fn parse_commit_log(output: &str) -> Vec<WorktreeCommit> {
    output.lines().filter_map(parse_commit_log_line).collect()
}

fn parse_commit_log_line(line: &str) -> Option<WorktreeCommit> {
    let mut parts = line.splitn(4, '\u{1f}');
    let hash = parts.next()?.trim();
    let short_hash = parts.next()?.trim();
    let timestamp = parts
        .next()?
        .trim()
        .parse::<u64>()
        .ok()?
        .saturating_mul(1000);
    let message = parts.next()?.trim();
    if hash.is_empty() || short_hash.is_empty() || message.is_empty() {
        return None;
    }
    Some(WorktreeCommit {
        hash: hash.to_string(),
        short_hash: short_hash.to_string(),
        message: message.to_string(),
        timestamp,
    })
}

pub(super) fn commit_from_output(output: &str) -> Option<WorktreeCommit> {
    let (short_hash, message) = parse_commit_output(output)?;
    Some(WorktreeCommit {
        hash: short_hash.clone(),
        short_hash,
        message,
        timestamp: 0,
    })
}

fn parse_commit_output(output: &str) -> Option<(String, String)> {
    let first_line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let close = first_line.find(']')?;
    let header = first_line.strip_prefix('[')?.get(..close - 1)?.trim();
    let short_hash = header.split_whitespace().last()?.trim();
    let message = first_line.get(close + 1..)?.trim();
    if short_hash.is_empty()
        || !short_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || message.is_empty()
    {
        return None;
    }
    Some((short_hash.to_string(), message.to_string()))
}

pub(super) fn parse_ahead_behind(output: &str) -> (Option<u32>, Option<u32>) {
    let mut parts = output.split_whitespace();
    let behind = parts.next().and_then(|value| value.parse::<u32>().ok());
    let ahead = parts.next().and_then(|value| value.parse::<u32>().ok());
    (behind, ahead)
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn normalize_git_path_for_compare(path: &str) -> String {
    normalize_git_path(path).trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        employee_worktree_is_clean, has_staged_changes, has_unstaged_change_for_path,
        is_untracked_file, main_workspace_has_uncommitted_changes, parse_ahead_behind,
        parse_changed_files, parse_commit_log, parse_commit_output, parse_staged_files,
        parse_status_lines, parse_untracked_files, validate_commit_message,
    };

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

    #[test]
    fn untracked_matcher_handles_git_path_separators() {
        let changes = parse_status_lines("?? dir/file.rs\n");

        assert!(is_untracked_file(&changes, "dir/file.rs"));
        assert!(is_untracked_file(&changes, "dir\\file.rs"));
        assert!(!is_untracked_file(&changes, "other.rs"));
    }

    #[test]
    fn changed_file_parser_handles_renames_and_untracked_files() {
        let changes = parse_status_lines(" M src/main.rs\nR  old.rs -> new.rs\n?? scratch.txt\n");

        assert_eq!(
            parse_changed_files(&changes),
            vec![
                "src/main.rs".to_string(),
                "new.rs".to_string(),
                "scratch.txt".to_string()
            ]
        );
    }

    #[test]
    fn staged_change_detection_requires_index_changes() {
        let unstaged = parse_status_lines(" M src/main.rs\n?? scratch.txt\n");
        let staged = parse_status_lines("A  src/new.rs\nM  src/lib.rs\n");

        assert!(!has_staged_changes(&unstaged));
        assert!(has_staged_changes(&staged));
        assert_eq!(
            parse_staged_files(&staged),
            vec!["src/new.rs".to_string(), "src/lib.rs".to_string()]
        );
    }

    #[test]
    fn unstaged_change_detection_matches_selected_path() {
        let changes = parse_status_lines("MM src/main.rs\n M src/other.rs\nA  staged.rs\n");

        assert!(has_unstaged_change_for_path(&changes, "src/main.rs"));
        assert!(has_unstaged_change_for_path(&changes, "src/other.rs"));
        assert!(!has_unstaged_change_for_path(&changes, "staged.rs"));
    }

    #[test]
    fn commit_message_validation_rejects_empty_messages() {
        assert!(validate_commit_message("Add handoff").is_ok());
        assert!(validate_commit_message("   ").is_err());
    }

    #[test]
    fn commit_output_parser_extracts_hash_and_message() {
        let parsed =
            parse_commit_output("[slavey/test abc1234] Add review handoff\n 1 file changed")
                .unwrap();

        assert_eq!(parsed.0, "abc1234");
        assert_eq!(parsed.1, "Add review handoff");
    }

    #[test]
    fn commit_log_parser_extracts_recent_commits() {
        let commits =
            parse_commit_log("abcdef123456\u{1f}abcdef1\u{1f}1710000000\u{1f}Add handoff\n");

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "abcdef123456");
        assert_eq!(commits[0].short_hash, "abcdef1");
        assert_eq!(commits[0].message, "Add handoff");
        assert_eq!(commits[0].timestamp, 1_710_000_000_000);
    }

    #[test]
    fn commit_log_parser_extracts_commit_lists() {
        let commits = parse_commit_log(
            "abcdef123456\u{1f}abcdef1\u{1f}1710000000\u{1f}First\n\
             bcdefa234567\u{1f}bcdefa2\u{1f}1710000001\u{1f}Second\n\
             malformed\n",
        );

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].short_hash, "abcdef1");
        assert_eq!(commits[1].message, "Second");
    }

    #[test]
    fn ahead_behind_parser_reads_left_right_counts() {
        assert_eq!(parse_ahead_behind("2\t5\n"), (Some(2), Some(5)));
    }

    #[test]
    fn dirty_detection_helpers_read_status_lines() {
        let clean = parse_status_lines("");
        let dirty = parse_status_lines(" M src/main.rs\n?? scratch.txt\n");

        assert!(!main_workspace_has_uncommitted_changes(&clean));
        assert!(main_workspace_has_uncommitted_changes(&dirty));
        assert!(employee_worktree_is_clean(&clean));
        assert!(!employee_worktree_is_clean(&dirty));
    }
}
