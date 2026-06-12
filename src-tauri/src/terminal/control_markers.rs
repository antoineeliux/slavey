use super::TerminalLaunchProfile;

const CODEX_SHELL_START_MARKER: &str = "\x1b]777;slavey-codex=start\x07";
const CODEX_SHELL_END_MARKER: &str = "\x1b]777;slavey-codex=end\x07";
const SHELL_CWD_MARKER_PREFIX: &str = "\x1b]777;slavey-cwd=";
const SHELL_CWD_MARKER_FAMILY_PREFIX: &str = "\x1b]777;slavey-";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ParsedTerminalOutput {
    pub(super) visible: String,
    pub(super) active_profile_changes: Vec<TerminalLaunchProfile>,
    pub(super) cwd_changes: Vec<String>,
}

pub(super) fn parse_terminal_control_markers(
    data: &str,
    pending: &mut String,
) -> ParsedTerminalOutput {
    let mut input = String::new();
    input.push_str(pending);
    input.push_str(data);
    pending.clear();

    let mut visible = String::new();
    let mut active_profile_changes = Vec::new();
    let mut cwd_changes = Vec::new();
    let mut cursor = 0;

    while let Some(marker) = next_terminal_control_marker(&input[cursor..]) {
        let start = cursor + marker.start;
        visible.push_str(&input[cursor..start]);
        match marker.kind {
            TerminalControlMarkerKind::ActiveProfile(active_profile) => {
                active_profile_changes.push(active_profile);
            }
            TerminalControlMarkerKind::Cwd(cwd) => {
                if !cwd.trim().is_empty() {
                    cwd_changes.push(cwd);
                }
            }
        }
        cursor = start + marker.len;
    }

    let remainder = &input[cursor..];
    let pending_len = terminal_control_marker_pending_len(remainder);
    if pending_len > 0 {
        let split_at = remainder.len() - pending_len;
        visible.push_str(&remainder[..split_at]);
        pending.push_str(&remainder[split_at..]);
    } else {
        visible.push_str(remainder);
    }

    ParsedTerminalOutput {
        visible,
        active_profile_changes,
        cwd_changes,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TerminalControlMarker {
    start: usize,
    len: usize,
    kind: TerminalControlMarkerKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TerminalControlMarkerKind {
    ActiveProfile(TerminalLaunchProfile),
    Cwd(String),
}

fn next_terminal_control_marker(input: &str) -> Option<TerminalControlMarker> {
    let marker_start = input.find(SHELL_CWD_MARKER_FAMILY_PREFIX)?;
    let marker_input = &input[marker_start..];
    if marker_input.starts_with(CODEX_SHELL_START_MARKER) {
        return Some(TerminalControlMarker {
            start: marker_start,
            len: CODEX_SHELL_START_MARKER.len(),
            kind: TerminalControlMarkerKind::ActiveProfile(TerminalLaunchProfile::Codex),
        });
    }
    if marker_input.starts_with(CODEX_SHELL_END_MARKER) {
        return Some(TerminalControlMarker {
            start: marker_start,
            len: CODEX_SHELL_END_MARKER.len(),
            kind: TerminalControlMarkerKind::ActiveProfile(TerminalLaunchProfile::Shell),
        });
    }
    if let Some(cwd_input) = marker_input.strip_prefix(SHELL_CWD_MARKER_PREFIX) {
        if let Some(end) = cwd_input.find('\x07') {
            return Some(TerminalControlMarker {
                start: marker_start,
                len: SHELL_CWD_MARKER_PREFIX.len() + end + 1,
                kind: TerminalControlMarkerKind::Cwd(cwd_input[..end].to_string()),
            });
        }
    }
    None
}

fn terminal_control_marker_pending_len(input: &str) -> usize {
    [
        CODEX_SHELL_START_MARKER,
        CODEX_SHELL_END_MARKER,
        SHELL_CWD_MARKER_PREFIX,
    ]
    .into_iter()
    .filter_map(|marker| trailing_marker_prefix_len(input, marker))
    .max()
    .unwrap_or_else(|| {
        input
            .rfind(SHELL_CWD_MARKER_PREFIX)
            .filter(|start| !input[*start..].contains('\x07'))
            .map(|start| input.len() - start)
            .unwrap_or(0)
    })
}

fn trailing_marker_prefix_len(input: &str, marker: &str) -> Option<usize> {
    let max_len = input.len().min(marker.len() - 1);
    (1..=max_len).rev().find(|len| {
        let start = input.len() - len;
        input.is_char_boundary(start) && marker.starts_with(&input[start..])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_control_markers_are_stripped_and_report_active_profile_changes() {
        let mut pending = String::new();
        let parsed = parse_terminal_control_markers(
            &format!("before{CODEX_SHELL_START_MARKER}during{CODEX_SHELL_END_MARKER}after"),
            &mut pending,
        );

        assert_eq!(parsed.visible, "beforeduringafter");
        assert_eq!(
            parsed.active_profile_changes,
            vec![TerminalLaunchProfile::Codex, TerminalLaunchProfile::Shell]
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_control_markers_can_span_output_chunks() {
        let mut pending = String::new();
        let first = parse_terminal_control_markers("\x1b]777;slavey", &mut pending);
        let second = parse_terminal_control_markers("-codex=start\x07ready", &mut pending);

        assert_eq!(first.visible, "");
        assert!(first.active_profile_changes.is_empty());
        assert_eq!(second.visible, "ready");
        assert_eq!(
            second.active_profile_changes,
            vec![TerminalLaunchProfile::Codex]
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_control_markers_report_cwd_changes() {
        let mut pending = String::new();
        let parsed = parse_terminal_control_markers(
            &format!("before{SHELL_CWD_MARKER_PREFIX}/workspace/project\x07after"),
            &mut pending,
        );

        assert_eq!(parsed.visible, "beforeafter");
        assert_eq!(parsed.cwd_changes, vec!["/workspace/project"]);
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_cwd_markers_can_span_output_chunks() {
        let mut pending = String::new();
        let first = parse_terminal_control_markers(
            &format!("{SHELL_CWD_MARKER_PREFIX}/workspace"),
            &mut pending,
        );
        let second = parse_terminal_control_markers("/project\x07ready", &mut pending);

        assert_eq!(first.visible, "");
        assert!(first.cwd_changes.is_empty());
        assert_eq!(second.visible, "ready");
        assert_eq!(second.cwd_changes, vec!["/workspace/project"]);
        assert!(pending.is_empty());
    }
}
