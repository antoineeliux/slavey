use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use portable_pty::CommandBuilder;
use tauri::AppHandle;

use super::TerminalLaunchProfile;

#[cfg(unix)]
use std::{env, fs, os::unix::fs::PermissionsExt, path::Path, thread, time::Duration};

#[cfg(unix)]
use anyhow::Context;

#[cfg(unix)]
use crate::events::{emit_log, LogLevel};

#[cfg(unix)]
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

pub(super) type SessionActiveCallback = Arc<dyn Fn(&str) -> bool + Send + Sync>;
pub(super) type RefreshCallback = Arc<dyn Fn(&str) -> Result<()> + Send + Sync>;
pub(super) type TurnCompleteCallback = Arc<dyn Fn(&str, u64) + Send + Sync>;

pub(super) struct Bridge {
    pub(super) event_dir: PathBuf,
}

#[cfg(unix)]
pub(super) fn configure_bridge(
    command: &mut CommandBuilder,
    profile: TerminalLaunchProfile,
    session_id: &str,
) -> Result<Option<Bridge>> {
    let base_dir = env::temp_dir().join(format!("slavey-codex-notify-{}", std::process::id()));
    let event_dir = base_dir.join(session_id);
    fs::create_dir_all(&event_dir)
        .with_context(|| format!("failed to create {}", event_dir.display()))?;

    let helper_path = base_dir.join("codex-notify.sh");
    fs::write(&helper_path, helper_script())
        .with_context(|| format!("failed to write {}", helper_path.display()))?;
    fs::set_permissions(&helper_path, fs::Permissions::from_mode(0o755))
        .with_context(|| format!("failed to make {} executable", helper_path.display()))?;

    let config_arg = config_arg(&helper_path, &event_dir);
    match profile {
        TerminalLaunchProfile::Codex => {
            command.arg("--config");
            command.arg(config_arg);
        }
        TerminalLaunchProfile::Shell => {
            command.env("SLAVEY_CODEX_NOTIFY_CONFIG", config_arg);
        }
    }

    Ok(Some(Bridge { event_dir }))
}

#[cfg(not(unix))]
pub(super) fn configure_bridge(
    _command: &mut CommandBuilder,
    _profile: TerminalLaunchProfile,
    _session_id: &str,
) -> Result<Option<Bridge>> {
    Ok(None)
}

#[cfg(unix)]
pub(super) fn spawn_watcher(
    app: AppHandle,
    session_id: String,
    event_dir: PathBuf,
    is_session_active: SessionActiveCallback,
    refresh_session: RefreshCallback,
    on_turn_complete: TurnCompleteCallback,
) {
    thread::spawn(move || loop {
        if !is_session_active(&session_id) {
            let _ = fs::remove_dir_all(&event_dir);
            break;
        }

        if let Err(error) =
            drain_events(&event_dir, &session_id, &refresh_session, &on_turn_complete)
        {
            emit_log(
                &app,
                LogLevel::Warn,
                format!("failed to read Codex notify events for {session_id}: {error}"),
            );
        }

        thread::sleep(WATCH_INTERVAL);
    });
}

#[cfg(not(unix))]
pub(super) fn spawn_watcher(
    _app: AppHandle,
    _session_id: String,
    _event_dir: PathBuf,
    _is_session_active: SessionActiveCallback,
    _refresh_session: RefreshCallback,
    _on_turn_complete: TurnCompleteCallback,
) {
}

#[cfg(unix)]
fn config_arg(helper_path: &Path, event_dir: &Path) -> String {
    let notify = serde_json::json!([
        helper_path.to_string_lossy().to_string(),
        event_dir.to_string_lossy().to_string()
    ]);
    format!("notify={notify}")
}

#[cfg(unix)]
fn helper_script() -> &'static str {
    r#"#!/bin/sh
event_dir=${1:-}
payload=${2:-}
if [ -z "$event_dir" ]; then
  exit 0
fi
mkdir -p "$event_dir" 2>/dev/null || exit 0
tmp=$(mktemp "$event_dir/event.XXXXXX.tmp") || exit 0
if ! printf '%s\n' "$payload" > "$tmp"; then
  rm -f "$tmp"
  exit 0
fi
mv "$tmp" "$tmp.json" 2>/dev/null || rm -f "$tmp"
exit 0
"#
}

#[cfg(unix)]
fn drain_events(
    event_dir: &Path,
    session_id: &str,
    refresh_session: &RefreshCallback,
    on_turn_complete: &TurnCompleteCallback,
) -> Result<()> {
    if !event_dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(event_dir)
        .with_context(|| format!("failed to scan {}", event_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }

        let event_at = event_modified_at(&path);
        let payload = fs::read_to_string(&path).unwrap_or_default();
        let _ = fs::remove_file(&path);
        if payload_is_agent_turn_complete(&payload) {
            refresh_session(session_id)?;
            on_turn_complete(session_id, event_at);
        }
    }

    Ok(())
}

#[cfg(unix)]
fn event_modified_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_else(crate::events::now_ms)
}

#[cfg(unix)]
fn payload_is_agent_turn_complete(payload: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("type")
                .and_then(serde_json::Value::as_str)
                .map(|event_type| event_type == "agent-turn-complete")
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn config_arg_uses_json_array_override() {
        let config = super::config_arg(
            std::path::Path::new("/tmp/slavey helper/codex-notify.sh"),
            std::path::Path::new("/tmp/slavey events/term-1"),
        );
        let value = config.strip_prefix("notify=").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(value).unwrap();

        assert_eq!(
            parsed,
            serde_json::json!([
                "/tmp/slavey helper/codex-notify.sh",
                "/tmp/slavey events/term-1"
            ])
        );
    }

    #[cfg(unix)]
    #[test]
    fn payload_filters_agent_turn_complete() {
        assert!(super::payload_is_agent_turn_complete(
            r#"{"type":"agent-turn-complete","thread-id":"abc"}"#
        ));
        assert!(!super::payload_is_agent_turn_complete(
            r#"{"type":"approval-requested"}"#
        ));
        assert!(!super::payload_is_agent_turn_complete("not json"));
    }

    #[cfg(unix)]
    #[test]
    fn drain_events_invokes_refresh_callback_and_removes_file() {
        let event_dir =
            std::env::temp_dir().join(format!("slavey-codex-notify-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&event_dir).unwrap();
        let event_path = event_dir.join("event.json");
        std::fs::write(&event_path, r#"{"type":"agent-turn-complete"}"#).unwrap();

        let refreshes = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let refresh_calls = std::sync::Arc::clone(&refreshes);
        let refresh: super::RefreshCallback = std::sync::Arc::new(move |session_id| {
            refresh_calls.lock().unwrap().push(session_id.to_string());
            Ok(())
        });

        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let callback_calls = std::sync::Arc::clone(&calls);
        let callback: super::TurnCompleteCallback =
            std::sync::Arc::new(move |session_id, event_at| {
                callback_calls
                    .lock()
                    .unwrap()
                    .push((session_id.to_string(), event_at));
            });

        super::drain_events(&event_dir, "term-1", &refresh, &callback).unwrap();

        let refreshes = refreshes.lock().unwrap();
        assert_eq!(refreshes.as_slice(), ["term-1"]);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "term-1");
        assert!(calls[0].1 > 0);
        assert!(!event_path.exists());
        let _ = std::fs::remove_dir_all(&event_dir);
    }
}
