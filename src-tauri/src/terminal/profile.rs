use anyhow::Result;
use portable_pty::CommandBuilder;

use super::TerminalLaunchProfile;
use crate::persistence::AppSettings;

#[cfg(unix)]
use std::{env, fs, os::unix::fs::PermissionsExt, path::Path, path::PathBuf};

#[cfg(unix)]
use anyhow::Context;

pub(super) const DEFAULT_CODEX_PROGRAM: &str = "codex";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TerminalCommandSpec {
    pub(super) program: String,
    pub(super) args: Vec<String>,
    pub(super) command_label: &'static str,
}

pub(crate) fn codex_program_from_settings(settings: &AppSettings) -> String {
    let trimmed = settings.codex_binary_path.trim();
    if trimmed.is_empty() {
        DEFAULT_CODEX_PROGRAM.to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn terminal_command_spec(
    profile: TerminalLaunchProfile,
    codex_program: &str,
) -> TerminalCommandSpec {
    match profile {
        TerminalLaunchProfile::Shell => TerminalCommandSpec {
            program: default_shell(),
            args: Vec::new(),
            command_label: "shell",
        },
        TerminalLaunchProfile::Codex => TerminalCommandSpec {
            program: codex_program.to_string(),
            args: vec![
                "--no-alt-screen".to_string(),
                "--dangerously-bypass-approvals-and-sandbox".to_string(),
            ],
            command_label: "codex",
        },
    }
}

pub(super) fn command_builder_from_spec(spec: &TerminalCommandSpec) -> CommandBuilder {
    let mut command = CommandBuilder::new(&spec.program);
    for arg in &spec.args {
        command.arg(arg.as_str());
    }
    command
}

pub(super) fn configure_terminal_environment(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

pub(super) fn configure_command_for_profile(
    command: &mut CommandBuilder,
    profile: TerminalLaunchProfile,
    codex_program: &str,
) -> Result<()> {
    if profile == TerminalLaunchProfile::Shell {
        configure_shell_codex_detection(command, codex_program)?;
        configure_shell_cwd_detection(command)?;
    }
    Ok(())
}

#[cfg(unix)]
fn configure_shell_codex_detection(
    command: &mut CommandBuilder,
    codex_program: &str,
) -> Result<()> {
    let wrapper_dir = env::temp_dir().join(format!("slavey-codex-wrapper-{}", std::process::id()));
    fs::create_dir_all(&wrapper_dir)
        .with_context(|| format!("failed to create {}", wrapper_dir.display()))?;
    let wrapper_path = wrapper_dir.join("codex");
    fs::write(&wrapper_path, codex_wrapper_script())
        .with_context(|| format!("failed to write {}", wrapper_path.display()))?;
    fs::set_permissions(&wrapper_path, fs::Permissions::from_mode(0o755))
        .with_context(|| format!("failed to make {} executable", wrapper_path.display()))?;

    let existing_path = command.get_env("PATH").map(|path| path.to_os_string());
    let mut next_path = wrapper_dir.as_os_str().to_os_string();
    if let Some(existing_path) = existing_path {
        if !existing_path.as_os_str().is_empty() {
            next_path.push(":");
            next_path.push(existing_path);
        }
    }

    command.env("PATH", next_path);
    command.env("SLAVEY_CODEX_WRAPPER_DIR", wrapper_dir.as_os_str());
    if codex_program != DEFAULT_CODEX_PROGRAM {
        command.env("SLAVEY_CODEX_PATH", codex_program);
    }
    Ok(())
}

#[cfg(not(unix))]
fn configure_shell_codex_detection(
    _command: &mut CommandBuilder,
    _codex_program: &str,
) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn configure_shell_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let shell = default_shell();
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    match shell_name {
        "bash" => configure_bash_cwd_detection(command),
        "zsh" => configure_zsh_cwd_detection(command),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
fn configure_shell_cwd_detection(_command: &mut CommandBuilder) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn configure_bash_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let integration_dir =
        env::temp_dir().join(format!("slavey-shell-integration-{}", std::process::id()));
    fs::create_dir_all(&integration_dir)
        .with_context(|| format!("failed to create {}", integration_dir.display()))?;
    let rc_path = integration_dir.join("bashrc");
    fs::write(&rc_path, bash_cwd_integration_script())
        .with_context(|| format!("failed to write {}", rc_path.display()))?;
    command.arg("--rcfile");
    command.arg(rc_path.as_os_str());
    command.arg("-i");
    Ok(())
}

#[cfg(unix)]
fn configure_zsh_cwd_detection(command: &mut CommandBuilder) -> Result<()> {
    let integration_dir =
        env::temp_dir().join(format!("slavey-zsh-integration-{}", std::process::id()));
    fs::create_dir_all(&integration_dir)
        .with_context(|| format!("failed to create {}", integration_dir.display()))?;
    let rc_path = integration_dir.join(".zshrc");
    fs::write(&rc_path, zsh_cwd_integration_script())
        .with_context(|| format!("failed to write {}", rc_path.display()))?;
    command.env("ZDOTDIR", integration_dir.as_os_str());
    command.arg("-i");
    Ok(())
}

#[cfg(unix)]
fn bash_cwd_integration_script() -> String {
    let source_line = home_dir()
        .map(|home| home.join(".bashrc"))
        .map(source_shell_file_line)
        .unwrap_or_default();
    format!(
        r#"{source_line}
_slavey_report_cwd() {{ printf '\033]777;slavey-cwd=%s\007' "$PWD"; }}
if [ -n "${{PROMPT_COMMAND:-}}" ]; then
  PROMPT_COMMAND="_slavey_report_cwd; $PROMPT_COMMAND"
else
  PROMPT_COMMAND="_slavey_report_cwd"
fi
_slavey_report_cwd
"#
    )
}

#[cfg(unix)]
fn zsh_cwd_integration_script() -> String {
    let source_line = home_dir()
        .map(|home| home.join(".zshrc"))
        .map(source_shell_file_line)
        .unwrap_or_default();
    format!(
        r#"{source_line}
_slavey_report_cwd() {{ printf '\033]777;slavey-cwd=%s\007' "$PWD"; }}
precmd_functions=(${{precmd_functions[@]}} _slavey_report_cwd)
_slavey_report_cwd
"#
    )
}

#[cfg(unix)]
fn source_shell_file_line(path: PathBuf) -> String {
    let path = shell_single_quote(&path.to_string_lossy());
    format!("if [ -r {path} ]; then . {path}; fi")
}

#[cfg(unix)]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\''"#))
}

#[cfg(unix)]
fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

#[cfg(unix)]
fn codex_wrapper_script() -> &'static str {
    r#"#!/bin/sh
wrapper_dir=${SLAVEY_CODEX_WRAPPER_DIR:-}
configured_codex=${SLAVEY_CODEX_PATH:-}
notify_config=${SLAVEY_CODEX_NOTIFY_CONFIG:-}
printf '\033]777;slavey-codex=start\007'

real_codex=
if [ -n "$configured_codex" ]; then
  if [ -x "$configured_codex" ]; then
    real_codex=$configured_codex
  else
    printf 'Slavey codex wrapper: configured codex executable not found: %s\n' "$configured_codex" >&2
    printf '\033]777;slavey-codex=end\007'
    exit 127
  fi
fi

if [ -z "$real_codex" ]; then
  old_ifs=$IFS
  IFS=:
  for path_dir in $PATH; do
    if [ -z "$path_dir" ]; then
      path_dir=.
    fi
    if [ -n "$wrapper_dir" ] && [ "$path_dir" = "$wrapper_dir" ]; then
      continue
    fi
    candidate=$path_dir/codex
    if [ -x "$candidate" ]; then
      real_codex=$candidate
      break
    fi
  done
  IFS=$old_ifs
fi

if [ -z "$real_codex" ]; then
  printf 'Slavey codex wrapper: real codex executable not found\n' >&2
  printf '\033]777;slavey-codex=end\007'
  exit 127
fi

has_no_alt_screen=false
for arg in "$@"; do
  if [ "$arg" = "--no-alt-screen" ]; then
    has_no_alt_screen=true
    break
  fi
done
if [ "$has_no_alt_screen" = false ]; then
  set -- --no-alt-screen "$@"
fi
if [ -n "$notify_config" ]; then
  set -- --config "$notify_config" "$@"
fi

"$real_codex" "$@"
status=$?
printf '\033]777;slavey-codex=end\007'
exit "$status"
"#
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_profile_uses_default_shell_without_extra_args() {
        let spec = terminal_command_spec(TerminalLaunchProfile::Shell, "codex");

        assert!(!spec.program.is_empty());
        assert!(spec.args.is_empty());
        assert_eq!(spec.command_label, "shell");
    }

    #[test]
    fn codex_profile_uses_no_alt_screen_with_approval_and_sandbox_bypass() {
        let spec = terminal_command_spec(TerminalLaunchProfile::Codex, "codex");

        assert_eq!(spec.program, "codex");
        assert_eq!(
            spec.args,
            vec![
                "--no-alt-screen",
                "--dangerously-bypass-approvals-and-sandbox",
            ],
        );
        assert_eq!(spec.command_label, "codex");
    }

    #[test]
    fn codex_profile_uses_configured_codex_program() {
        let spec = terminal_command_spec(
            TerminalLaunchProfile::Codex,
            "/Users/ada/.nvm/versions/node/v22/bin/codex",
        );

        assert_eq!(spec.program, "/Users/ada/.nvm/versions/node/v22/bin/codex");
        assert_eq!(spec.command_label, "codex");
    }

    #[cfg(unix)]
    #[test]
    fn shell_codex_wrapper_injects_notify_config_override() {
        let script = codex_wrapper_script();

        assert!(script.contains("SLAVEY_CODEX_NOTIFY_CONFIG"));
        assert!(script.contains("set -- --config \"$notify_config\" \"$@\""));
    }
}
