use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::{
    agent_runtime::{
        codex_output_ends_at_prompt, codex_output_has_visible_text,
        codex_output_suggests_active_work, codex_output_suggests_approval_choice,
        codex_output_suggests_approval_prompt, codex_output_suggests_prompt_ready,
        codex_session_is_active, codex_session_is_waiting_for_approval,
        codex_session_is_waiting_for_instruction, codex_session_should_track_prompt,
        terminal_input_submits_prompt, terminal_input_updates_owner_prompt,
    },
    TerminalLaunchProfile, TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE, TERMINAL_LABEL_MAX_CHARS,
};

const PROMPT_DETECTION_OUTPUT_TAIL_CHARS: usize = 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStopReason {
    UserStopped,
    Exited,
    FailedToStart,
    AppRestarted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalTurnState {
    Unknown,
    Shell,
    CodexStarting,
    OwnerPromptReady,
    OwnerComposing,
    PromptSubmitted,
    AgentWorking,
    WaitingApproval,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionRuntime {
    Pty,
    CodexAppServer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRecord {
    pub session_id: String,
    pub employee_id: String,
    pub profile: TerminalLaunchProfile,
    #[serde(default = "default_terminal_session_runtime")]
    pub runtime: TerminalSessionRuntime,
    #[serde(default)]
    pub active_profile: Option<TerminalLaunchProfile>,
    pub cwd: String,
    #[serde(default)]
    pub current_cwd: Option<String>,
    pub status: TerminalSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub stopped_at: Option<u64>,
    #[serde(default)]
    pub stop_reason: Option<TerminalStopReason>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub last_output_at: Option<u64>,
    #[serde(default)]
    pub last_prompt_submitted_at: Option<u64>,
    #[serde(default)]
    pub last_prompt_ready_at: Option<u64>,
    #[serde(default)]
    pub last_approval_prompt_at: Option<u64>,
    #[serde(default = "default_terminal_turn_state")]
    pub turn_state: TerminalTurnState,
    #[serde(default, skip_serializing)]
    pub last_output_tail: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Default)]
pub struct TerminalSessionStore {
    records: Arc<Mutex<HashMap<String, TerminalSessionRecord>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalTurnTransitionKind {
    NoChange,
    Output,
    Input,
    ActiveProfile,
    Finish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalTurnTransitionReason {
    ShellOutput,
    CodexApprovalPrompt,
    CodexActiveWork,
    CodexPromptReady,
    CodexPromptReadyAtEndStaleWorkRedraw,
    OwnerPromptEchoIgnored,
    OwnerInputSubmitted,
    OwnerComposing,
    NoActivityRelevantChange,
    ActiveProfileResetToShell,
    ActiveProfileChangedToCodex,
    SessionFinishedCompleted,
    SessionFinishedFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimestampTransition {
    Unchanged,
    SetNow,
    Clear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminalTurnTransition {
    kind: TerminalTurnTransitionKind,
    reason: TerminalTurnTransitionReason,
    active_profile: Option<TerminalLaunchProfile>,
    turn_state: Option<TerminalTurnState>,
    last_output_at: bool,
    prompt_submitted_at: TimestampTransition,
    prompt_ready_at: TimestampTransition,
    approval_prompt_at: TimestampTransition,
    clear_output_tail: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminalOutputEvidence {
    codex_approval_prompt: bool,
    owner_waiting: bool,
    codex_prompt_ready: bool,
    codex_prompt_ready_at_end: bool,
    codex_active_work: bool,
    stale_work_redraw_at_prompt: bool,
    has_visible_text: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TerminalFinishTransition {
    status: TerminalSessionStatus,
    turn_transition: TerminalTurnTransition,
}

impl TerminalTurnTransition {
    fn new(
        kind: TerminalTurnTransitionKind,
        reason: TerminalTurnTransitionReason,
    ) -> TerminalTurnTransition {
        TerminalTurnTransition {
            kind,
            reason,
            active_profile: None,
            turn_state: None,
            last_output_at: false,
            prompt_submitted_at: TimestampTransition::Unchanged,
            prompt_ready_at: TimestampTransition::Unchanged,
            approval_prompt_at: TimestampTransition::Unchanged,
            clear_output_tail: false,
        }
    }

    fn no_change(reason: TerminalTurnTransitionReason) -> TerminalTurnTransition {
        TerminalTurnTransition::new(TerminalTurnTransitionKind::NoChange, reason)
    }

    fn with_active_profile(mut self, active_profile: TerminalLaunchProfile) -> Self {
        self.active_profile = Some(active_profile);
        self
    }

    fn with_turn_state(mut self, turn_state: TerminalTurnState) -> Self {
        self.turn_state = Some(turn_state);
        self
    }

    fn with_last_output_at(mut self) -> Self {
        self.last_output_at = true;
        self
    }

    fn with_prompt_submitted_at(mut self, transition: TimestampTransition) -> Self {
        self.prompt_submitted_at = transition;
        self
    }

    fn with_prompt_ready_at(mut self, transition: TimestampTransition) -> Self {
        self.prompt_ready_at = transition;
        self
    }

    fn with_approval_prompt_at(mut self, transition: TimestampTransition) -> Self {
        self.approval_prompt_at = transition;
        self
    }

    fn with_clear_output_tail(mut self) -> Self {
        self.clear_output_tail = true;
        self
    }
}

impl TerminalSessionStore {
    pub fn create(
        &self,
        session_id: String,
        employee_id: String,
        profile: TerminalLaunchProfile,
        cwd: String,
    ) -> TerminalSessionRecord {
        self.create_with_runtime(
            session_id,
            employee_id,
            profile,
            cwd,
            TerminalSessionRuntime::Pty,
        )
    }

    pub fn create_with_runtime(
        &self,
        session_id: String,
        employee_id: String,
        profile: TerminalLaunchProfile,
        cwd: String,
        runtime: TerminalSessionRuntime,
    ) -> TerminalSessionRecord {
        let now = crate::events::now_ms();
        let record = TerminalSessionRecord {
            session_id,
            employee_id,
            profile,
            runtime,
            active_profile: Some(profile),
            cwd: cwd.clone(),
            current_cwd: Some(cwd),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: now,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: format!("{} session", profile.display_label()),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            turn_state: initial_turn_state_for_profile(profile),
            last_output_tail: String::new(),
            message: None,
        };
        let mut records = self.records.lock();
        records.insert(record.session_id.clone(), record.clone());
        prune_employee_history(&mut records, &record.employee_id);
        record
    }

    pub fn list(&self, employee_id: Option<&str>) -> Vec<TerminalSessionRecord> {
        let mut records = self
            .records
            .lock()
            .values()
            .filter(|record| {
                employee_id
                    .map(|employee_id| record.employee_id == employee_id)
                    .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>();
        records.sort_by_key(|record| record.started_at);
        records
    }

    pub fn get(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        self.records.lock().get(session_id).cloned()
    }

    pub fn has_running(&self) -> bool {
        self.records
            .lock()
            .values()
            .any(|record| record.status == TerminalSessionStatus::Running)
    }

    pub fn replace_all(&self, records: Vec<TerminalSessionRecord>) {
        let mut next = HashMap::new();
        for record in records {
            let record = normalize_session_record(record);
            next.insert(record.session_id.clone(), record);
        }
        let employee_ids = next
            .values()
            .map(|record| record.employee_id.clone())
            .collect::<Vec<_>>();
        for employee_id in employee_ids {
            prune_employee_history(&mut next, &employee_id);
        }
        *self.records.lock() = next;
    }

    pub fn fail_start(
        &self,
        session_id: &str,
        message: impl Into<String>,
    ) -> Option<TerminalSessionRecord> {
        self.update_terminal_status(
            session_id,
            TerminalSessionStatus::Failed,
            None,
            Some(TerminalStopReason::FailedToStart),
            Some(message),
        )
    }

    pub fn stop(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return Some(record.clone());
        }
        set_terminal_stopped(
            record,
            TerminalSessionStatus::Stopped,
            None,
            Some(TerminalStopReason::UserStopped),
            Some("stopped by user".to_string()),
        );
        Some(record.clone())
    }

    pub fn finish(&self, session_id: &str, exit_code: i32) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running {
            return None;
        }
        let transition = resolve_finish_transition(record, exit_code);
        record.status = transition.status;
        record.exit_code = Some(exit_code);
        let now = crate::events::now_ms();
        record.ended_at = Some(now);
        record.stopped_at = Some(now);
        record.stop_reason = Some(TerminalStopReason::Exited);
        record.message = None;
        apply_terminal_turn_transition(record, transition.turn_transition, now);
        Some(record.clone())
    }

    pub fn touch_output(&self, session_id: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        record.last_output_at = Some(crate::events::now_ms());
        Some(record.clone())
    }

    pub fn set_current_cwd(
        &self,
        session_id: &str,
        current_cwd: impl Into<String>,
    ) -> Option<TerminalSessionRecord> {
        let current_cwd = current_cwd.into();
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running
            || record.current_cwd.as_deref() == Some(current_cwd.as_str())
        {
            return None;
        }
        record.current_cwd = Some(current_cwd);
        Some(record.clone())
    }

    pub fn record_output(&self, session_id: &str, output: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        let now = crate::events::now_ms();
        let previous_active_profile = record.active_profile;
        let previous_prompt_ready_at = record.last_prompt_ready_at;
        let previous_prompt_submitted_at = record.last_prompt_submitted_at;
        let previous_approval_prompt_at = record.last_approval_prompt_at;
        let previous_turn_state = record.turn_state;
        let detection_output = output_for_prompt_detection(&record.last_output_tail, output);
        let evidence = terminal_output_evidence(record, output, &detection_output);
        let transition = resolve_output_transition(record, &evidence);
        apply_terminal_turn_transition(record, transition, now);
        record.last_output_tail = terminal_output_tail(&detection_output);

        let activity_relevant_change = previous_active_profile != record.active_profile
            || previous_prompt_ready_at != record.last_prompt_ready_at
            || previous_prompt_submitted_at != record.last_prompt_submitted_at
            || previous_approval_prompt_at != record.last_approval_prompt_at
            || previous_turn_state != record.turn_state;
        activity_relevant_change.then(|| record.clone())
    }

    pub fn record_input(&self, session_id: &str, input: &str) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running
            || !codex_session_should_track_prompt(record)
        {
            return None;
        }

        let previous_active_profile = record.active_profile;
        let previous_prompt_ready_at = record.last_prompt_ready_at;
        let previous_prompt_submitted_at = record.last_prompt_submitted_at;
        let previous_approval_prompt_at = record.last_approval_prompt_at;
        let previous_turn_state = record.turn_state;

        let now = crate::events::now_ms();
        let transition = resolve_input_transition(record, input);
        apply_terminal_turn_transition(record, transition, now);

        let activity_relevant_change = previous_active_profile != record.active_profile
            || previous_prompt_ready_at != record.last_prompt_ready_at
            || previous_prompt_submitted_at != record.last_prompt_submitted_at
            || previous_approval_prompt_at != record.last_approval_prompt_at
            || previous_turn_state != record.turn_state;
        activity_relevant_change.then(|| record.clone())
    }

    pub fn set_active_profile(
        &self,
        session_id: &str,
        active_profile: TerminalLaunchProfile,
    ) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        if record.status != TerminalSessionStatus::Running
            || record.active_profile == Some(active_profile)
        {
            return None;
        }
        let transition = resolve_active_profile_transition(record, active_profile);
        apply_terminal_turn_transition(record, transition, crate::events::now_ms());
        Some(record.clone())
    }

    pub fn rename(&self, session_id: &str, label: &str) -> Result<TerminalSessionRecord, String> {
        let label = cleaned_session_label(label)?;
        let mut records = self.records.lock();
        let record = records
            .get_mut(session_id)
            .ok_or_else(|| format!("terminal session {session_id} not found"))?;
        record.label = label;
        Ok(record.clone())
    }

    fn update_terminal_status(
        &self,
        session_id: &str,
        status: TerminalSessionStatus,
        exit_code: Option<i32>,
        stop_reason: Option<TerminalStopReason>,
        message: Option<impl Into<String>>,
    ) -> Option<TerminalSessionRecord> {
        let mut records = self.records.lock();
        let record = records.get_mut(session_id)?;
        set_terminal_stopped(
            record,
            status,
            exit_code,
            stop_reason,
            message.map(Into::into),
        );
        Some(record.clone())
    }
}

fn terminal_output_evidence(
    record: &TerminalSessionRecord,
    output: &str,
    detection_output: &str,
) -> TerminalOutputEvidence {
    let codex_approval_prompt = codex_output_suggests_approval_prompt(output)
        || (codex_output_suggests_approval_choice(output)
            && codex_output_suggests_approval_prompt(detection_output));
    let owner_waiting = codex_session_is_waiting_for_instruction(record)
        || codex_session_is_waiting_for_approval(record);
    let codex_prompt_ready = codex_output_suggests_prompt_ready(output)
        || (!owner_waiting && codex_output_suggests_prompt_ready(detection_output));
    let codex_prompt_ready_at_end = codex_output_ends_at_prompt(output)
        || (!owner_waiting && codex_output_ends_at_prompt(detection_output));
    let codex_active_work = !codex_prompt_ready_at_end
        && (codex_output_suggests_active_work(output)
            || (!codex_prompt_ready
                && !codex_approval_prompt
                && codex_output_suggests_active_work(detection_output)));

    TerminalOutputEvidence {
        codex_approval_prompt,
        owner_waiting,
        codex_prompt_ready,
        codex_prompt_ready_at_end,
        codex_active_work,
        stale_work_redraw_at_prompt: codex_prompt_ready_at_end
            && codex_output_suggests_active_work(output),
        has_visible_text: codex_output_has_visible_text(output),
    }
}

fn resolve_output_transition(
    record: &TerminalSessionRecord,
    evidence: &TerminalOutputEvidence,
) -> TerminalTurnTransition {
    if record.status == TerminalSessionStatus::Running
        && evidence.codex_approval_prompt
        && codex_output_should_track_codex(record)
    {
        return TerminalTurnTransition::new(
            TerminalTurnTransitionKind::Output,
            TerminalTurnTransitionReason::CodexApprovalPrompt,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_last_output_at()
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::SetNow)
        .with_turn_state(TerminalTurnState::WaitingApproval);
    }

    if record.status == TerminalSessionStatus::Running
        && evidence.codex_active_work
        && codex_output_should_track_codex(record)
    {
        let mut transition = TerminalTurnTransition::new(
            TerminalTurnTransitionKind::Output,
            TerminalTurnTransitionReason::CodexActiveWork,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_last_output_at()
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::Clear)
        .with_turn_state(TerminalTurnState::AgentWorking);

        if matches!(
            record.turn_state,
            TerminalTurnState::OwnerPromptReady
                | TerminalTurnState::OwnerComposing
                | TerminalTurnState::WaitingApproval
        ) && record.last_prompt_submitted_at.is_none()
        {
            transition = transition.with_prompt_submitted_at(TimestampTransition::SetNow);
        }

        return transition;
    }

    if record.status == TerminalSessionStatus::Running
        && evidence.codex_prompt_ready
        && codex_output_should_track_codex(record)
    {
        let reason = if evidence.stale_work_redraw_at_prompt {
            TerminalTurnTransitionReason::CodexPromptReadyAtEndStaleWorkRedraw
        } else {
            TerminalTurnTransitionReason::CodexPromptReady
        };

        return TerminalTurnTransition::new(TerminalTurnTransitionKind::Output, reason)
            .with_active_profile(TerminalLaunchProfile::Codex)
            .with_last_output_at()
            .with_prompt_ready_at(TimestampTransition::SetNow)
            .with_approval_prompt_at(TimestampTransition::Clear)
            .with_turn_state(TerminalTurnState::OwnerPromptReady);
    }

    if evidence.owner_waiting {
        return TerminalTurnTransition::no_change(
            TerminalTurnTransitionReason::OwnerPromptEchoIgnored,
        );
    }

    let mut transition = TerminalTurnTransition::new(
        TerminalTurnTransitionKind::Output,
        TerminalTurnTransitionReason::NoActivityRelevantChange,
    )
    .with_last_output_at();

    if codex_session_is_active(record)
        && evidence.has_visible_text
        && (matches!(
            record.turn_state,
            TerminalTurnState::PromptSubmitted | TerminalTurnState::AgentWorking
        ) || evidence.codex_active_work)
    {
        transition.reason = TerminalTurnTransitionReason::CodexActiveWork;
        transition.turn_state = Some(TerminalTurnState::AgentWorking);
    } else if record.active_profile.unwrap_or(record.profile) == TerminalLaunchProfile::Shell {
        transition.reason = TerminalTurnTransitionReason::ShellOutput;
        transition.turn_state = Some(TerminalTurnState::Shell);
    }

    transition
}

fn resolve_input_transition(record: &TerminalSessionRecord, input: &str) -> TerminalTurnTransition {
    if terminal_input_submits_prompt(input) {
        return TerminalTurnTransition::new(
            TerminalTurnTransitionKind::Input,
            TerminalTurnTransitionReason::OwnerInputSubmitted,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_prompt_submitted_at(TimestampTransition::SetNow)
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::Clear)
        .with_turn_state(TerminalTurnState::PromptSubmitted)
        .with_clear_output_tail();
    }

    if terminal_input_updates_owner_prompt(input)
        && (codex_session_is_waiting_for_instruction(record)
            || codex_session_is_waiting_for_approval(record))
    {
        return TerminalTurnTransition::new(
            TerminalTurnTransitionKind::Input,
            TerminalTurnTransitionReason::OwnerComposing,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_turn_state(TerminalTurnState::OwnerComposing);
    }

    TerminalTurnTransition::no_change(TerminalTurnTransitionReason::NoActivityRelevantChange)
}

fn resolve_active_profile_transition(
    record: &TerminalSessionRecord,
    active_profile: TerminalLaunchProfile,
) -> TerminalTurnTransition {
    if active_profile == TerminalLaunchProfile::Shell {
        return TerminalTurnTransition::new(
            TerminalTurnTransitionKind::ActiveProfile,
            TerminalTurnTransitionReason::ActiveProfileResetToShell,
        )
        .with_active_profile(TerminalLaunchProfile::Shell)
        .with_prompt_submitted_at(TimestampTransition::Clear)
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::Clear)
        .with_turn_state(TerminalTurnState::Shell)
        .with_clear_output_tail();
    }

    let mut transition = TerminalTurnTransition::new(
        TerminalTurnTransitionKind::ActiveProfile,
        TerminalTurnTransitionReason::ActiveProfileChangedToCodex,
    )
    .with_active_profile(TerminalLaunchProfile::Codex);

    if record.turn_state == TerminalTurnState::Shell {
        transition = transition.with_turn_state(TerminalTurnState::CodexStarting);
    }

    transition
}

fn resolve_finish_transition(
    record: &TerminalSessionRecord,
    exit_code: i32,
) -> TerminalFinishTransition {
    let status = if exit_code == 0 {
        TerminalSessionStatus::Exited
    } else {
        TerminalSessionStatus::Failed
    };
    let reason = if exit_code == 0 {
        TerminalTurnTransitionReason::SessionFinishedCompleted
    } else {
        TerminalTurnTransitionReason::SessionFinishedFailed
    };
    let mut turn_transition =
        TerminalTurnTransition::new(TerminalTurnTransitionKind::Finish, reason);

    if codex_session_should_track_prompt(record) {
        turn_transition = turn_transition.with_turn_state(match status {
            TerminalSessionStatus::Exited | TerminalSessionStatus::Stopped => {
                TerminalTurnState::Completed
            }
            TerminalSessionStatus::Failed => TerminalTurnState::Failed,
            TerminalSessionStatus::Running => record.turn_state,
        });
    }

    TerminalFinishTransition {
        status,
        turn_transition,
    }
}

fn apply_terminal_turn_transition(
    record: &mut TerminalSessionRecord,
    transition: TerminalTurnTransition,
    now: u64,
) {
    let _reason = transition.reason;

    match transition.kind {
        TerminalTurnTransitionKind::NoChange => return,
        TerminalTurnTransitionKind::Output
        | TerminalTurnTransitionKind::Input
        | TerminalTurnTransitionKind::ActiveProfile
        | TerminalTurnTransitionKind::Finish => {}
    }

    if let Some(active_profile) = transition.active_profile {
        record.active_profile = Some(active_profile);
    }
    if transition.last_output_at {
        record.last_output_at = Some(now);
    }
    apply_timestamp_transition(
        &mut record.last_prompt_submitted_at,
        transition.prompt_submitted_at,
        now,
    );
    apply_timestamp_transition(
        &mut record.last_prompt_ready_at,
        transition.prompt_ready_at,
        now,
    );
    apply_timestamp_transition(
        &mut record.last_approval_prompt_at,
        transition.approval_prompt_at,
        now,
    );
    if let Some(turn_state) = transition.turn_state {
        record.turn_state = turn_state;
    }
    if transition.clear_output_tail {
        record.last_output_tail.clear();
    }
}

fn apply_timestamp_transition(
    timestamp: &mut Option<u64>,
    transition: TimestampTransition,
    now: u64,
) {
    match transition {
        TimestampTransition::Unchanged => {}
        TimestampTransition::SetNow => *timestamp = Some(now),
        TimestampTransition::Clear => *timestamp = None,
    }
}

fn codex_output_should_track_codex(record: &TerminalSessionRecord) -> bool {
    codex_session_is_active(record) || record.profile == TerminalLaunchProfile::Shell
}

pub fn restore_terminal_session_records(
    records: &[TerminalSessionRecord],
) -> Vec<TerminalSessionRecord> {
    records
        .iter()
        .cloned()
        .map(|mut record| {
            if record.status == TerminalSessionStatus::Running {
                record.status = TerminalSessionStatus::Stopped;
                record.exit_code = None;
                let now = crate::events::now_ms();
                record.ended_at = Some(now);
                record.stopped_at = Some(now);
                record.stop_reason = Some(TerminalStopReason::AppRestarted);
                record.message =
                    Some("app restarted before terminal session completed".to_string());
            }
            normalize_session_record(record)
        })
        .collect()
}

fn normalize_session_record(mut record: TerminalSessionRecord) -> TerminalSessionRecord {
    if record.label.trim().is_empty() {
        record.label = format!("{} session", record.profile.display_label());
    }
    if record.active_profile.is_none() {
        record.active_profile = Some(record.profile);
    }
    if record.active_profile == Some(TerminalLaunchProfile::Shell) {
        record.last_prompt_submitted_at = None;
        record.last_prompt_ready_at = None;
        record.last_approval_prompt_at = None;
        record.last_output_tail.clear();
    }
    if record.turn_state == TerminalTurnState::Unknown {
        record.turn_state = inferred_turn_state_for_record(&record);
    }
    if record.current_cwd.as_deref().is_none_or(str::is_empty) {
        record.current_cwd = Some(record.cwd.clone());
    }
    if record.stopped_at.is_none() {
        record.stopped_at = record.ended_at;
    }
    record
}

fn output_for_prompt_detection(previous_tail: &str, output: &str) -> String {
    if previous_tail.is_empty() {
        return terminal_output_tail(output);
    }
    terminal_output_tail(&format!("{previous_tail}{output}"))
}

fn terminal_output_tail(output: &str) -> String {
    let tail = output
        .chars()
        .rev()
        .take(PROMPT_DETECTION_OUTPUT_TAIL_CHARS)
        .collect::<Vec<_>>();
    tail.into_iter().rev().collect()
}

fn set_terminal_stopped(
    record: &mut TerminalSessionRecord,
    status: TerminalSessionStatus,
    exit_code: Option<i32>,
    stop_reason: Option<TerminalStopReason>,
    message: Option<String>,
) {
    let now = crate::events::now_ms();
    record.status = status;
    record.exit_code = exit_code;
    record.ended_at = Some(now);
    record.stopped_at = Some(now);
    record.stop_reason = stop_reason;
    record.message = message;
    record.turn_state = match status {
        TerminalSessionStatus::Running => record.turn_state,
        TerminalSessionStatus::Exited | TerminalSessionStatus::Stopped => {
            TerminalTurnState::Completed
        }
        TerminalSessionStatus::Failed => TerminalTurnState::Failed,
    };
}

fn default_terminal_turn_state() -> TerminalTurnState {
    TerminalTurnState::Unknown
}

fn default_terminal_session_runtime() -> TerminalSessionRuntime {
    TerminalSessionRuntime::Pty
}

fn initial_turn_state_for_profile(profile: TerminalLaunchProfile) -> TerminalTurnState {
    match profile {
        TerminalLaunchProfile::Shell => TerminalTurnState::Shell,
        TerminalLaunchProfile::Codex => TerminalTurnState::CodexStarting,
    }
}

fn inferred_turn_state_for_record(record: &TerminalSessionRecord) -> TerminalTurnState {
    match record.status {
        TerminalSessionStatus::Exited | TerminalSessionStatus::Stopped => {
            TerminalTurnState::Completed
        }
        TerminalSessionStatus::Failed => TerminalTurnState::Failed,
        TerminalSessionStatus::Running => match record.active_profile.unwrap_or(record.profile) {
            TerminalLaunchProfile::Shell => TerminalTurnState::Shell,
            TerminalLaunchProfile::Codex => {
                if record.last_approval_prompt_at.is_some() {
                    TerminalTurnState::WaitingApproval
                } else if record.last_prompt_ready_at.is_some() {
                    TerminalTurnState::OwnerPromptReady
                } else if record.last_prompt_submitted_at.is_some() {
                    TerminalTurnState::PromptSubmitted
                } else {
                    TerminalTurnState::CodexStarting
                }
            }
        },
    }
}

fn prune_employee_history(records: &mut HashMap<String, TerminalSessionRecord>, employee_id: &str) {
    let mut employee_records = records
        .values()
        .filter(|record| record.employee_id == employee_id)
        .map(|record| {
            (
                record.session_id.clone(),
                record.started_at,
                record.status == TerminalSessionStatus::Running,
            )
        })
        .collect::<Vec<_>>();
    if employee_records.len() <= TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE {
        return;
    }

    employee_records.sort_by_key(|record| std::cmp::Reverse(record.1));
    for (session_id, _started_at, running) in employee_records
        .into_iter()
        .skip(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE)
    {
        if !running {
            records.remove(&session_id);
        }
    }
}

fn cleaned_session_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("terminal session label is required".to_string());
    }
    Ok(label.chars().take(TERMINAL_LABEL_MAX_CHARS).collect())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::super::{TerminalLaunchProfile, TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE};
    use super::{
        codex_session_is_waiting_for_instruction, output_for_prompt_detection,
        resolve_active_profile_transition, resolve_finish_transition, resolve_input_transition,
        resolve_output_transition, restore_terminal_session_records, terminal_output_evidence,
        TerminalSessionRecord, TerminalSessionRuntime, TerminalSessionStatus, TerminalSessionStore,
        TerminalStopReason, TerminalTurnState, TerminalTurnTransitionKind,
        TerminalTurnTransitionReason,
    };

    #[test]
    fn terminal_session_store_creates_and_finishes_record() {
        let store = TerminalSessionStore::default();
        let record = store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            PathBuf::from("/tmp").to_string_lossy().to_string(),
        );

        assert_eq!(record.status, TerminalSessionStatus::Running);

        let finished = store.finish("term-1", 0).unwrap();

        assert_eq!(finished.status, TerminalSessionStatus::Exited);
        assert_eq!(finished.exit_code, Some(0));
        assert_eq!(finished.stop_reason, Some(TerminalStopReason::Exited));
        assert!(finished.ended_at.is_some());
        assert!(finished.stopped_at.is_some());
    }

    #[test]
    fn terminal_session_finish_updates_codex_turn_state() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );
        store.create(
            "term-2".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let completed = store.finish("term-1", 0).unwrap();
        let failed = store.finish("term-2", 1).unwrap();

        assert_eq!(completed.status, TerminalSessionStatus::Exited);
        assert_eq!(completed.turn_state, TerminalTurnState::Completed);
        assert_eq!(failed.status, TerminalSessionStatus::Failed);
        assert_eq!(failed.turn_state, TerminalTurnState::Failed);
    }

    #[test]
    fn terminal_session_store_lists_gets_and_filters_records() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.create(
            "term-2".to_string(),
            "employee-2".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let employee_records = store.list(Some("employee-1"));

        assert_eq!(employee_records.len(), 1);
        assert_eq!(employee_records[0].session_id, "term-1");
        assert_eq!(store.get("term-2").unwrap().employee_id, "employee-2");
    }

    #[test]
    fn stopped_terminal_session_is_not_overwritten_by_wait_exit() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let stopped = store.stop("term-1").unwrap();
        let finish_result = store.finish("term-1", 1);

        assert_eq!(stopped.status, TerminalSessionStatus::Stopped);
        assert_eq!(stopped.stop_reason, Some(TerminalStopReason::UserStopped));
        assert!(finish_result.is_none());
        assert_eq!(store.list(None)[0].status, TerminalSessionStatus::Stopped);
    }

    #[test]
    fn stopping_already_stopped_session_is_safe() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        let first_stop = store.stop("term-1").unwrap();
        let second_stop = store.stop("term-1").unwrap();

        assert_eq!(second_stop.status, TerminalSessionStatus::Stopped);
        assert_eq!(second_stop.stop_reason, first_stop.stop_reason);
        assert_eq!(second_stop.stopped_at, first_stop.stopped_at);
    }

    #[test]
    fn terminal_session_rename_trims_and_rejects_empty_labels() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );

        let renamed = store.rename("term-1", "  Build watcher  ").unwrap();

        assert_eq!(renamed.label, "Build watcher");
        assert!(store.rename("term-1", "   ").is_err());
    }

    #[test]
    fn running_session_active_profile_can_switch_without_changing_launch_profile() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );

        let updated = store
            .set_active_profile("term-1", TerminalLaunchProfile::Codex)
            .unwrap();

        assert_eq!(updated.profile, TerminalLaunchProfile::Shell);
        assert_eq!(updated.active_profile, Some(TerminalLaunchProfile::Codex));
    }

    #[test]
    fn codex_prompt_turn_state_tracks_ready_and_submitted_prompts() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );

        let ready = store.record_output("term-1", "\r\n› ").unwrap();

        assert_eq!(ready.profile, TerminalLaunchProfile::Shell);
        assert_eq!(ready.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(ready.last_prompt_ready_at.is_some());
        assert_eq!(ready.turn_state, TerminalTurnState::OwnerPromptReady);

        let submitted = store.record_input("term-1", "\r").unwrap();

        assert_eq!(submitted.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(submitted.last_prompt_submitted_at.is_some());
        assert_eq!(submitted.last_prompt_ready_at, None);
        assert_eq!(submitted.turn_state, TerminalTurnState::PromptSubmitted);
    }

    #[test]
    fn codex_owner_draft_input_keeps_terminal_waiting_for_owner() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );
        store.record_output("term-1", "\r\n› ").unwrap();

        let composing = store
            .record_input("term-1", "Improve documentation")
            .unwrap();
        assert_eq!(composing.turn_state, TerminalTurnState::OwnerComposing);
        assert!(codex_session_is_waiting_for_instruction(&composing));

        assert!(store
            .record_output("term-1", "Improve documentation")
            .is_none());
        let current = store.get("term-1").unwrap();
        assert_eq!(current.turn_state, TerminalTurnState::OwnerComposing);
        assert!(codex_session_is_waiting_for_instruction(&current));
    }

    #[test]
    fn shell_codex_work_output_resumes_from_owner_composing() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.record_output("term-1", "\r\n› ").unwrap();
        store.record_input("term-1", "Implement feature").unwrap();

        let working = store
            .record_output("term-1", "\r\n• Working (2s • esc to interrupt)")
            .unwrap();

        assert_eq!(working.profile, TerminalLaunchProfile::Shell);
        assert_eq!(working.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(working.last_prompt_submitted_at.is_some());
        assert_eq!(working.last_prompt_ready_at, None);
        assert_eq!(working.last_approval_prompt_at, None);
        assert_eq!(working.turn_state, TerminalTurnState::AgentWorking);
    }

    #[test]
    fn shell_codex_work_output_beats_prompt_echo_in_same_chunk() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.record_output("term-1", "\r\n› ").unwrap();
        store.record_input("term-1", "Implement feature").unwrap();

        let working = store
            .record_output(
                "term-1",
                "\r\n› Implement feature\r\n\r\n• Working (2s • esc to interrupt)",
            )
            .unwrap();

        assert_eq!(working.active_profile, Some(TerminalLaunchProfile::Codex));
        assert_eq!(working.last_prompt_ready_at, None);
        assert_eq!(working.turn_state, TerminalTurnState::AgentWorking);
    }

    #[test]
    fn shell_codex_prompt_at_end_beats_stale_work_redraw() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.record_output("term-1", "\r\n› ").unwrap();
        store.record_input("term-1", "Implement feature\r").unwrap();
        store
            .record_output("term-1", "\r\n• Working (2s • esc to interrupt)")
            .unwrap();

        let ready = store
            .record_output(
                "term-1",
                "\x1b[2K\r• Working (2s • esc to interrupt)\r\nDone.\r\n› ",
            )
            .unwrap();

        assert_eq!(ready.profile, TerminalLaunchProfile::Shell);
        assert_eq!(ready.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(ready.last_prompt_ready_at.is_some());
        assert_eq!(ready.last_approval_prompt_at, None);
        assert_eq!(ready.turn_state, TerminalTurnState::OwnerPromptReady);
    }

    #[test]
    fn codex_active_work_output_recovers_started_session_as_agent_working() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );

        let working = store
            .record_output("term-1", "\r\n• Working (10s • esc to interrupt)")
            .unwrap();

        assert_eq!(working.active_profile, Some(TerminalLaunchProfile::Codex));
        assert_eq!(working.last_prompt_submitted_at, None);
        assert_eq!(working.last_prompt_ready_at, None);
        assert_eq!(working.turn_state, TerminalTurnState::AgentWorking);
    }

    #[test]
    fn codex_approval_prompt_tracks_separate_owner_approval_state() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );
        store.record_input("term-1", "\r").unwrap();

        let approval = store
            .record_output("term-1", "Allow command to run?\n› Yes / No")
            .unwrap();

        assert_eq!(approval.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(approval.last_approval_prompt_at.is_some());
        assert_eq!(approval.last_prompt_ready_at, None);
        assert_eq!(approval.turn_state, TerminalTurnState::WaitingApproval);
    }

    #[test]
    fn codex_approval_prompt_detection_spans_output_chunks() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Codex,
            "/tmp".to_string(),
        );
        store.record_input("term-1", "\r").unwrap();

        let partial = store.record_output("term-1", "Allow ").unwrap();
        assert_eq!(partial.turn_state, TerminalTurnState::AgentWorking);
        assert_eq!(partial.last_approval_prompt_at, None);

        let approval = store
            .record_output("term-1", "command to run?\n› Yes / No")
            .unwrap();

        assert_eq!(approval.active_profile, Some(TerminalLaunchProfile::Codex));
        assert!(approval.last_approval_prompt_at.is_some());
        assert_eq!(approval.last_prompt_ready_at, None);
        assert_eq!(approval.turn_state, TerminalTurnState::WaitingApproval);
    }

    #[test]
    fn shell_profile_switch_clears_stale_codex_owner_prompt_state() {
        let store = TerminalSessionStore::default();
        store.create(
            "term-1".to_string(),
            "employee-1".to_string(),
            TerminalLaunchProfile::Shell,
            "/tmp".to_string(),
        );
        store.record_output("term-1", "\r\n› ").unwrap();
        store.record_input("term-1", "\r").unwrap();
        store
            .record_output("term-1", "Allow command to run?\n› Yes / No")
            .unwrap();

        let shell = store
            .set_active_profile("term-1", TerminalLaunchProfile::Shell)
            .unwrap();

        assert_eq!(shell.active_profile, Some(TerminalLaunchProfile::Shell));
        assert_eq!(shell.last_prompt_submitted_at, None);
        assert_eq!(shell.last_prompt_ready_at, None);
        assert_eq!(shell.last_approval_prompt_at, None);
        assert_eq!(shell.turn_state, TerminalTurnState::Shell);
    }

    #[test]
    fn terminal_turn_resolver_labels_stale_work_redraw_prompt_return() {
        let record = running_session_record(
            TerminalLaunchProfile::Shell,
            TerminalLaunchProfile::Codex,
            TerminalTurnState::AgentWorking,
        );
        let output = "\x1b[2K\r• Working (2s • esc to interrupt)\r\nDone.\r\n› ";
        let detection_output = output_for_prompt_detection(&record.last_output_tail, output);
        let evidence = terminal_output_evidence(&record, output, &detection_output);

        let transition = resolve_output_transition(&record, &evidence);

        assert_eq!(transition.kind, TerminalTurnTransitionKind::Output);
        assert_eq!(
            transition.reason,
            TerminalTurnTransitionReason::CodexPromptReadyAtEndStaleWorkRedraw
        );
        assert_eq!(
            transition.turn_state,
            Some(TerminalTurnState::OwnerPromptReady)
        );
    }

    #[test]
    fn terminal_turn_resolver_labels_owner_prompt_echo_ignored() {
        let record = running_session_record(
            TerminalLaunchProfile::Codex,
            TerminalLaunchProfile::Codex,
            TerminalTurnState::OwnerComposing,
        );
        let output = "Improve documentation";
        let detection_output = output_for_prompt_detection(&record.last_output_tail, output);
        let evidence = terminal_output_evidence(&record, output, &detection_output);

        let transition = resolve_output_transition(&record, &evidence);

        assert_eq!(transition.kind, TerminalTurnTransitionKind::NoChange);
        assert_eq!(
            transition.reason,
            TerminalTurnTransitionReason::OwnerPromptEchoIgnored
        );
    }

    #[test]
    fn terminal_turn_resolver_labels_owner_input_transitions() {
        let record = running_session_record(
            TerminalLaunchProfile::Codex,
            TerminalLaunchProfile::Codex,
            TerminalTurnState::OwnerPromptReady,
        );

        let composing = resolve_input_transition(&record, "draft");
        let submitted = resolve_input_transition(&record, "draft\r");

        assert_eq!(composing.kind, TerminalTurnTransitionKind::Input);
        assert_eq!(
            composing.reason,
            TerminalTurnTransitionReason::OwnerComposing
        );
        assert_eq!(
            composing.turn_state,
            Some(TerminalTurnState::OwnerComposing)
        );
        assert_eq!(submitted.kind, TerminalTurnTransitionKind::Input);
        assert_eq!(
            submitted.reason,
            TerminalTurnTransitionReason::OwnerInputSubmitted
        );
        assert_eq!(
            submitted.turn_state,
            Some(TerminalTurnState::PromptSubmitted)
        );
    }

    #[test]
    fn terminal_turn_resolver_labels_profile_and_finish_transitions() {
        let shell_reset_record = running_session_record(
            TerminalLaunchProfile::Shell,
            TerminalLaunchProfile::Codex,
            TerminalTurnState::WaitingApproval,
        );
        let codex_start_record = running_session_record(
            TerminalLaunchProfile::Shell,
            TerminalLaunchProfile::Shell,
            TerminalTurnState::Shell,
        );
        let finish_record = running_session_record(
            TerminalLaunchProfile::Codex,
            TerminalLaunchProfile::Codex,
            TerminalTurnState::CodexStarting,
        );

        let shell_reset =
            resolve_active_profile_transition(&shell_reset_record, TerminalLaunchProfile::Shell);
        let codex_started =
            resolve_active_profile_transition(&codex_start_record, TerminalLaunchProfile::Codex);
        let completed = resolve_finish_transition(&finish_record, 0);
        let failed = resolve_finish_transition(&finish_record, 1);

        assert_eq!(
            shell_reset.reason,
            TerminalTurnTransitionReason::ActiveProfileResetToShell
        );
        assert_eq!(shell_reset.turn_state, Some(TerminalTurnState::Shell));
        assert_eq!(
            codex_started.reason,
            TerminalTurnTransitionReason::ActiveProfileChangedToCodex
        );
        assert_eq!(
            codex_started.turn_state,
            Some(TerminalTurnState::CodexStarting)
        );
        assert_eq!(completed.status, TerminalSessionStatus::Exited);
        assert_eq!(
            completed.turn_transition.reason,
            TerminalTurnTransitionReason::SessionFinishedCompleted
        );
        assert_eq!(
            completed.turn_transition.turn_state,
            Some(TerminalTurnState::Completed)
        );
        assert_eq!(failed.status, TerminalSessionStatus::Failed);
        assert_eq!(
            failed.turn_transition.reason,
            TerminalTurnTransitionReason::SessionFinishedFailed
        );
        assert_eq!(
            failed.turn_transition.turn_state,
            Some(TerminalTurnState::Failed)
        );
    }

    #[test]
    fn terminal_session_history_is_capped_per_employee() {
        let store = TerminalSessionStore::default();
        let records = (0..(TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE + 5))
            .map(|index| sample_session_record("employee-1", index as u64))
            .collect::<Vec<_>>();

        store.replace_all(records);

        let records = store.list(Some("employee-1"));
        assert_eq!(records.len(), TERMINAL_HISTORY_LIMIT_PER_EMPLOYEE);
        assert_eq!(records[0].started_at, 5);
    }

    #[test]
    fn restore_running_terminal_session_as_stopped_with_restart_message() {
        let restored = restore_terminal_session_records(&[TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            runtime: TerminalSessionRuntime::Pty,
            active_profile: None,
            cwd: "/tmp".to_string(),
            current_cwd: None,
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: String::new(),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            turn_state: TerminalTurnState::CodexStarting,
            last_output_tail: String::new(),
            message: None,
        }]);

        assert_eq!(restored[0].status, TerminalSessionStatus::Stopped);
        assert_eq!(
            restored[0].stop_reason,
            Some(TerminalStopReason::AppRestarted)
        );
        assert_eq!(restored[0].label, "Codex session");
        assert_eq!(
            restored[0].active_profile,
            Some(TerminalLaunchProfile::Codex)
        );
        assert_eq!(
            restored[0].message.as_deref(),
            Some("app restarted before terminal session completed")
        );
        assert!(restored[0].ended_at.is_some());
        assert!(restored[0].stopped_at.is_some());
    }

    fn sample_session_record(employee_id: &str, started_at: u64) -> TerminalSessionRecord {
        TerminalSessionRecord {
            session_id: format!("term-{started_at}"),
            employee_id: employee_id.to_string(),
            profile: TerminalLaunchProfile::Shell,
            runtime: TerminalSessionRuntime::Pty,
            active_profile: Some(TerminalLaunchProfile::Shell),
            cwd: "/tmp".to_string(),
            current_cwd: Some("/tmp".to_string()),
            status: TerminalSessionStatus::Stopped,
            exit_code: None,
            started_at,
            ended_at: Some(started_at + 1),
            stopped_at: Some(started_at + 1),
            stop_reason: Some(TerminalStopReason::UserStopped),
            label: "Shell session".to_string(),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            turn_state: TerminalTurnState::Completed,
            last_output_tail: String::new(),
            message: None,
        }
    }

    fn running_session_record(
        profile: TerminalLaunchProfile,
        active_profile: TerminalLaunchProfile,
        turn_state: TerminalTurnState,
    ) -> TerminalSessionRecord {
        TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile,
            runtime: TerminalSessionRuntime::Pty,
            active_profile: Some(active_profile),
            cwd: "/tmp".to_string(),
            current_cwd: Some("/tmp".to_string()),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: format!("{} session", profile.display_label()),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            turn_state,
            last_output_tail: String::new(),
            message: None,
        }
    }
}
