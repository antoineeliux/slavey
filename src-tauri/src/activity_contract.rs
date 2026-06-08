use serde::Serialize;

use crate::{
    activity::{
        EmployeeActivityStatus, EmployeeAttention, EmployeeAttentionPriority,
        EmployeeAttentionReason, EmployeeLifecycleState, EmployeeRuntimeSession,
        EmployeeSessionKind, EmployeeSessionState, EmployeeTurnOwner,
    },
    terminal::{
        AgentKind, AgentRuntimeConfidence, AgentRuntimeSnapshot, AgentRuntimeSource,
        AgentRuntimeState, TerminalSessionRuntime,
    },
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractWorkKind {
    None,
    Shell,
    Codex,
    Action,
    Process,
    Review,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractWorkPhase {
    Idle,
    Starting,
    Working,
    WaitingOwner,
    WaitingApproval,
    Ready,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivityContractWork {
    pub kind: EmployeeActivityContractWorkKind,
    pub phase: EmployeeActivityContractWorkPhase,
    pub turn_owner: EmployeeTurnOwner,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractRenderPlacement {
    Desk,
    OwnerOffice,
    Standby,
    DoneRoom,
    Offline,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractRenderPosture {
    Sitting,
    Standing,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractRenderActivity {
    Idle,
    Working,
    Terminal,
    WaitingInstruction,
    Approval,
    Review,
    Handoff,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivityContractRender {
    pub placement: EmployeeActivityContractRenderPlacement,
    pub posture: EmployeeActivityContractRenderPosture,
    pub activity: EmployeeActivityContractRenderActivity,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractSourceRuntime {
    None,
    Pty,
    CodexAppServer,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityContractSourceConfidence {
    None,
    Fallback,
    Structured,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivityContractSource {
    pub runtime: EmployeeActivityContractSourceRuntime,
    pub confidence: EmployeeActivityContractSourceConfidence,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivityContract {
    pub lifecycle: EmployeeLifecycleState,
    pub work: EmployeeActivityContractWork,
    pub render: EmployeeActivityContractRender,
    pub attention: EmployeeAttention,
    pub source: EmployeeActivityContractSource,
}

#[derive(Debug, Clone, Copy)]
pub struct EmployeeActivityContractInput {
    pub lifecycle: EmployeeLifecycleState,
    pub session: EmployeeRuntimeSession,
    pub agent: AgentRuntimeSnapshot,
    pub active_terminal_runtime: Option<TerminalSessionRuntime>,
    pub employee_done: bool,
    pub employee_blocked: bool,
    pub has_blockers: bool,
    pub has_active_action: bool,
    pub has_pending_action: bool,
    pub has_pending_approval: bool,
    pub has_active_process: bool,
    pub has_review_changes: bool,
    pub handoff_ready: bool,
}

#[derive(Debug, Clone, Copy)]
struct StatusContractRule {
    status: EmployeeActivityStatus,
    work_kind: EmployeeActivityContractWorkKind,
    render_placement: EmployeeActivityContractRenderPlacement,
    render_activity: EmployeeActivityContractRenderActivity,
}

const STATUS_CONTRACT_RULES: &[StatusContractRule] = &[
    StatusContractRule {
        status: EmployeeActivityStatus::Idle,
        work_kind: EmployeeActivityContractWorkKind::None,
        render_placement: EmployeeActivityContractRenderPlacement::DoneRoom,
        render_activity: EmployeeActivityContractRenderActivity::Idle,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::ShellRunning,
        work_kind: EmployeeActivityContractWorkKind::Shell,
        render_placement: EmployeeActivityContractRenderPlacement::DoneRoom,
        render_activity: EmployeeActivityContractRenderActivity::Terminal,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::CodexStarting,
        work_kind: EmployeeActivityContractWorkKind::Codex,
        render_placement: EmployeeActivityContractRenderPlacement::DoneRoom,
        render_activity: EmployeeActivityContractRenderActivity::Terminal,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::CodexRunning,
        work_kind: EmployeeActivityContractWorkKind::Codex,
        render_placement: EmployeeActivityContractRenderPlacement::Desk,
        render_activity: EmployeeActivityContractRenderActivity::Working,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::CodexWaitingInstruction,
        work_kind: EmployeeActivityContractWorkKind::Codex,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::WaitingInstruction,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::CodexWaitingApproval,
        work_kind: EmployeeActivityContractWorkKind::Codex,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Approval,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::Standby,
        work_kind: EmployeeActivityContractWorkKind::None,
        render_placement: EmployeeActivityContractRenderPlacement::Standby,
        render_activity: EmployeeActivityContractRenderActivity::Idle,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::ActionPendingApproval,
        work_kind: EmployeeActivityContractWorkKind::Action,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Approval,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::ActionRunning,
        work_kind: EmployeeActivityContractWorkKind::Action,
        render_placement: EmployeeActivityContractRenderPlacement::Desk,
        render_activity: EmployeeActivityContractRenderActivity::Working,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::ProcessRunning,
        work_kind: EmployeeActivityContractWorkKind::Process,
        render_placement: EmployeeActivityContractRenderPlacement::Desk,
        render_activity: EmployeeActivityContractRenderActivity::Terminal,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::ReviewNeeded,
        work_kind: EmployeeActivityContractWorkKind::Review,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Review,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::HandoffReady,
        work_kind: EmployeeActivityContractWorkKind::Review,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Handoff,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::DoneClean,
        work_kind: EmployeeActivityContractWorkKind::Review,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Handoff,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::Blocked,
        work_kind: EmployeeActivityContractWorkKind::None,
        render_placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
        render_activity: EmployeeActivityContractRenderActivity::Blocked,
    },
    StatusContractRule {
        status: EmployeeActivityStatus::Stopped,
        work_kind: EmployeeActivityContractWorkKind::None,
        render_placement: EmployeeActivityContractRenderPlacement::Offline,
        render_activity: EmployeeActivityContractRenderActivity::Idle,
    },
];

pub fn resolve_employee_activity_contract(
    input: EmployeeActivityContractInput,
) -> EmployeeActivityContract {
    let status = canonical_contract_status(input);
    let rule = status_contract_rule(status);
    let placement = contract_render_placement(input.lifecycle, rule);
    let work = contract_work(status, rule);

    EmployeeActivityContract {
        lifecycle: input.lifecycle,
        work,
        render: EmployeeActivityContractRender {
            placement,
            posture: contract_render_posture(placement),
            activity: rule.render_activity,
        },
        attention: contract_attention(status),
        source: contract_source(input.agent, input.active_terminal_runtime),
    }
}

fn canonical_contract_status(input: EmployeeActivityContractInput) -> EmployeeActivityStatus {
    if input.lifecycle == EmployeeLifecycleState::Standby {
        return EmployeeActivityStatus::Standby;
    }
    if input.lifecycle == EmployeeLifecycleState::Stopped {
        return EmployeeActivityStatus::Stopped;
    }

    let terminal_status = terminal_activity_status(input.session, input.agent);
    if matches!(
        terminal_status,
        Some(
            EmployeeActivityStatus::CodexWaitingInstruction
                | EmployeeActivityStatus::CodexWaitingApproval
        )
    ) {
        return terminal_status.expect("checked terminal owner-wait status");
    }

    if input.employee_blocked
        || input.lifecycle == EmployeeLifecycleState::Failed
        || input.has_blockers
    {
        return EmployeeActivityStatus::Blocked;
    }
    if input.has_active_action {
        return EmployeeActivityStatus::ActionRunning;
    }
    if input.has_pending_action || input.has_pending_approval {
        return EmployeeActivityStatus::ActionPendingApproval;
    }
    if input.has_active_process {
        return EmployeeActivityStatus::ProcessRunning;
    }
    if let Some(status) = terminal_status {
        return status;
    }
    if input.has_review_changes {
        return EmployeeActivityStatus::ReviewNeeded;
    }
    if input.handoff_ready {
        return EmployeeActivityStatus::HandoffReady;
    }
    if input.employee_done {
        return EmployeeActivityStatus::DoneClean;
    }

    EmployeeActivityStatus::Idle
}

fn terminal_activity_status(
    session: EmployeeRuntimeSession,
    agent: AgentRuntimeSnapshot,
) -> Option<EmployeeActivityStatus> {
    if !matches!(
        session.state,
        EmployeeSessionState::Open | EmployeeSessionState::Starting
    ) {
        return None;
    }

    match agent.state {
        AgentRuntimeState::Starting => return Some(EmployeeActivityStatus::CodexStarting),
        AgentRuntimeState::WaitingPrompt => {
            return Some(EmployeeActivityStatus::CodexWaitingInstruction);
        }
        AgentRuntimeState::WaitingApproval => {
            return Some(EmployeeActivityStatus::CodexWaitingApproval);
        }
        AgentRuntimeState::Completed => return Some(EmployeeActivityStatus::DoneClean),
        AgentRuntimeState::Failed => return Some(EmployeeActivityStatus::Blocked),
        AgentRuntimeState::Thinking if agent.kind == AgentKind::Codex => {
            return Some(EmployeeActivityStatus::CodexRunning);
        }
        AgentRuntimeState::NotActive | AgentRuntimeState::Thinking => {}
    }

    if agent.kind == AgentKind::Codex && agent.state != AgentRuntimeState::NotActive {
        return Some(EmployeeActivityStatus::CodexRunning);
    }

    if session.state != EmployeeSessionState::Open {
        return None;
    }

    match session.kind {
        EmployeeSessionKind::Shell => Some(EmployeeActivityStatus::ShellRunning),
        EmployeeSessionKind::Codex => Some(EmployeeActivityStatus::CodexRunning),
        EmployeeSessionKind::None | EmployeeSessionKind::Claude => None,
    }
}

fn status_contract_rule(status: EmployeeActivityStatus) -> &'static StatusContractRule {
    STATUS_CONTRACT_RULES
        .iter()
        .find(|rule| rule.status == status)
        .expect("all employee activity statuses must have a contract rule")
}

fn contract_work(
    status: EmployeeActivityStatus,
    rule: &StatusContractRule,
) -> EmployeeActivityContractWork {
    let (phase, turn_owner) = match status {
        EmployeeActivityStatus::Idle
        | EmployeeActivityStatus::ShellRunning
        | EmployeeActivityStatus::Standby
        | EmployeeActivityStatus::Stopped => (
            EmployeeActivityContractWorkPhase::Idle,
            EmployeeTurnOwner::None,
        ),
        EmployeeActivityStatus::CodexStarting => (
            EmployeeActivityContractWorkPhase::Starting,
            EmployeeTurnOwner::None,
        ),
        EmployeeActivityStatus::CodexRunning => (
            EmployeeActivityContractWorkPhase::Working,
            EmployeeTurnOwner::Agent,
        ),
        EmployeeActivityStatus::ActionRunning | EmployeeActivityStatus::ProcessRunning => (
            EmployeeActivityContractWorkPhase::Working,
            EmployeeTurnOwner::Tool,
        ),
        EmployeeActivityStatus::CodexWaitingInstruction => (
            EmployeeActivityContractWorkPhase::WaitingOwner,
            EmployeeTurnOwner::Owner,
        ),
        EmployeeActivityStatus::CodexWaitingApproval
        | EmployeeActivityStatus::ActionPendingApproval => (
            EmployeeActivityContractWorkPhase::WaitingApproval,
            EmployeeTurnOwner::Owner,
        ),
        EmployeeActivityStatus::ReviewNeeded
        | EmployeeActivityStatus::HandoffReady
        | EmployeeActivityStatus::DoneClean => (
            EmployeeActivityContractWorkPhase::Ready,
            EmployeeTurnOwner::Owner,
        ),
        EmployeeActivityStatus::Blocked => (
            EmployeeActivityContractWorkPhase::Blocked,
            EmployeeTurnOwner::Owner,
        ),
    };

    EmployeeActivityContractWork {
        kind: rule.work_kind,
        phase,
        turn_owner,
    }
}

fn contract_attention(status: EmployeeActivityStatus) -> EmployeeAttention {
    let (reason, priority) = match status {
        EmployeeActivityStatus::CodexWaitingInstruction => (
            Some(EmployeeAttentionReason::NeedsInstruction),
            EmployeeAttentionPriority::Normal,
        ),
        EmployeeActivityStatus::CodexWaitingApproval => (
            Some(EmployeeAttentionReason::NeedsTerminalApproval),
            EmployeeAttentionPriority::Urgent,
        ),
        EmployeeActivityStatus::ActionPendingApproval => (
            Some(EmployeeAttentionReason::NeedsAppApproval),
            EmployeeAttentionPriority::Urgent,
        ),
        EmployeeActivityStatus::ReviewNeeded => (
            Some(EmployeeAttentionReason::ReviewNeeded),
            EmployeeAttentionPriority::Normal,
        ),
        EmployeeActivityStatus::HandoffReady => (
            Some(EmployeeAttentionReason::HandoffReady),
            EmployeeAttentionPriority::Normal,
        ),
        EmployeeActivityStatus::DoneClean => (
            Some(EmployeeAttentionReason::ReadyToReport),
            EmployeeAttentionPriority::Normal,
        ),
        EmployeeActivityStatus::Blocked => (
            Some(EmployeeAttentionReason::BlockedNeedsHelp),
            EmployeeAttentionPriority::Urgent,
        ),
        EmployeeActivityStatus::Idle
        | EmployeeActivityStatus::ShellRunning
        | EmployeeActivityStatus::CodexStarting
        | EmployeeActivityStatus::CodexRunning
        | EmployeeActivityStatus::Standby
        | EmployeeActivityStatus::ActionRunning
        | EmployeeActivityStatus::ProcessRunning
        | EmployeeActivityStatus::Stopped => (None, EmployeeAttentionPriority::None),
    };

    EmployeeAttention {
        required: reason.is_some(),
        reason,
        priority,
    }
}

fn contract_render_placement(
    lifecycle: EmployeeLifecycleState,
    rule: &StatusContractRule,
) -> EmployeeActivityContractRenderPlacement {
    if lifecycle == EmployeeLifecycleState::Standby {
        return EmployeeActivityContractRenderPlacement::Standby;
    }
    if lifecycle == EmployeeLifecycleState::Stopped {
        return EmployeeActivityContractRenderPlacement::Offline;
    }

    rule.render_placement
}

fn contract_render_posture(
    placement: EmployeeActivityContractRenderPlacement,
) -> EmployeeActivityContractRenderPosture {
    match placement {
        EmployeeActivityContractRenderPlacement::Desk => {
            EmployeeActivityContractRenderPosture::Sitting
        }
        EmployeeActivityContractRenderPlacement::OwnerOffice
        | EmployeeActivityContractRenderPlacement::Standby
        | EmployeeActivityContractRenderPlacement::DoneRoom
        | EmployeeActivityContractRenderPlacement::Offline => {
            EmployeeActivityContractRenderPosture::Standing
        }
    }
}

fn contract_source(
    agent: AgentRuntimeSnapshot,
    active_terminal_runtime: Option<TerminalSessionRuntime>,
) -> EmployeeActivityContractSource {
    let runtime = match agent.source {
        AgentRuntimeSource::CodexAppServer => EmployeeActivityContractSourceRuntime::CodexAppServer,
        AgentRuntimeSource::TerminalFallback => EmployeeActivityContractSourceRuntime::Pty,
        AgentRuntimeSource::None => active_terminal_runtime
            .map(contract_source_runtime_for_terminal)
            .unwrap_or(EmployeeActivityContractSourceRuntime::None),
    };
    let confidence = match agent.confidence {
        AgentRuntimeConfidence::Structured => EmployeeActivityContractSourceConfidence::Structured,
        AgentRuntimeConfidence::TerminalFallback => {
            EmployeeActivityContractSourceConfidence::Fallback
        }
        AgentRuntimeConfidence::None if active_terminal_runtime.is_some() => {
            EmployeeActivityContractSourceConfidence::Fallback
        }
        AgentRuntimeConfidence::None => EmployeeActivityContractSourceConfidence::None,
    };

    EmployeeActivityContractSource {
        runtime,
        confidence,
    }
}

fn contract_source_runtime_for_terminal(
    runtime: TerminalSessionRuntime,
) -> EmployeeActivityContractSourceRuntime {
    match runtime {
        TerminalSessionRuntime::Pty => EmployeeActivityContractSourceRuntime::Pty,
        TerminalSessionRuntime::CodexAppServer => {
            EmployeeActivityContractSourceRuntime::CodexAppServer
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::AgentRuntimeState;

    #[test]
    fn status_contract_rules_cover_each_status_exactly_once() {
        let statuses = all_employee_activity_statuses();
        assert_eq!(
            STATUS_CONTRACT_RULES.len(),
            statuses.len(),
            "STATUS_CONTRACT_RULES must have exactly one rule per EmployeeActivityStatus"
        );

        for status in statuses {
            let count = STATUS_CONTRACT_RULES
                .iter()
                .filter(|rule| rule.status == status)
                .count();
            assert_eq!(
                count, 1,
                "expected exactly one STATUS_CONTRACT_RULES entry for {status:?}"
            );
        }

        for (index, rule) in STATUS_CONTRACT_RULES.iter().enumerate() {
            let duplicate = STATUS_CONTRACT_RULES
                .iter()
                .skip(index + 1)
                .find(|candidate| candidate.status == rule.status);
            assert!(
                duplicate.is_none(),
                "duplicate STATUS_CONTRACT_RULES entry for {:?}",
                rule.status
            );
        }
    }

    #[test]
    fn status_contract_rules_resolve_and_preserve_render_invariants() {
        for rule in STATUS_CONTRACT_RULES {
            let resolved_rule = status_contract_rule(rule.status);
            let work = contract_work(rule.status, resolved_rule);
            let placement =
                contract_render_placement(EmployeeLifecycleState::Active, resolved_rule);
            let posture = contract_render_posture(placement);
            let attention = contract_attention(rule.status);

            assert_eq!(resolved_rule.status, rule.status);
            assert_eq!(work.kind, rule.work_kind);
            assert_eq!(placement, rule.render_placement);

            if placement == EmployeeActivityContractRenderPlacement::Desk {
                assert_eq!(posture, EmployeeActivityContractRenderPosture::Sitting);
                assert!(
                    matches!(
                        rule.render_activity,
                        EmployeeActivityContractRenderActivity::Working
                            | EmployeeActivityContractRenderActivity::Terminal
                    ),
                    "desk rule {:?} must render productive work or terminal activity",
                    rule.status
                );
                assert!(
                    !matches!(
                        work.kind,
                        EmployeeActivityContractWorkKind::None
                            | EmployeeActivityContractWorkKind::Review
                    ),
                    "desk rule {:?} must use a productive work kind",
                    rule.status
                );
            } else {
                assert_eq!(posture, EmployeeActivityContractRenderPosture::Standing);
            }

            if placement == EmployeeActivityContractRenderPlacement::OwnerOffice {
                assert!(
                    attention.required,
                    "owner-office rule {:?} must require owner attention",
                    rule.status
                );
                assert!(
                    attention.reason.is_some(),
                    "owner-office rule {:?} must include an attention reason",
                    rule.status
                );
                assert_eq!(
                    work.turn_owner,
                    EmployeeTurnOwner::Owner,
                    "owner-office rule {:?} must be owner-owned",
                    rule.status
                );
            }
        }
    }

    #[test]
    fn render_posture_follows_placement_invariant() {
        for placement in all_render_placements() {
            let expected = match placement {
                EmployeeActivityContractRenderPlacement::Desk => {
                    EmployeeActivityContractRenderPosture::Sitting
                }
                EmployeeActivityContractRenderPlacement::OwnerOffice
                | EmployeeActivityContractRenderPlacement::Standby
                | EmployeeActivityContractRenderPlacement::DoneRoom
                | EmployeeActivityContractRenderPlacement::Offline => {
                    EmployeeActivityContractRenderPosture::Standing
                }
            };

            assert_eq!(contract_render_posture(placement), expected);
        }
    }

    #[test]
    fn terminal_owner_wait_beats_active_action_and_process() {
        let contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::WaitingApproval,
                Some(10),
            ),
            has_active_action: true,
            has_active_process: true,
            ..base_input()
        });

        assert_contract(
            contract,
            ExpectedContract {
                kind: EmployeeActivityContractWorkKind::Codex,
                phase: EmployeeActivityContractWorkPhase::WaitingApproval,
                turn_owner: EmployeeTurnOwner::Owner,
                placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                activity: EmployeeActivityContractRenderActivity::Approval,
                attention_reason: Some(EmployeeAttentionReason::NeedsTerminalApproval),
            },
        );
    }

    #[test]
    fn active_action_beats_normal_codex_terminal_running() {
        let contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Thinking,
                Some(10),
            ),
            has_active_action: true,
            ..base_input()
        });

        assert_contract(
            contract,
            ExpectedContract {
                kind: EmployeeActivityContractWorkKind::Action,
                phase: EmployeeActivityContractWorkPhase::Working,
                turn_owner: EmployeeTurnOwner::Tool,
                placement: EmployeeActivityContractRenderPlacement::Desk,
                activity: EmployeeActivityContractRenderActivity::Working,
                attention_reason: None,
            },
        );
    }

    #[test]
    fn active_process_beats_shell_and_codex_terminal_running() {
        for session in [
            open_session(EmployeeSessionKind::Shell),
            open_session(EmployeeSessionKind::Codex),
        ] {
            let contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
                session,
                has_active_process: true,
                ..base_input()
            });

            assert_contract(
                contract,
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Process,
                    phase: EmployeeActivityContractWorkPhase::Working,
                    turn_owner: EmployeeTurnOwner::Tool,
                    placement: EmployeeActivityContractRenderPlacement::Desk,
                    activity: EmployeeActivityContractRenderActivity::Terminal,
                    attention_reason: None,
                },
            );
        }
    }

    #[test]
    fn failed_agent_blocks_only_without_higher_priority_action_or_process() {
        let failed_agent =
            AgentRuntimeSnapshot::with_state(AgentKind::Codex, AgentRuntimeState::Failed, Some(10));
        let action_contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: failed_agent,
            has_active_action: true,
            ..base_input()
        });
        assert_eq!(
            action_contract.render.placement,
            EmployeeActivityContractRenderPlacement::Desk
        );
        assert_eq!(
            action_contract.work.kind,
            EmployeeActivityContractWorkKind::Action
        );

        let process_contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: failed_agent,
            has_active_process: true,
            ..base_input()
        });
        assert_eq!(
            process_contract.work.kind,
            EmployeeActivityContractWorkKind::Process
        );

        let blocked_contract = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: failed_agent,
            ..base_input()
        });
        assert_contract(
            blocked_contract,
            ExpectedContract {
                kind: EmployeeActivityContractWorkKind::None,
                phase: EmployeeActivityContractWorkPhase::Blocked,
                turn_owner: EmployeeTurnOwner::Owner,
                placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                activity: EmployeeActivityContractRenderActivity::Blocked,
                attention_reason: Some(EmployeeAttentionReason::BlockedNeedsHelp),
            },
        );
    }

    #[test]
    fn maps_terminal_session_activity_from_agent_and_session_evidence() {
        let cases = [
            (
                EmployeeActivityContractInput {
                    session: EmployeeRuntimeSession {
                        kind: EmployeeSessionKind::Codex,
                        state: EmployeeSessionState::Starting,
                    },
                    agent: AgentRuntimeSnapshot::with_state(
                        AgentKind::Codex,
                        AgentRuntimeState::Starting,
                        Some(10),
                    ),
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Codex,
                    phase: EmployeeActivityContractWorkPhase::Starting,
                    turn_owner: EmployeeTurnOwner::None,
                    placement: EmployeeActivityContractRenderPlacement::DoneRoom,
                    activity: EmployeeActivityContractRenderActivity::Terminal,
                    attention_reason: None,
                },
            ),
            (
                EmployeeActivityContractInput {
                    session: open_session(EmployeeSessionKind::Codex),
                    agent: AgentRuntimeSnapshot::with_state(
                        AgentKind::Codex,
                        AgentRuntimeState::WaitingPrompt,
                        Some(10),
                    ),
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Codex,
                    phase: EmployeeActivityContractWorkPhase::WaitingOwner,
                    turn_owner: EmployeeTurnOwner::Owner,
                    placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                    activity: EmployeeActivityContractRenderActivity::WaitingInstruction,
                    attention_reason: Some(EmployeeAttentionReason::NeedsInstruction),
                },
            ),
            (
                EmployeeActivityContractInput {
                    session: open_session(EmployeeSessionKind::Codex),
                    agent: AgentRuntimeSnapshot::with_state(
                        AgentKind::Codex,
                        AgentRuntimeState::Thinking,
                        Some(10),
                    ),
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Codex,
                    phase: EmployeeActivityContractWorkPhase::Working,
                    turn_owner: EmployeeTurnOwner::Agent,
                    placement: EmployeeActivityContractRenderPlacement::Desk,
                    activity: EmployeeActivityContractRenderActivity::Working,
                    attention_reason: None,
                },
            ),
            (
                EmployeeActivityContractInput {
                    session: open_session(EmployeeSessionKind::Shell),
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Shell,
                    phase: EmployeeActivityContractWorkPhase::Idle,
                    turn_owner: EmployeeTurnOwner::None,
                    placement: EmployeeActivityContractRenderPlacement::DoneRoom,
                    activity: EmployeeActivityContractRenderActivity::Terminal,
                    attention_reason: None,
                },
            ),
        ];

        for (input, expected) in cases {
            assert_contract(resolve_employee_activity_contract(input), expected);
        }
    }

    #[test]
    fn maps_review_handoff_done_idle_standby_and_offline_evidence() {
        let cases = [
            (
                EmployeeActivityContractInput {
                    has_review_changes: true,
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Review,
                    phase: EmployeeActivityContractWorkPhase::Ready,
                    turn_owner: EmployeeTurnOwner::Owner,
                    placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                    activity: EmployeeActivityContractRenderActivity::Review,
                    attention_reason: Some(EmployeeAttentionReason::ReviewNeeded),
                },
            ),
            (
                EmployeeActivityContractInput {
                    handoff_ready: true,
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Review,
                    phase: EmployeeActivityContractWorkPhase::Ready,
                    turn_owner: EmployeeTurnOwner::Owner,
                    placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                    activity: EmployeeActivityContractRenderActivity::Handoff,
                    attention_reason: Some(EmployeeAttentionReason::HandoffReady),
                },
            ),
            (
                EmployeeActivityContractInput {
                    employee_done: true,
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Review,
                    phase: EmployeeActivityContractWorkPhase::Ready,
                    turn_owner: EmployeeTurnOwner::Owner,
                    placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                    activity: EmployeeActivityContractRenderActivity::Handoff,
                    attention_reason: Some(EmployeeAttentionReason::ReadyToReport),
                },
            ),
            (
                base_input(),
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::None,
                    phase: EmployeeActivityContractWorkPhase::Idle,
                    turn_owner: EmployeeTurnOwner::None,
                    placement: EmployeeActivityContractRenderPlacement::DoneRoom,
                    activity: EmployeeActivityContractRenderActivity::Idle,
                    attention_reason: None,
                },
            ),
            (
                EmployeeActivityContractInput {
                    lifecycle: EmployeeLifecycleState::Standby,
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::None,
                    phase: EmployeeActivityContractWorkPhase::Idle,
                    turn_owner: EmployeeTurnOwner::None,
                    placement: EmployeeActivityContractRenderPlacement::Standby,
                    activity: EmployeeActivityContractRenderActivity::Idle,
                    attention_reason: None,
                },
            ),
            (
                EmployeeActivityContractInput {
                    lifecycle: EmployeeLifecycleState::Stopped,
                    ..base_input()
                },
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::None,
                    phase: EmployeeActivityContractWorkPhase::Idle,
                    turn_owner: EmployeeTurnOwner::None,
                    placement: EmployeeActivityContractRenderPlacement::Offline,
                    activity: EmployeeActivityContractRenderActivity::Idle,
                    attention_reason: None,
                },
            ),
        ];

        for (input, expected) in cases {
            assert_contract(resolve_employee_activity_contract(input), expected);
        }
    }

    #[test]
    fn pending_action_and_approval_map_to_app_approval_contract() {
        for input in [
            EmployeeActivityContractInput {
                has_pending_action: true,
                ..base_input()
            },
            EmployeeActivityContractInput {
                has_pending_approval: true,
                ..base_input()
            },
        ] {
            assert_contract(
                resolve_employee_activity_contract(input),
                ExpectedContract {
                    kind: EmployeeActivityContractWorkKind::Action,
                    phase: EmployeeActivityContractWorkPhase::WaitingApproval,
                    turn_owner: EmployeeTurnOwner::Owner,
                    placement: EmployeeActivityContractRenderPlacement::OwnerOffice,
                    activity: EmployeeActivityContractRenderActivity::Approval,
                    attention_reason: Some(EmployeeAttentionReason::NeedsAppApproval),
                },
            );
        }
    }

    #[test]
    fn source_maps_terminal_fallback_and_structured_runtime() {
        let fallback = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: AgentRuntimeSnapshot::with_state(
                AgentKind::Codex,
                AgentRuntimeState::Thinking,
                Some(10),
            ),
            active_terminal_runtime: Some(TerminalSessionRuntime::Pty),
            ..base_input()
        });
        assert_eq!(
            fallback.source.runtime,
            EmployeeActivityContractSourceRuntime::Pty
        );
        assert_eq!(
            fallback.source.confidence,
            EmployeeActivityContractSourceConfidence::Fallback
        );

        let structured = resolve_employee_activity_contract(EmployeeActivityContractInput {
            session: open_session(EmployeeSessionKind::Codex),
            agent: AgentRuntimeSnapshot::with_source(
                AgentKind::Codex,
                AgentRuntimeState::Thinking,
                Some(10),
                AgentRuntimeSource::CodexAppServer,
                AgentRuntimeConfidence::Structured,
            ),
            active_terminal_runtime: Some(TerminalSessionRuntime::CodexAppServer),
            ..base_input()
        });
        assert_eq!(
            structured.source.runtime,
            EmployeeActivityContractSourceRuntime::CodexAppServer
        );
        assert_eq!(
            structured.source.confidence,
            EmployeeActivityContractSourceConfidence::Structured
        );
    }

    #[derive(Debug, Clone, Copy)]
    struct ExpectedContract {
        kind: EmployeeActivityContractWorkKind,
        phase: EmployeeActivityContractWorkPhase,
        turn_owner: EmployeeTurnOwner,
        placement: EmployeeActivityContractRenderPlacement,
        activity: EmployeeActivityContractRenderActivity,
        attention_reason: Option<EmployeeAttentionReason>,
    }

    fn assert_contract(contract: EmployeeActivityContract, expected: ExpectedContract) {
        assert_eq!(contract.work.kind, expected.kind);
        assert_eq!(contract.work.phase, expected.phase);
        assert_eq!(contract.work.turn_owner, expected.turn_owner);
        assert_eq!(contract.render.placement, expected.placement);
        assert_eq!(
            contract.render.posture,
            contract_render_posture(expected.placement)
        );
        assert_eq!(contract.render.activity, expected.activity);
        assert_eq!(
            contract.attention.required,
            expected.attention_reason.is_some()
        );
        assert_eq!(contract.attention.reason, expected.attention_reason);
    }

    fn base_input() -> EmployeeActivityContractInput {
        EmployeeActivityContractInput {
            lifecycle: EmployeeLifecycleState::Active,
            session: EmployeeRuntimeSession {
                kind: EmployeeSessionKind::None,
                state: EmployeeSessionState::Closed,
            },
            agent: AgentRuntimeSnapshot::none(),
            active_terminal_runtime: None,
            employee_done: false,
            employee_blocked: false,
            has_blockers: false,
            has_active_action: false,
            has_pending_action: false,
            has_pending_approval: false,
            has_active_process: false,
            has_review_changes: false,
            handoff_ready: false,
        }
    }

    fn open_session(kind: EmployeeSessionKind) -> EmployeeRuntimeSession {
        EmployeeRuntimeSession {
            kind,
            state: EmployeeSessionState::Open,
        }
    }

    fn all_employee_activity_statuses() -> [EmployeeActivityStatus; 15] {
        use EmployeeActivityStatus::*;
        [
            Idle,
            ShellRunning,
            CodexStarting,
            CodexRunning,
            CodexWaitingInstruction,
            CodexWaitingApproval,
            Standby,
            ActionPendingApproval,
            ActionRunning,
            ProcessRunning,
            ReviewNeeded,
            HandoffReady,
            DoneClean,
            Blocked,
            Stopped,
        ]
        .map(assert_employee_activity_status_exhaustive)
    }

    fn assert_employee_activity_status_exhaustive(
        status: EmployeeActivityStatus,
    ) -> EmployeeActivityStatus {
        match status {
            EmployeeActivityStatus::Idle
            | EmployeeActivityStatus::ShellRunning
            | EmployeeActivityStatus::CodexStarting
            | EmployeeActivityStatus::CodexRunning
            | EmployeeActivityStatus::CodexWaitingInstruction
            | EmployeeActivityStatus::CodexWaitingApproval
            | EmployeeActivityStatus::Standby
            | EmployeeActivityStatus::ActionPendingApproval
            | EmployeeActivityStatus::ActionRunning
            | EmployeeActivityStatus::ProcessRunning
            | EmployeeActivityStatus::ReviewNeeded
            | EmployeeActivityStatus::HandoffReady
            | EmployeeActivityStatus::DoneClean
            | EmployeeActivityStatus::Blocked
            | EmployeeActivityStatus::Stopped => status,
        }
    }

    fn all_render_placements() -> [EmployeeActivityContractRenderPlacement; 5] {
        use EmployeeActivityContractRenderPlacement::*;
        [Desk, OwnerOffice, Standby, DoneRoom, Offline].map(assert_render_placement_exhaustive)
    }

    fn assert_render_placement_exhaustive(
        placement: EmployeeActivityContractRenderPlacement,
    ) -> EmployeeActivityContractRenderPlacement {
        match placement {
            EmployeeActivityContractRenderPlacement::Desk
            | EmployeeActivityContractRenderPlacement::OwnerOffice
            | EmployeeActivityContractRenderPlacement::Standby
            | EmployeeActivityContractRenderPlacement::DoneRoom
            | EmployeeActivityContractRenderPlacement::Offline => placement,
        }
    }
}
