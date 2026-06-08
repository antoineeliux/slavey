use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;

use super::{
    session_store::{
        TerminalSessionRecord, TerminalSessionRuntime, TerminalSessionStatus, TerminalTurnState,
    },
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
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeSource {
    None,
    TerminalFallback,
    CodexAppServer,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeConfidence {
    None,
    TerminalFallback,
    Structured,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeTurnOwner {
    None,
    Owner,
    Agent,
    Tool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSnapshot {
    pub kind: AgentKind,
    pub state: AgentRuntimeState,
    pub last_state_changed_at: Option<u64>,
    pub source: AgentRuntimeSource,
    pub confidence: AgentRuntimeConfidence,
    pub turn_owner: AgentRuntimeTurnOwner,
}

impl AgentRuntimeSnapshot {
    pub fn none() -> Self {
        Self {
            kind: AgentKind::None,
            state: AgentRuntimeState::NotActive,
            last_state_changed_at: None,
            source: AgentRuntimeSource::None,
            confidence: AgentRuntimeConfidence::None,
            turn_owner: AgentRuntimeTurnOwner::None,
        }
    }

    pub fn with_state(
        kind: AgentKind,
        state: AgentRuntimeState,
        last_state_changed_at: Option<u64>,
    ) -> Self {
        let turn_owner = turn_owner_for_state(state);
        Self {
            kind,
            state,
            last_state_changed_at,
            source: if kind == AgentKind::None {
                AgentRuntimeSource::None
            } else {
                AgentRuntimeSource::TerminalFallback
            },
            confidence: if kind == AgentKind::None {
                AgentRuntimeConfidence::None
            } else {
                AgentRuntimeConfidence::TerminalFallback
            },
            turn_owner,
        }
    }

    pub fn with_source(
        kind: AgentKind,
        state: AgentRuntimeState,
        last_state_changed_at: Option<u64>,
        source: AgentRuntimeSource,
        confidence: AgentRuntimeConfidence,
    ) -> Self {
        Self {
            kind,
            state,
            last_state_changed_at,
            source,
            confidence,
            turn_owner: turn_owner_for_state(state),
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
    pub source: AgentRuntimeSource,
    pub confidence: AgentRuntimeConfidence,
    pub turn_owner: AgentRuntimeTurnOwner,
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

        let snapshot = AgentRuntimeSnapshot::with_source(
            event.kind,
            event.state,
            Some(event.occurred_at),
            event.source,
            event.confidence,
        );
        self.snapshots
            .lock()
            .insert(event.session_id.clone(), snapshot);
        Some(snapshot)
    }

    pub fn sync_from_terminal_session(
        &self,
        session: &TerminalSessionRecord,
    ) -> Option<AgentRuntimeSnapshot> {
        if session.runtime == TerminalSessionRuntime::CodexAppServer {
            return self.sync_from_codex_app_server_session(session);
        }

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
        let (source, confidence) = if session.runtime == TerminalSessionRuntime::CodexAppServer {
            (
                AgentRuntimeSource::CodexAppServer,
                AgentRuntimeConfidence::Structured,
            )
        } else {
            (
                AgentRuntimeSource::TerminalFallback,
                AgentRuntimeConfidence::TerminalFallback,
            )
        };
        self.record_event(AgentEvent {
            session_id: session.session_id.clone(),
            kind,
            state: AgentRuntimeState::Thinking,
            event_kind: AgentEventKind::PromptSubmitted,
            occurred_at: session
                .last_prompt_submitted_at
                .unwrap_or_else(crate::events::now_ms),
            source,
            confidence,
            turn_owner: AgentRuntimeTurnOwner::Agent,
        })
    }

    pub fn record_codex_app_server_notification(
        &self,
        session_id: &str,
        method: &str,
        params: &Value,
    ) -> Option<AgentRuntimeSnapshot> {
        let state = codex_app_server_state_for_notification(method, params)?;
        let event_kind = match state {
            AgentRuntimeState::Starting => AgentEventKind::Started,
            AgentRuntimeState::Thinking => AgentEventKind::Thinking,
            AgentRuntimeState::WaitingApproval => AgentEventKind::ApprovalRequested,
            AgentRuntimeState::WaitingPrompt => AgentEventKind::PromptReady,
            AgentRuntimeState::Completed => AgentEventKind::Completed,
            AgentRuntimeState::Failed => AgentEventKind::Failed,
            AgentRuntimeState::NotActive => AgentEventKind::Cleared,
        };
        self.record_event(AgentEvent {
            session_id: session_id.to_string(),
            kind: AgentKind::Codex,
            state,
            event_kind,
            occurred_at: crate::events::now_ms(),
            source: AgentRuntimeSource::CodexAppServer,
            confidence: AgentRuntimeConfidence::Structured,
            turn_owner: turn_owner_for_state(state),
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
            source: AgentRuntimeSource::None,
            confidence: AgentRuntimeConfidence::None,
            turn_owner: AgentRuntimeTurnOwner::None,
        });
    }

    pub fn clear_all(&self) {
        self.snapshots.lock().clear();
        self.events.lock().clear();
    }

    fn sync_from_codex_app_server_session(
        &self,
        session: &TerminalSessionRecord,
    ) -> Option<AgentRuntimeSnapshot> {
        let snapshot = codex_app_server_runtime_for_session(session);
        if session.status == TerminalSessionStatus::Running {
            if let Some(existing) = self.codex_app_server_snapshot(&session.session_id) {
                let existing_changed_at = existing.last_state_changed_at.unwrap_or(0);
                let snapshot_changed_at = snapshot.last_state_changed_at.unwrap_or(0);
                if existing_changed_at >= snapshot_changed_at {
                    return Some(existing);
                }
            }
        }

        let event = agent_event_from_snapshot(session.session_id.clone(), snapshot)?;
        self.record_event(event)
    }

    fn codex_app_server_snapshot(&self, session_id: &str) -> Option<AgentRuntimeSnapshot> {
        self.snapshots
            .lock()
            .get(session_id)
            .copied()
            .filter(|snapshot| {
                snapshot.source == AgentRuntimeSource::CodexAppServer
                    && snapshot.confidence == AgentRuntimeConfidence::Structured
            })
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
        source: snapshot.source,
        confidence: snapshot.confidence,
        turn_owner: snapshot.turn_owner,
    })
}

fn codex_app_server_state_for_notification(
    method: &str,
    params: &Value,
) -> Option<AgentRuntimeState> {
    let normalized_method = method.to_ascii_lowercase();
    match method {
        "error" => Some(AgentRuntimeState::Failed),
        "thread/closed" => Some(AgentRuntimeState::Completed),
        "thread/status/changed" => codex_app_server_state_for_thread_status(params),
        "turn/started" => Some(AgentRuntimeState::Thinking),
        "turn/completed" => {
            let status = params
                .pointer("/turn/status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            if status == "failed" {
                Some(AgentRuntimeState::Failed)
            } else {
                Some(AgentRuntimeState::WaitingPrompt)
            }
        }
        "item/started" | "item/updated" | "item/completed" => Some(AgentRuntimeState::Thinking),
        "serverRequest/resolved" => Some(AgentRuntimeState::Thinking),
        _ if normalized_method.contains("approval") && normalized_method.contains("request") => {
            Some(AgentRuntimeState::WaitingApproval)
        }
        "item/tool/requestUserInput" => Some(AgentRuntimeState::WaitingPrompt),
        _ => None,
    }
}

fn codex_app_server_state_for_thread_status(params: &Value) -> Option<AgentRuntimeState> {
    let status = params.pointer("/status/type").and_then(Value::as_str)?;
    match status {
        "active" => Some(AgentRuntimeState::Thinking),
        "idle" | "notLoaded" => Some(AgentRuntimeState::WaitingPrompt),
        "systemError" => Some(AgentRuntimeState::Failed),
        _ => None,
    }
}

fn codex_app_server_runtime_for_session(session: &TerminalSessionRecord) -> AgentRuntimeSnapshot {
    let (state, changed_at) = match session.status {
        TerminalSessionStatus::Failed => (
            AgentRuntimeState::Failed,
            session.ended_at.or(session.stopped_at),
        ),
        TerminalSessionStatus::Exited | TerminalSessionStatus::Stopped => (
            AgentRuntimeState::Completed,
            session.ended_at.or(session.stopped_at),
        ),
        TerminalSessionStatus::Running => codex_app_server_running_state_for_session(session),
    };

    AgentRuntimeSnapshot::with_source(
        AgentKind::Codex,
        state,
        changed_at.or(Some(session.started_at)),
        AgentRuntimeSource::CodexAppServer,
        AgentRuntimeConfidence::Structured,
    )
}

fn codex_app_server_running_state_for_session(
    session: &TerminalSessionRecord,
) -> (AgentRuntimeState, Option<u64>) {
    match session.turn_state {
        TerminalTurnState::WaitingApproval => (
            AgentRuntimeState::WaitingApproval,
            session.last_approval_prompt_at.or(session.last_output_at),
        ),
        TerminalTurnState::OwnerPromptReady | TerminalTurnState::OwnerComposing => (
            AgentRuntimeState::WaitingPrompt,
            session.last_prompt_ready_at.or(session.last_output_at),
        ),
        TerminalTurnState::PromptSubmitted | TerminalTurnState::AgentWorking => (
            AgentRuntimeState::Thinking,
            session
                .last_prompt_submitted_at
                .or(session.last_output_at)
                .or(Some(session.started_at)),
        ),
        TerminalTurnState::Completed => (
            AgentRuntimeState::Completed,
            session
                .ended_at
                .or(session.stopped_at)
                .or(session.last_output_at),
        ),
        TerminalTurnState::Failed => (
            AgentRuntimeState::Failed,
            session
                .ended_at
                .or(session.stopped_at)
                .or(session.last_output_at),
        ),
        TerminalTurnState::CodexStarting
        | TerminalTurnState::Unknown
        | TerminalTurnState::Shell => {
            if session.last_prompt_submitted_at.is_some() {
                (
                    AgentRuntimeState::Thinking,
                    session
                        .last_prompt_submitted_at
                        .or(session.last_output_at)
                        .or(Some(session.started_at)),
                )
            } else {
                (
                    AgentRuntimeState::Starting,
                    session.last_output_at.or(Some(session.started_at)),
                )
            }
        }
    }
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

    match record.turn_state {
        TerminalTurnState::OwnerPromptReady | TerminalTurnState::OwnerComposing => return true,
        TerminalTurnState::PromptSubmitted
        | TerminalTurnState::AgentWorking
        | TerminalTurnState::WaitingApproval
        | TerminalTurnState::Completed
        | TerminalTurnState::Failed => return false,
        TerminalTurnState::Unknown
        | TerminalTurnState::Shell
        | TerminalTurnState::CodexStarting => {}
    }

    let last_prompt_submitted_at = record.last_prompt_submitted_at.unwrap_or(0);
    let last_prompt_ready_at = record.last_prompt_ready_at.unwrap_or(0);
    last_prompt_ready_at >= last_prompt_submitted_at && last_prompt_ready_at > 0
}

pub fn codex_session_is_waiting_for_approval(record: &TerminalSessionRecord) -> bool {
    if !codex_session_is_active(record) || record.status != TerminalSessionStatus::Running {
        return false;
    }

    match record.turn_state {
        TerminalTurnState::WaitingApproval => return true,
        TerminalTurnState::PromptSubmitted
        | TerminalTurnState::AgentWorking
        | TerminalTurnState::OwnerPromptReady
        | TerminalTurnState::OwnerComposing
        | TerminalTurnState::Completed
        | TerminalTurnState::Failed => return false,
        TerminalTurnState::Unknown
        | TerminalTurnState::Shell
        | TerminalTurnState::CodexStarting => {}
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

pub fn codex_output_suggests_active_work(output: &str) -> bool {
    let clean = strip_ansi(output).replace('\r', "\n").to_ascii_lowercase();
    clean.lines().any(|line| {
        let line = line.trim_start();
        (line.starts_with('•') || line.starts_with('-') || line.starts_with('*'))
            && line.contains("working")
            && (line.contains("esc to interrupt") || line.contains('('))
    })
}

pub fn terminal_input_submits_prompt(input: &str) -> bool {
    input.contains('\r') || input.contains('\n')
}

pub fn terminal_input_updates_owner_prompt(input: &str) -> bool {
    !input.is_empty() && !terminal_input_submits_prompt(input)
}

pub fn codex_session_should_track_prompt(record: &TerminalSessionRecord) -> bool {
    codex_session_is_active(record)
        || record.last_prompt_ready_at.is_some()
        || record.last_approval_prompt_at.is_some()
        || matches!(
            record.turn_state,
            TerminalTurnState::OwnerPromptReady
                | TerminalTurnState::OwnerComposing
                | TerminalTurnState::WaitingApproval
                | TerminalTurnState::PromptSubmitted
                | TerminalTurnState::AgentWorking
        )
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

    match session.turn_state {
        TerminalTurnState::CodexStarting => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Starting,
                session.last_output_at.or(Some(session.started_at)),
            );
        }
        TerminalTurnState::OwnerPromptReady | TerminalTurnState::OwnerComposing => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::WaitingPrompt,
                session.last_prompt_ready_at.or(session.last_output_at),
            );
        }
        TerminalTurnState::WaitingApproval => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::WaitingApproval,
                session.last_approval_prompt_at.or(session.last_output_at),
            );
        }
        TerminalTurnState::PromptSubmitted | TerminalTurnState::AgentWorking => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Thinking,
                session
                    .last_prompt_submitted_at
                    .or(session.last_output_at)
                    .or(Some(session.started_at)),
            );
        }
        TerminalTurnState::Completed => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Completed,
                session.ended_at.or(session.stopped_at),
            );
        }
        TerminalTurnState::Failed => {
            return AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Failed,
                session.ended_at.or(session.stopped_at),
            );
        }
        TerminalTurnState::Shell | TerminalTurnState::Unknown => {}
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

fn turn_owner_for_state(state: AgentRuntimeState) -> AgentRuntimeTurnOwner {
    match state {
        AgentRuntimeState::WaitingPrompt | AgentRuntimeState::WaitingApproval => {
            AgentRuntimeTurnOwner::Owner
        }
        AgentRuntimeState::Thinking => AgentRuntimeTurnOwner::Agent,
        AgentRuntimeState::Starting
        | AgentRuntimeState::Completed
        | AgentRuntimeState::Failed
        | AgentRuntimeState::NotActive => AgentRuntimeTurnOwner::None,
    }
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
    use crate::terminal::TerminalSessionRuntime;

    fn session(overrides: impl FnOnce(&mut TerminalSessionRecord)) -> TerminalSessionRecord {
        let mut session = TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            runtime: TerminalSessionRuntime::Pty,
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
            turn_state: TerminalTurnState::CodexStarting,
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
            session.turn_state = TerminalTurnState::OwnerPromptReady;
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
            session.turn_state = TerminalTurnState::PromptSubmitted;
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
            session.turn_state = TerminalTurnState::WaitingApproval;
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
            session.turn_state = TerminalTurnState::PromptSubmitted;
        });

        let snapshot = store
            .record_prompt_submitted_from_session(&session)
            .unwrap();

        assert_eq!(snapshot.kind, AgentKind::Codex);
        assert_eq!(snapshot.state, AgentRuntimeState::Thinking);
        assert_eq!(snapshot.last_state_changed_at, Some(42));
        assert_eq!(snapshot.source, AgentRuntimeSource::TerminalFallback);
        assert_eq!(
            snapshot.confidence,
            AgentRuntimeConfidence::TerminalFallback
        );
        assert_eq!(store.snapshot(&session.session_id), Some(snapshot));

        let events = store.events.lock();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_kind, AgentEventKind::PromptSubmitted);
        assert_eq!(events[0].occurred_at, 42);
    }

    #[test]
    fn app_server_session_sync_from_prompt_submitted_records_structured_snapshot() {
        let store = AgentRuntimeStore::default();
        let session = session(|session| {
            session.runtime = TerminalSessionRuntime::CodexAppServer;
            session.last_prompt_submitted_at = Some(42);
            session.turn_state = TerminalTurnState::PromptSubmitted;
        });

        let snapshot = store.sync_from_terminal_session(&session).unwrap();

        assert_eq!(snapshot.kind, AgentKind::Codex);
        assert_eq!(snapshot.state, AgentRuntimeState::Thinking);
        assert_eq!(snapshot.last_state_changed_at, Some(42));
        assert_eq!(snapshot.source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(snapshot.confidence, AgentRuntimeConfidence::Structured);
        assert_eq!(store.snapshot(&session.session_id), Some(snapshot));

        let events = store.events.lock();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_kind, AgentEventKind::Thinking);
        assert_eq!(events[0].source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(events[0].confidence, AgentRuntimeConfidence::Structured);
    }

    #[test]
    fn runtime_store_records_codex_app_server_notifications_as_structured() {
        let store = AgentRuntimeStore::default();
        let started = store
            .record_codex_app_server_notification("session-1", "turn/started", &Value::Null)
            .unwrap();

        assert_eq!(started.kind, AgentKind::Codex);
        assert_eq!(started.state, AgentRuntimeState::Thinking);
        assert_eq!(started.source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(started.confidence, AgentRuntimeConfidence::Structured);
        assert_eq!(started.turn_owner, AgentRuntimeTurnOwner::Agent);

        let completed = store
            .record_codex_app_server_notification(
                "session-1",
                "turn/completed",
                &serde_json::json!({ "turn": { "status": "completed" } }),
            )
            .unwrap();

        assert_eq!(completed.state, AgentRuntimeState::WaitingPrompt);
        assert_eq!(completed.source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(completed.confidence, AgentRuntimeConfidence::Structured);

        let approval = store
            .record_codex_app_server_notification(
                "session-1",
                "item/commandExecution/requestApproval",
                &Value::Null,
            )
            .unwrap();

        assert_eq!(approval.state, AgentRuntimeState::WaitingApproval);
        assert_eq!(approval.turn_owner, AgentRuntimeTurnOwner::Owner);

        let active = store
            .record_codex_app_server_notification(
                "session-1",
                "thread/status/changed",
                &serde_json::json!({ "status": { "type": "active", "activeFlags": [] } }),
            )
            .unwrap();

        assert_eq!(active.state, AgentRuntimeState::Thinking);
    }

    #[test]
    fn app_server_session_sync_preserves_structured_waiting_approval_snapshot() {
        let store = AgentRuntimeStore::default();
        let session = session(|session| {
            session.runtime = TerminalSessionRuntime::CodexAppServer;
            session.last_prompt_submitted_at = Some(42);
            session.turn_state = TerminalTurnState::PromptSubmitted;
        });
        let approval = store
            .record_codex_app_server_notification(
                &session.session_id,
                "item/commandExecution/requestApproval",
                &Value::Null,
            )
            .unwrap();

        let synced = store.sync_from_terminal_session(&session).unwrap();

        assert_eq!(synced, approval);
        assert_eq!(synced.state, AgentRuntimeState::WaitingApproval);
        assert_eq!(synced.source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(synced.confidence, AgentRuntimeConfidence::Structured);
        assert_eq!(store.events.lock().len(), 1);
    }

    #[test]
    fn closed_app_server_sessions_never_sync_as_terminal_fallback() {
        for (status, expected_state) in [
            (TerminalSessionStatus::Stopped, AgentRuntimeState::Completed),
            (TerminalSessionStatus::Failed, AgentRuntimeState::Failed),
        ] {
            let store = AgentRuntimeStore::default();
            let session = session(|session| {
                session.runtime = TerminalSessionRuntime::CodexAppServer;
                session.status = status;
                session.ended_at = Some(50);
                session.stopped_at = Some(50);
            });

            let snapshot = store.sync_from_terminal_session(&session).unwrap();

            assert_eq!(snapshot.kind, AgentKind::Codex);
            assert_eq!(snapshot.state, expected_state);
            assert_eq!(snapshot.source, AgentRuntimeSource::CodexAppServer);
            assert_eq!(snapshot.confidence, AgentRuntimeConfidence::Structured);
            assert_eq!(store.snapshot(&session.session_id), Some(snapshot));
            assert_ne!(snapshot.source, AgentRuntimeSource::TerminalFallback);
            assert_ne!(
                snapshot.confidence,
                AgentRuntimeConfidence::TerminalFallback
            );
        }
    }

    #[test]
    fn pty_codex_session_sync_still_records_terminal_fallback_snapshot() {
        let store = AgentRuntimeStore::default();
        let session = session(|session| {
            session.last_prompt_submitted_at = Some(42);
            session.turn_state = TerminalTurnState::PromptSubmitted;
        });

        let snapshot = store.sync_from_terminal_session(&session).unwrap();

        assert_eq!(snapshot.kind, AgentKind::Codex);
        assert_eq!(snapshot.state, AgentRuntimeState::Thinking);
        assert_eq!(snapshot.source, AgentRuntimeSource::TerminalFallback);
        assert_eq!(
            snapshot.confidence,
            AgentRuntimeConfidence::TerminalFallback
        );
        assert_eq!(store.snapshot(&session.session_id), Some(snapshot));
    }

    #[test]
    fn runtime_store_clears_agent_snapshot_when_session_returns_to_shell() {
        let store = AgentRuntimeStore::default();
        let mut session = session(|session| {
            session.last_prompt_ready_at = Some(20);
            session.turn_state = TerminalTurnState::OwnerPromptReady;
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
