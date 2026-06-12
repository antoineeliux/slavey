pub fn codex_output_ends_at_prompt(output: &str) -> bool {
    strip_ansi(output)
        .replace('\r', "\n")
        .lines()
        .map(str::trim_start)
        .rfind(|line| !line.trim().is_empty())
        .map(|line| line.starts_with('›'))
        .unwrap_or(false)
}

pub fn codex_output_suggests_approval_prompt(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    let has_direct_request =
        clean.contains("approve") || clean.contains("allow ") || clean.contains("permission");
    let has_approval_request =
        clean.contains("approval") && (clean.contains("required") || clean.contains("request"));
    let has_action_word = clean.contains("run")
        || clean.contains("command")
        || clean.contains("edit")
        || clean.contains("write")
        || clean.contains("proceed")
        || clean.contains("continue");
    let has_choice = clean.contains("yes")
        || clean.contains("no")
        || clean.contains("[y")
        || clean.contains("(y")
        || clean.contains('›');
    (has_direct_request && has_action_word && has_choice)
        || (has_approval_request && (has_action_word || has_choice))
}

pub fn codex_output_suggests_approval_choice(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    clean.contains("yes")
        || clean.contains("no")
        || clean.contains("[y")
        || clean.contains("(y")
        || clean.contains('›')
}

pub fn codex_output_has_visible_text(output: &str) -> bool {
    strip_ansi(output)
        .chars()
        .any(|character| !character.is_whitespace())
}

pub fn codex_output_suggests_active_work(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    clean
        .lines()
        .map(str::trim_start)
        .any(codex_line_suggests_active_work)
}

pub fn codex_output_has_completion_text_before_prompt(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    let mut seen_working = false;
    let mut saw_completion_text = false;

    for line in clean.lines().map(str::trim) {
        if line.is_empty() {
            continue;
        }
        if line.starts_with('›') {
            if seen_working && saw_completion_text {
                return true;
            }
            continue;
        }
        if codex_line_suggests_active_work(line) {
            seen_working = true;
            saw_completion_text = false;
            continue;
        }
        if seen_working {
            saw_completion_text = true;
        }
    }

    false
}

pub fn terminal_input_submits_prompt(input: &str) -> bool {
    input.contains('\r') || input.contains('\n')
}

pub fn terminal_input_updates_owner_prompt(input: &str) -> bool {
    !input.is_empty() && !terminal_input_submits_prompt(input)
}

fn codex_line_suggests_active_work(line: &str) -> bool {
    (line.starts_with('•') || line.starts_with('-') || line.starts_with('*'))
        && line.contains("working")
        && (line.contains("esc to interrupt") || line.contains('('))
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\x1b' {
            output.push(character);
            continue;
        }

        match chars.peek().copied() {
            Some('[') => {
                chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            Some(']') => {
                chars.next();
                while let Some(next) = chars.next() {
                    if next == '\x07' {
                        break;
                    }
                    if next == '\x1b' && chars.peek().copied() == Some('\\') {
                        chars.next();
                        break;
                    }
                }
            }
            Some('(') | Some(')') => {
                chars.next();
                let _ = chars.next();
            }
            _ => {}
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_detection_ignores_ansi_control_sequences() {
        assert!(codex_output_ends_at_prompt(
            "\x1b[2K\r• Working (10s • esc to interrupt)\r\nDone.\r\n› "
        ));
        assert!(!codex_output_ends_at_prompt(
            "\r\n› Implement feature\r\n\r\n• Working (10s • esc to interrupt)"
        ));
        assert!(!codex_output_has_visible_text("\x1b[?25l\x1b[2K\r"));
        assert!(codex_output_suggests_active_work(
            "\r\n• Working (10s • esc to interrupt)"
        ));
        assert!(!codex_output_suggests_active_work(
            "Tip: New use /fast to enable fastest inference"
        ));
        assert!(codex_output_has_completion_text_before_prompt(
            "\r\n• Working (10s • esc to interrupt)\r\nDone.\r\n› "
        ));
        assert!(codex_output_has_completion_text_before_prompt(
            "\r\n• Working (10s • esc to interrupt)\r\n› \r\nDone.\r\n› "
        ));
        assert!(!codex_output_has_completion_text_before_prompt(
            "\r\n• Working (10s • esc to interrupt)\r\n› "
        ));
    }

    #[test]
    fn approval_prompt_detection_requires_approval_context() {
        assert!(codex_output_suggests_approval_prompt(
            "Allow command to run?\n› Yes / No"
        ));
        assert!(!codex_output_suggests_approval_prompt("Allow command to "));
        assert!(!codex_output_suggests_approval_prompt(
            "Finished checking approval tests\n› "
        ));
    }
}
