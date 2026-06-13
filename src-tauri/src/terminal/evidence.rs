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
    let has_direct_request = contains_word(&clean, "approve")
        || contains_word(&clean, "allow")
        || contains_word(&clean, "permission");
    let has_approval_request = contains_word(&clean, "approval")
        && (contains_word(&clean, "required") || contains_word(&clean, "request"));
    let has_action_word = contains_word(&clean, "run")
        || contains_word(&clean, "command")
        || contains_word(&clean, "edit")
        || contains_word(&clean, "write")
        || contains_word(&clean, "proceed")
        || contains_word(&clean, "continue");
    let has_choice = approval_choice_in_clean_output(&clean);
    (has_direct_request && has_action_word && has_choice)
        || (has_approval_request && (has_action_word || has_choice))
}

pub fn codex_output_suggests_approval_choice(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    approval_choice_in_clean_output(&clean)
}

fn approval_choice_in_clean_output(clean: &str) -> bool {
    contains_word(clean, "yes")
        || contains_word(clean, "no")
        || clean.contains("[y")
        || clean.contains("(y")
}

fn contains_word(haystack: &str, word: &str) -> bool {
    haystack.match_indices(word).any(|(index, _)| {
        let starts_word = haystack[..index]
            .chars()
            .next_back()
            .is_none_or(|character| !character.is_alphanumeric());
        let ends_word = haystack[index + word.len()..]
            .chars()
            .next()
            .is_none_or(|character| !character.is_alphanumeric());
        starts_word && ends_word
    })
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

const BRACKETED_PASTE_START: &str = "\x1b[200~";
const BRACKETED_PASTE_END: &str = "\x1b[201~";

pub fn terminal_input_submits_prompt(input: &str) -> bool {
    // Newlines inside a bracketed paste are inserted into the composer draft;
    // only a newline outside paste markers submits the prompt.
    let mut remaining = input;
    let mut inside_paste = false;
    loop {
        let marker = if inside_paste {
            BRACKETED_PASTE_END
        } else {
            BRACKETED_PASTE_START
        };
        match remaining.find(marker) {
            Some(index) => {
                if !inside_paste && remaining[..index].contains(['\r', '\n']) {
                    return true;
                }
                inside_paste = !inside_paste;
                remaining = &remaining[index + marker.len()..];
            }
            None => return !inside_paste && remaining.contains(['\r', '\n']),
        }
    }
}

pub fn terminal_input_is_bare_newline(input: &str) -> bool {
    !input.is_empty()
        && input
            .chars()
            .all(|character| character == '\r' || character == '\n')
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

    #[test]
    fn input_submission_respects_bracketed_paste_and_bare_newlines() {
        assert!(terminal_input_submits_prompt("hello\r"));
        assert!(terminal_input_submits_prompt("\r"));
        assert!(!terminal_input_submits_prompt(
            "\x1b[200~line one\nline two\x1b[201~"
        ));
        assert!(terminal_input_submits_prompt(
            "\x1b[200~line one\nline two\x1b[201~\r"
        ));
        assert!(terminal_input_updates_owner_prompt(
            "\x1b[200~line one\nline two\x1b[201~"
        ));
        assert!(terminal_input_is_bare_newline("\r"));
        assert!(terminal_input_is_bare_newline("\r\n"));
        assert!(!terminal_input_is_bare_newline("y\r"));
        assert!(!terminal_input_is_bare_newline(""));
    }

    #[test]
    fn approval_word_matching_uses_word_boundaries() {
        assert!(!codex_output_suggests_approval_prompt(
            "Allowed paths are now running fine\n› "
        ));
        assert!(!codex_output_suggests_approval_prompt(
            "I added permission checks so you can run them now.\n› "
        ));
        assert!(codex_output_suggests_approval_prompt(
            "Approval required to run this command\n[y/N]"
        ));
        assert!(!codex_output_suggests_approval_choice("Working now\n› "));
        assert!(codex_output_suggests_approval_choice("› Yes / No"));
    }
}
