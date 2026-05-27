use std::path::{Path, PathBuf};

const MAX_DIAGNOSTIC_STRING_CHARS: usize = 240;

pub(super) fn redact_path_string(path: &str) -> String {
    redact_diagnostic_string(&redact_home_path(path))
}

pub(crate) fn redact_home_path(path: &str) -> String {
    home_dir()
        .map(|home| redact_home_path_with_home(path, &home))
        .unwrap_or_else(|| path.to_string())
}

fn redact_home_path_with_home(path: &str, home: &Path) -> String {
    let path = Path::new(path);
    if let Ok(relative) = path.strip_prefix(home) {
        if relative.as_os_str().is_empty() {
            "~".to_string()
        } else {
            format!("~/{}", relative.display())
        }
    } else {
        path.display().to_string()
    }
}

pub(crate) fn redact_diagnostic_string(input: &str) -> String {
    truncate_diagnostic_string(&redact_secret_values(input), MAX_DIAGNOSTIC_STRING_CHARS)
}

fn redact_secret_values(input: &str) -> String {
    let mut output = Vec::new();
    let mut redact_next = 0usize;

    for word in input.split_whitespace() {
        if redact_next > 0 {
            output.push("[redacted]".to_string());
            redact_next -= 1;
            continue;
        }

        if is_auth_scheme(word) {
            output.push(word.to_string());
            redact_next = 1;
            continue;
        }

        if word.ends_with(':') && is_secret_key(word.trim_end_matches(':')) {
            output.push(format!("{word} [redacted]"));
            redact_next = if is_authorization_key(word.trim_end_matches(':')) {
                2
            } else {
                1
            };
            continue;
        }

        let (redacted, skip_next) = redact_key_value_fragment(word);
        if skip_next {
            redact_next = 1;
        }
        output.push(redacted);
    }

    output.join(" ")
}

fn redact_key_value_fragment(fragment: &str) -> (String, bool) {
    for separator in ['=', ':'] {
        if let Some(index) = fragment.find(separator) {
            let key = &fragment[..index];
            let value = &fragment[index + separator.len_utf8()..];
            if is_secret_key(key) && !value.is_empty() {
                return (format!("{key}{separator}[redacted]"), is_auth_scheme(value));
            }
        }
    }
    (fragment.to_string(), false)
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .to_ascii_lowercase();
    normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("passwd")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("access_key")
        || normalized.contains("credential")
        || normalized == "authorization"
}

fn is_authorization_key(key: &str) -> bool {
    key.trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .eq_ignore_ascii_case("authorization")
}

fn is_auth_scheme(value: &str) -> bool {
    let lower = value
        .trim_matches(|character: char| !character.is_ascii_alphanumeric())
        .to_ascii_lowercase();
    matches!(lower.as_str(), "bearer" | "basic")
}

pub(crate) fn truncate_diagnostic_string(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    if max_chars <= 3 {
        return ".".repeat(max_chars);
    }
    let keep = max_chars - 3;
    let mut truncated = input.chars().take(keep).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_home_path_prefix() {
        let redacted =
            redact_home_path_with_home("/Users/alice/work/slavey", Path::new("/Users/alice"));

        assert_eq!(redacted, "~/work/slavey");
        assert_eq!(
            redact_home_path_with_home("/Users/alice", Path::new("/Users/alice")),
            "~"
        );
        assert_eq!(
            redact_home_path_with_home("/Users/alice-other/work", Path::new("/Users/alice")),
            "/Users/alice-other/work"
        );
    }

    #[test]
    fn redacts_secret_like_values() {
        let redacted = redact_diagnostic_string(
            "token=abc123 Authorization: Bearer abc password: hunter2 api_key=xyz",
        );

        assert!(redacted.contains("token=[redacted]"));
        assert!(redacted.contains("Authorization: [redacted]"));
        assert!(redacted.contains("api_key=[redacted]"));
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("Bearer abc"));
    }

    #[test]
    fn truncates_long_diagnostic_strings_on_char_boundaries() {
        let truncated = truncate_diagnostic_string("abcdef", 5);
        assert_eq!(truncated, "ab...");

        let unicode = truncate_diagnostic_string("ééééé", 4);
        assert_eq!(unicode, "é...");
    }
}
