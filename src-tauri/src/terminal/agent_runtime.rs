use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::Serialize;

use super::{
    session_store::{TerminalSessionRecord, TerminalSessionStatus},
    TerminalLaunchProfile,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    None,
    Codex,
    Claude,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeState {
    NotActive,
    Starting,
    Thinking,
    WaitingPrompt,
    WaitingApproval,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSnapshot {
    pub kind: AgentKind,
    pub state: AgentRuntimeState,
    pub last_state_changed_at: Option<u64>,
}

impl AgentRuntimeSnapshot {
    pub fn none() -> Self {
        Self {
            kind: AgentKind::None,
            state: AgentRuntimeState::NotActive,
            last_state_changed_at: None,
        }
    }

    pub fn with_state(
        kind: AgentKind,
        state: AgentRuntimeState,
        last_state_changed_at: Option<u64>,
    ) -> Self {
        Self {
            kind,
            state,
            last_state_changed_at,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventKind {
    Started,
    PromptSubmitted,
    Thinking,
    ApprovalRequested,
    PromptReady,
    Completed,
    Failed,
    Cleared,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub session_id: String,
    pub kind: AgentKind,
    pub state: AgentRuntimeState,
    pub event_kind: AgentEventKind,
    pub occurred_at: u64,
}

#[derive(Clone, Default)]
pub struct AgentRuntimeStore {
    snapshots: Arc<Mutex<HashMap<String, AgentRuntimeSnapshot>>>,
    events: Arc<Mutex<Vec<AgentEvent>>>,
}

impl AgentRuntimeStore {
    pub fn snapshot(&self, session_id: &str) -> Option<AgentRuntimeSnapshot> {
        self.snapshots.lock().get(session_id).copied()
    }

    pub fn record_event(&self, event: AgentEvent) -> Option<AgentRuntimeSnapshot> {
        self.events.lock().push(event.clone());
        if event.kind == AgentKind::None || event.state == AgentRuntimeState::NotActive {
            self.snapshots.lock().remove(&event.session_id);
            return None;
        }

        let snapshot =
            AgentRuntimeSnapshot::with_state(event.kind, event.state, Some(event.occurred_at));
        self.snapshots
            .lock()
            .insert(event.session_id.clone(), snapshot);
        Some(snapshot)
    }

    pub fn sync_from_terminal_session(
        &self,
        session: &TerminalSessionRecord,
    ) -> Option<AgentRuntimeSnapshot> {
        let snapshot = agent_runtime_for_session(Some(session));
        if snapshot.kind == AgentKind::None {
            self.clear_session(&session.session_id);
            return None;
        }
        let event = agent_event_from_snapshot(session.session_id.clone(), snapshot)?;
        self.record_event(event)
    }

    pub fn record_prompt_submitted_from_session(
        &self,
        session: &TerminalSessionRecord,
    ) -> Option<AgentRuntimeSnapshot> {
        let kind = agent_kind_for_profile(session.active_profile.unwrap_or(session.profile));
        if kind == AgentKind::None {
            self.clear_session(&session.session_id);
            return None;
        }
        self.record_event(AgentEvent {
            session_id: session.session_id.clone(),
            kind,
            state: AgentRuntimeState::Thinking,
            event_kind: AgentEventKind::PromptSubmitted,
            occurred_at: session
                .last_prompt_submitted_at
                .unwrap_or_else(crate::events::now_ms),
        })
    }

    pub fn sync_all_from_terminal_sessions(&self, sessions: &[TerminalSessionRecord]) {
        for session in sessions {
            self.sync_from_terminal_session(session);
        }
    }

    pub fn clear_session(&self, session_id: &str) {
        self.snapshots.lock().remove(session_id);
        self.events.lock().push(AgentEvent {
            session_id: session_id.to_string(),
            kind: AgentKind::None,
            state: AgentRuntimeState::NotActive,
            event_kind: AgentEventKind::Cleared,
            occurred_at: crate::events::now_ms(),
        });
    }

    pub fn clear_all(&self) {
        self.snapshots.lock().clear();
        self.events.lock().clear();
    }
}

fn agent_event_from_snapshot(
    session_id: String,
    snapshot: AgentRuntimeSnapshot,
) -> Option<AgentEvent> {
    let kind = snapshot.kind;
    if kind == AgentKind::None {
        return None;
    }
    let event_kind = match snapshot.state {
        AgentRuntimeState::NotActive => AgentEventKind::Cleared,
        AgentRuntimeState::Starting => AgentEventKind::Started,
        AgentRuntimeState::Thinking => AgentEventKind::Thinking,
        AgentRuntimeState::WaitingPrompt => AgentEventKind::PromptReady,
        AgentRuntimeState::WaitingApproval => AgentEventKind::ApprovalRequested,
        AgentRuntimeState::Completed => AgentEventKind::Completed,
        AgentRuntimeState::Failed => AgentEventKind::Failed,
    };
    Some(AgentEvent {
        session_id,
        kind,
        state: snapshot.state,
        event_kind,
        occurred_at: snapshot
            .last_state_changed_at
            .unwrap_or_else(crate::events::now_ms),
    })
}

pub fn agent_runtime_for_session(session: Option<&TerminalSessionRecord>) -> AgentRuntimeSnapshot {
    let Some(session) = session else {
        return AgentRuntimeSnapshot::none();
    };

    match agent_kind_for_profile(session.active_profile.unwrap_or(session.profile)) {
        AgentKind::Codex => codex_runtime_for_session(session),
        AgentKind::Claude => AgentRuntimeSnapshot::with_state(
            AgentKind::Claude,
            AgentRuntimeState::Thinking,
            session.last_output_at.or(Some(session.started_at)),
        ),
        AgentKind::None => AgentRuntimeSnapshot::none(),
    }
}

pub fn agent_kind_for_profile(profile: TerminalLaunchProfile) -> AgentKind {
    match profile {
        TerminalLaunchProfile::Shell => AgentKind::None,
        TerminalLaunchProfile::Codex => AgentKind::Codex,
    }
}

pub fn agent_kind_for_command(command: Option<&str>) -> AgentKind {
    match command {
        Some("codex") => AgentKind::Codex,
        Some("claude") => AgentKind::Claude,
        _ => AgentKind::None,
    }
}

pub fn codex_session_is_active(record: &TerminalSessionRecord) -> bool {
    record.active_profile.unwrap_or(record.profile) == TerminalLaunchProfile::Codex
}

pub fn codex_session_is_waiting_for_instruction(record: &TerminalSessionRecord) -> bool {
    if !codex_session_is_active(record) || record.status != TerminalSessionStatus::Running {
        return false;
    }

    let last_prompt_submitted_at = record.last_prompt_submitted_at.unwrap_or(0);
    let last_prompt_ready_at = record.last_prompt_ready_at.unwrap_or(0);
    last_prompt_ready_at >= last_prompt_submitted_at && last_prompt_ready_at > 0
}

pub fn codex_session_is_waiting_for_approval(record: &TerminalSessionRecord) -> bool {
    if !codex_session_is_active(record) || record.status != TerminalSessionStatus::Running {
        return false;
    }

    let last_prompt_submitted_at = record.last_prompt_submitted_at.unwrap_or(0);
    let last_approval_prompt_at = record.last_approval_prompt_at.unwrap_or(0);
    last_approval_prompt_at >= last_prompt_submitted_at && last_approval_prompt_at > 0
}

pub fn codex_output_suggests_prompt_ready(output: &str) -> bool {
    strip_ansi(output)
        .replace('\r', "\n")
        .lines()
        .any(|line| line.trim_start().starts_with('›'))
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
        || clean.contains("›");
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

pub fn terminal_input_submits_prompt(input: &str) -> bool {
    input.contains('\r') || input.contains('\n')
}

pub fn codex_session_should_track_prompt(record: &TerminalSessionRecord) -> bool {
    codex_session_is_active(record)
        || record.last_prompt_ready_at.is_some()
        || record.last_approval_prompt_at.is_some()
        || record.profile == TerminalLaunchProfile::Codex
}

fn codex_runtime_for_session(session: &TerminalSessionRecord) -> AgentRuntimeSnapshot {
    if session.status == TerminalSessionStatus::Failed {
        return AgentRuntimeSnapshot::with_state(
            AgentKind::Codex,
            AgentRuntimeState::Failed,
            session.ended_at.or(session.stopped_at),
        );
    }

    if session.status == TerminalSessionStatus::Exited
        || session.status == TerminalSessionStatus::Stopped
    {
        return AgentRuntimeSnapshot::with_state(
            AgentKind::Codex,
            AgentRuntimeState::Completed,
            session.ended_at.or(session.stopped_at),
        );
    }

    if codex_session_is_waiting_for_approval(session) {
        return AgentRuntimeSnapshot::with_state(
            AgentKind::Codex,
            AgentRuntimeState::WaitingApproval,
            session.last_approval_prompt_at,
        );
    }

    if codex_session_is_waiting_for_instruction(session) {
        return AgentRuntimeSnapshot::with_state(
            AgentKind::Codex,
            AgentRuntimeState::WaitingPrompt,
            session.last_prompt_ready_at,
        );
    }

    if session.last_prompt_submitted_at.is_none() {
        return AgentRuntimeSnapshot::with_state(
            AgentKind::Codex,
            AgentRuntimeState::Starting,
            session.last_output_at.or(Some(session.started_at)),
        );
    }

    AgentRuntimeSnapshot::with_state(
        AgentKind::Codex,
        AgentRuntimeState::Thinking,
        session
            .last_prompt_submitted_at
            .or(session.last_output_at)
            .or(Some(session.started_at)),
    )
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

    fn session(overrides: impl FnOnce(&mut TerminalSessionRecord)) -> TerminalSessionRecord {
        let mut session = TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            active_profile: Some(TerminalLaunchProfile::Codex),
            cwd: "/tmp".to_string(),
            current_cwd: Some("/tmp".to_string()),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: "Codex".to_string(),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            last_output_tail: String::new(),
            message: None,
        };
        overrides(&mut session);
        session
    }

    #[test]
    fn codex_prompt_output_maps_to_waiting_prompt() {
        let session = session(|session| {
            session.last_output_at = Some(10);
            session.last_prompt_ready_at = Some(20);
        });

        let runtime = agent_runtime_for_session(Some(&session));

        assert_eq!(runtime.kind, AgentKind::Codex);
        assert_eq!(runtime.state, AgentRuntimeState::WaitingPrompt);
        assert_eq!(runtime.last_state_changed_at, Some(20));
    }

    #[test]
    fn submitted_prompt_maps_to_thinking_until_prompt_returns() {
        let session = session(|session| {
            session.last_output_at = Some(10);
            session.last_prompt_submitted_at = Some(20);
            session.last_prompt_ready_at = None;
        });

        let runtime = agent_runtime_for_session(Some(&session));

        assert_eq!(runtime.kind, AgentKind::Codex);
        assert_eq!(runtime.state, AgentRuntimeState::Thinking);
        assert_eq!(runtime.last_state_changed_at, Some(20));
    }

    #[test]
    fn silent_codex_session_without_submitted_prompt_stays_starting() {
        let session = session(|session| {
            session.last_output_at = Some(10);
        });

        let runtime = agent_runtime_for_session(Some(&session));

        assert_eq!(runtime.kind, AgentKind::Codex);
        assert_eq!(runtime.state, AgentRuntimeState::Starting);
        assert_eq!(runtime.last_state_changed_at, Some(10));
    }

    #[test]
    fn approval_prompt_maps_to_waiting_approval() {
        let session = session(|session| {
            session.last_prompt_submitted_at = Some(20);
            session.last_approval_prompt_at = Some(30);
        });

        let runtime = agent_runtime_for_session(Some(&session));

        assert_eq!(runtime.kind, AgentKind::Codex);
        assert_eq!(runtime.state, AgentRuntimeState::WaitingApproval);
        assert_eq!(runtime.last_state_changed_at, Some(30));
    }

    #[test]
    fn stopped_codex_session_maps_to_completed() {
        let session = session(|session| {
            session.status = TerminalSessionStatus::Exited;
            session.ended_at = Some(30);
        });

        let runtime = agent_runtime_for_session(Some(&session));

        assert_eq!(runtime.kind, AgentKind::Codex);
        assert_eq!(runtime.state, AgentRuntimeState::Completed);
        assert_eq!(runtime.last_state_changed_at, Some(30));
    }

    #[test]
    fn runtime_store_records_submitted_prompt_as_agent_turn() {
        let store = AgentRuntimeStore::default();
        let session = session(|session| {
            session.last_prompt_submitted_at = Some(42);
        });

        let snapshot = store
            .record_prompt_submitted_from_session(&session)
            .unwrap();

        assert_eq!(snapshot.kind, AgentKind::Codex);
        assert_eq!(snapshot.state, AgentRuntimeState::Thinking);
        assert_eq!(snapshot.last_state_changed_at, Some(42));
        assert_eq!(store.snapshot(&session.session_id), Some(snapshot));

        let events = store.events.lock();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_kind, AgentEventKind::PromptSubmitted);
        assert_eq!(events[0].occurred_at, 42);
    }

    #[test]
    fn runtime_store_clears_agent_snapshot_when_session_returns_to_shell() {
        let store = AgentRuntimeStore::default();
        let mut session = session(|session| {
            session.last_prompt_ready_at = Some(20);
        });

        store.sync_from_terminal_session(&session);
        assert_eq!(
            store
                .snapshot(&session.session_id)
                .map(|snapshot| snapshot.state),
            Some(AgentRuntimeState::WaitingPrompt)
        );

        session.profile = TerminalLaunchProfile::Shell;
        session.active_profile = Some(TerminalLaunchProfile::Shell);
        store.sync_from_terminal_session(&session);

        assert_eq!(store.snapshot(&session.session_id), None);
        assert_eq!(
            store.events.lock().last().map(|event| event.event_kind),
            Some(AgentEventKind::Cleared)
        );
    }

    #[test]
    fn prompt_detection_ignores_ansi_control_sequences() {
        assert!(codex_output_suggests_prompt_ready("\x1b[?25l\r\n› "));
        assert!(!codex_output_has_visible_text("\x1b[?25l\x1b[2K\r"));
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
