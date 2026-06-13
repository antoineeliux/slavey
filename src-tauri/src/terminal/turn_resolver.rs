use super::{
    agent_runtime::{
        codex_session_is_active, codex_session_is_waiting_for_approval,
        codex_session_is_waiting_for_instruction, codex_session_should_track_prompt,
        AgentRuntimeState,
    },
    evidence::{
        codex_output_ends_at_prompt, codex_output_has_completion_text_before_prompt,
        codex_output_has_visible_text, codex_output_suggests_active_work,
        codex_output_suggests_approval_choice, codex_output_suggests_approval_prompt,
        terminal_input_is_bare_newline, terminal_input_submits_prompt,
        terminal_input_updates_owner_prompt,
    },
    session_store::{
        TerminalSessionRecord, TerminalSessionStatus, TerminalTurnState,
        TerminalTurnTransitionReason,
    },
    TerminalLaunchProfile,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TerminalTurnTransitionKind {
    NoChange,
    Output,
    Input,
    ActiveProfile,
    Finish,
    AppServer,
    CodexNotify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TimestampTransition {
    Unchanged,
    SetNow,
    Clear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TerminalTurnTransition {
    pub(super) kind: TerminalTurnTransitionKind,
    pub(super) reason: TerminalTurnTransitionReason,
    pub(super) active_profile: Option<TerminalLaunchProfile>,
    pub(super) turn_state: Option<TerminalTurnState>,
    pub(super) last_output_at: bool,
    pub(super) prompt_submitted_at: TimestampTransition,
    pub(super) prompt_ready_at: TimestampTransition,
    pub(super) approval_prompt_at: TimestampTransition,
    pub(super) notify_turn_complete_at: TimestampTransition,
    pub(super) clear_output_tail: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TerminalOutputEvidence {
    codex_approval_prompt: bool,
    owner_waiting: bool,
    codex_prompt_ready: bool,
    codex_prompt_ready_at_end: bool,
    codex_active_work: bool,
    stale_work_redraw_at_prompt: bool,
    has_visible_text: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TerminalFinishTransition {
    pub(super) status: TerminalSessionStatus,
    pub(super) turn_transition: TerminalTurnTransition,
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
            notify_turn_complete_at: TimestampTransition::Unchanged,
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

    fn with_notify_turn_complete_at(mut self, transition: TimestampTransition) -> Self {
        self.notify_turn_complete_at = transition;
        self
    }

    fn with_clear_output_tail(mut self) -> Self {
        self.clear_output_tail = true;
        self
    }
}

pub(super) fn terminal_output_evidence(
    record: &TerminalSessionRecord,
    output: &str,
    detection_output: &str,
) -> TerminalOutputEvidence {
    // Direct Codex sessions launch with approvals bypassed (see
    // terminal/profile.rs), so terminal approval prompts can only appear in
    // shell-launched sessions.
    let approvals_possible = record.profile != TerminalLaunchProfile::Codex;
    let codex_approval_prompt = approvals_possible
        && (codex_output_suggests_approval_prompt(output)
            || (codex_output_suggests_approval_choice(detection_output)
                && codex_output_suggests_approval_prompt(detection_output)));
    let owner_waiting = codex_session_is_waiting_for_instruction(record)
        || codex_session_is_waiting_for_approval(record);
    let agent_owned = matches!(
        record.turn_state,
        TerminalTurnState::PromptSubmitted | TerminalTurnState::AgentWorking
    );
    let detection_output_ends_at_prompt = codex_output_ends_at_prompt(detection_output);
    let codex_prompt_ready_at_end =
        codex_output_ends_at_prompt(output) || (!owner_waiting && detection_output_ends_at_prompt);
    let codex_active_work_in_output = codex_output_suggests_active_work(output);
    let codex_active_work_evidence = codex_active_work_in_output
        || (!owner_waiting
            && !codex_approval_prompt
            && codex_output_suggests_active_work(detection_output));
    let completion_text_before_prompt =
        codex_output_has_completion_text_before_prompt(detection_output);
    let status_only_work_redraw_at_prompt = codex_prompt_ready_at_end
        && codex_active_work_evidence
        && agent_owned
        && !completion_text_before_prompt;
    let owner_status_only_work_redraw_at_prompt = owner_waiting
        && codex_prompt_ready_at_end
        && codex_active_work_in_output
        && !completion_text_before_prompt;
    let codex_prompt_ready = !status_only_work_redraw_at_prompt
        && codex_prompt_ready_at_end
        && (!agent_owned || completion_text_before_prompt);
    // After a Codex notify agent-turn-complete confirmed the owner's turn, stale
    // working text in redraws cannot prove the agent resumed; only a new owner
    // submission clears the notify timestamp and re-enables work evidence.
    let notify_confirmed_owner_wait =
        owner_waiting && record.last_notify_turn_complete_at.is_some();
    let codex_active_work = !notify_confirmed_owner_wait
        && !owner_status_only_work_redraw_at_prompt
        && (!codex_prompt_ready_at_end || status_only_work_redraw_at_prompt)
        && codex_active_work_evidence;

    TerminalOutputEvidence {
        codex_approval_prompt,
        owner_waiting,
        codex_prompt_ready,
        codex_prompt_ready_at_end,
        codex_active_work,
        stale_work_redraw_at_prompt: codex_prompt_ready_at_end && codex_active_work_in_output,
        has_visible_text: codex_output_has_visible_text(output),
    }
}

pub(super) fn resolve_output_transition(
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

    if evidence.owner_waiting {
        return TerminalTurnTransition::no_change(
            TerminalTurnTransitionReason::OwnerPromptEchoIgnored,
        );
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

pub(super) fn resolve_input_transition(
    record: &TerminalSessionRecord,
    input: &str,
) -> TerminalTurnTransition {
    if terminal_input_submits_prompt(input) {
        // Bare Enter on an empty composer submits nothing to Codex; without a
        // tracked draft there is no turn to wait for.
        if terminal_input_is_bare_newline(input)
            && record.turn_state == TerminalTurnState::OwnerPromptReady
        {
            return TerminalTurnTransition::no_change(
                TerminalTurnTransitionReason::NoActivityRelevantChange,
            );
        }

        return TerminalTurnTransition::new(
            TerminalTurnTransitionKind::Input,
            TerminalTurnTransitionReason::OwnerInputSubmitted,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_prompt_submitted_at(TimestampTransition::SetNow)
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::Clear)
        .with_notify_turn_complete_at(TimestampTransition::Clear)
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

pub(super) fn resolve_active_profile_transition(
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
        .with_notify_turn_complete_at(TimestampTransition::Clear)
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

pub(super) fn resolve_finish_transition(
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

pub(super) fn resolve_app_server_runtime_state_transition(
    record: &TerminalSessionRecord,
    state: AgentRuntimeState,
) -> TerminalTurnTransition {
    match state {
        AgentRuntimeState::NotActive => TerminalTurnTransition::no_change(
            TerminalTurnTransitionReason::NoActivityRelevantChange,
        ),
        AgentRuntimeState::Starting => TerminalTurnTransition::new(
            TerminalTurnTransitionKind::AppServer,
            TerminalTurnTransitionReason::AppServerStarting,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_turn_state(TerminalTurnState::CodexStarting),
        AgentRuntimeState::Thinking => TerminalTurnTransition::new(
            TerminalTurnTransitionKind::AppServer,
            TerminalTurnTransitionReason::AppServerThinking,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_prompt_ready_at(TimestampTransition::Clear)
        .with_approval_prompt_at(TimestampTransition::Clear)
        .with_turn_state(TerminalTurnState::AgentWorking),
        AgentRuntimeState::WaitingPrompt => {
            let prompt_ready_at = if record.turn_state == TerminalTurnState::OwnerPromptReady
                && record.last_prompt_ready_at.is_some()
            {
                TimestampTransition::Unchanged
            } else {
                TimestampTransition::SetNow
            };

            TerminalTurnTransition::new(
                TerminalTurnTransitionKind::AppServer,
                TerminalTurnTransitionReason::AppServerWaitingPrompt,
            )
            .with_active_profile(TerminalLaunchProfile::Codex)
            .with_prompt_ready_at(prompt_ready_at)
            .with_approval_prompt_at(TimestampTransition::Clear)
            .with_turn_state(TerminalTurnState::OwnerPromptReady)
        }
        AgentRuntimeState::WaitingApproval => {
            let approval_prompt_at = if record.turn_state == TerminalTurnState::WaitingApproval
                && record.last_approval_prompt_at.is_some()
            {
                TimestampTransition::Unchanged
            } else {
                TimestampTransition::SetNow
            };

            TerminalTurnTransition::new(
                TerminalTurnTransitionKind::AppServer,
                TerminalTurnTransitionReason::AppServerWaitingApproval,
            )
            .with_active_profile(TerminalLaunchProfile::Codex)
            .with_prompt_ready_at(TimestampTransition::Clear)
            .with_approval_prompt_at(approval_prompt_at)
            .with_turn_state(TerminalTurnState::WaitingApproval)
        }
        AgentRuntimeState::Completed => TerminalTurnTransition::new(
            TerminalTurnTransitionKind::AppServer,
            TerminalTurnTransitionReason::AppServerCompleted,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_turn_state(TerminalTurnState::Completed),
        AgentRuntimeState::Failed => TerminalTurnTransition::new(
            TerminalTurnTransitionKind::AppServer,
            TerminalTurnTransitionReason::AppServerFailed,
        )
        .with_active_profile(TerminalLaunchProfile::Codex)
        .with_turn_state(TerminalTurnState::Failed),
    }
}

pub(super) fn resolve_codex_notify_agent_turn_complete_transition(
    record: &TerminalSessionRecord,
) -> TerminalTurnTransition {
    let prompt_ready_at = if record.turn_state == TerminalTurnState::OwnerPromptReady
        && record.last_prompt_ready_at.is_some()
    {
        TimestampTransition::Unchanged
    } else {
        TimestampTransition::SetNow
    };

    TerminalTurnTransition::new(
        TerminalTurnTransitionKind::CodexNotify,
        TerminalTurnTransitionReason::CodexNotifyAgentTurnComplete,
    )
    .with_active_profile(TerminalLaunchProfile::Codex)
    .with_prompt_ready_at(prompt_ready_at)
    .with_approval_prompt_at(TimestampTransition::Clear)
    .with_notify_turn_complete_at(TimestampTransition::SetNow)
    .with_turn_state(TerminalTurnState::OwnerPromptReady)
    .with_clear_output_tail()
}

fn codex_output_should_track_codex(record: &TerminalSessionRecord) -> bool {
    codex_session_is_active(record) || record.profile == TerminalLaunchProfile::Shell
}
