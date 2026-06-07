use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::State;

use crate::{
    actions::{Action, ActionStatus},
    approvals::{ApprovalRequest, ApprovalStatus},
    employees::{Employee, EmployeeStatus},
    git::{current_branch, parse_status_lines, run_git},
    processes::{ManagedProcess, ManagedProcessStatus},
    terminal::{
        agent_kind_for_command, AgentKind, AgentRuntimeSnapshot, AgentRuntimeState,
        AgentRuntimeStore, TerminalLaunchProfile, TerminalSessionRecord, TerminalSessionStatus,
    },
    AppState,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityStatus {
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
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeLifecycleState {
    Active,
    Standby,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeBehaviorState {
    AtDeskIdle,
    AtDeskTerminal,
    AtDeskWorking,
    WaitingAtOwner,
    OnStandby,
    Offline,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeSessionKind {
    None,
    Shell,
    Codex,
    Claude,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeSessionState {
    Closed,
    Starting,
    Open,
    Exited,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeRuntimeSession {
    pub kind: EmployeeSessionKind,
    pub state: EmployeeSessionState,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeWorkPhase {
    Idle,
    ShellOpen,
    AgentStarting,
    AgentWorking,
    ToolRunning,
    WaitingForOwner,
    ReadyToReport,
    Blocked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeTurnOwner {
    None,
    Owner,
    Agent,
    Tool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeAttentionReason {
    NeedsInstruction,
    NeedsAppApproval,
    NeedsTerminalApproval,
    ReadyToReport,
    ReviewNeeded,
    HandoffReady,
    BlockedNeedsHelp,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeAttentionPriority {
    None,
    Normal,
    Urgent,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeAttention {
    pub required: bool,
    pub reason: Option<EmployeeAttentionReason>,
    pub priority: EmployeeAttentionPriority,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeWorkState {
    pub phase: EmployeeWorkPhase,
    pub turn_owner: EmployeeTurnOwner,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeTerminalActivityState {
    None,
    ShellRunning,
    CodexStarting,
    CodexRunning,
    CodexWaitingInstruction,
    CodexWaitingApproval,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeReviewCounts {
    pub changed_files: usize,
    pub staged_files: usize,
    pub untracked_files: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeActivity {
    pub employee_id: String,
    pub status: EmployeeActivityStatus,
    pub lifecycle: EmployeeLifecycleState,
    pub behavior: EmployeeBehaviorState,
    pub session: EmployeeRuntimeSession,
    pub agent: AgentRuntimeSnapshot,
    pub work: EmployeeWorkState,
    pub attention: EmployeeAttention,
    pub terminal_state: EmployeeTerminalActivityState,
    pub activity_reason: String,
    pub label: String,
    pub details: Option<String>,
    pub last_activity_at: Option<u64>,
    pub active_terminal_session_id: Option<String>,
    pub active_action_id: Option<String>,
    pub active_process_ids: Vec<String>,
    pub review_counts: EmployeeReviewCounts,
    pub blockers: Vec<String>,
}

struct ActivityDerivationInput<'a> {
    employee: &'a Employee,
    workspace_root: PathBuf,
    terminal_sessions: &'a [TerminalSessionRecord],
    actions: &'a [Action],
    approvals: &'a [ApprovalRequest],
    processes: &'a [ManagedProcess],
    agent_runtime: &'a AgentRuntimeStore,
}

#[derive(Debug, Clone)]
struct ActivityResolution {
    status: EmployeeActivityStatus,
    behavior: EmployeeBehaviorState,
    work: EmployeeWorkState,
    attention: EmployeeAttention,
    terminal_state: EmployeeTerminalActivityState,
    label: String,
    details: Option<String>,
    active_action_id: Option<String>,
    activity_reason: String,
}

#[tauri::command]
pub fn employee_activity_list(state: State<'_, AppState>) -> Vec<EmployeeActivity> {
    employee_activity_list_impl(&state)
}

#[tauri::command]
pub fn employee_activity_get(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<EmployeeActivity, String> {
    employee_activity_for_state(&state, &employee_id)
        .ok_or_else(|| "employee not found".to_string())
}

pub(crate) fn employee_activity_list_impl(state: &AppState) -> Vec<EmployeeActivity> {
    let workspace_root = state.workspace_root();
    let employees = state.employees.list();
    let terminal_sessions = state.terminal_sessions.list(None);
    let actions = state.actions.list(None);
    let approvals = state.approvals.list(None);
    let processes = state.processes.list();

    employees
        .iter()
        .map(|employee| {
            derive_employee_activity(ActivityDerivationInput {
                employee,
                workspace_root: workspace_root.clone(),
                terminal_sessions: &terminal_sessions,
                actions: &actions,
                approvals: &approvals,
                processes: &processes,
                agent_runtime: &state.agent_runtime,
            })
        })
        .collect()
}

fn employee_activity_for_state(state: &AppState, employee_id: &str) -> Option<EmployeeActivity> {
    let employee = state.employees.get(employee_id)?;
    let workspace_root = state.workspace_root();
    let terminal_sessions = state.terminal_sessions.list(None);
    let actions = state.actions.list(None);
    let approvals = state.approvals.list(None);
    let processes = state.processes.list();
    Some(derive_employee_activity(ActivityDerivationInput {
        employee: &employee,
        workspace_root,
        terminal_sessions: &terminal_sessions,
        actions: &actions,
        approvals: &approvals,
        processes: &processes,
        agent_runtime: &state.agent_runtime,
    }))
}

fn derive_employee_activity(input: ActivityDerivationInput<'_>) -> EmployeeActivity {
    let employee = input.employee;
    let employee_actions = input
        .actions
        .iter()
        .filter(|action| action.employee_id == employee.id)
        .collect::<Vec<_>>();
    let employee_approvals = input
        .approvals
        .iter()
        .filter(|approval| approval.employee_id == employee.id)
        .collect::<Vec<_>>();
    let employee_processes = input
        .processes
        .iter()
        .filter(|process| process.employee_id.as_deref() == Some(employee.id.as_str()))
        .collect::<Vec<_>>();
    let employee_sessions = input
        .terminal_sessions
        .iter()
        .filter(|session| session.employee_id == employee.id)
        .collect::<Vec<_>>();

    let active_terminal = active_terminal_session(employee, &employee_sessions);
    let active_terminal_session_id = if employee.status == EmployeeStatus::Stopped {
        None
    } else {
        active_terminal.map(|session| session.session_id.clone())
    };
    let historical_agent_session = if matches!(
        employee.status,
        EmployeeStatus::Blocked | EmployeeStatus::Done | EmployeeStatus::Failed
    ) {
        latest_agent_session(&employee_sessions)
    } else {
        None
    };
    let agent_session = if employee.status == EmployeeStatus::Stopped {
        None
    } else {
        active_terminal.or(historical_agent_session)
    };
    let agent = runtime_agent_for_employee(employee, agent_session, input.agent_runtime);
    let active_action = employee_actions
        .iter()
        .copied()
        .find(|action| action.status == ActionStatus::Running);
    let pending_action = employee_actions
        .iter()
        .copied()
        .find(|action| action.status == ActionStatus::PendingApproval);
    let pending_approval = employee_approvals
        .iter()
        .copied()
        .find(|approval| approval.status == ApprovalStatus::Pending);
    let active_process_ids = employee_processes
        .iter()
        .filter(|process| process.status == ManagedProcessStatus::Running)
        .map(|process| process.id.clone())
        .collect::<Vec<_>>();

    let mut blockers = Vec::new();
    let review_counts = review_counts_for_employee(employee, &mut blockers);
    let handoff_ready = handoff_ready_for_employee(
        &input.workspace_root,
        employee,
        &review_counts,
        &mut blockers,
    );
    let terminal_resolution =
        active_terminal.map(|session| activity_for_terminal_session(session, agent));
    let terminal_owner_wait = terminal_resolution.as_ref().filter(|resolution| {
        matches!(
            resolution.terminal_state,
            EmployeeTerminalActivityState::CodexWaitingApproval
                | EmployeeTerminalActivityState::CodexWaitingInstruction
        )
    });
    let underlying_action_id = active_action
        .map(|action| action.id.clone())
        .or_else(|| pending_action.map(|action| action.id.clone()))
        .or_else(|| pending_approval.and_then(|approval| approval.action_id.clone()));

    let resolution = if employee.status == EmployeeStatus::Standby {
        activity_resolution(
            EmployeeActivityStatus::Standby,
            EmployeeBehaviorState::OnStandby,
            EmployeeWorkPhase::Idle,
            EmployeeTurnOwner::None,
            None,
            EmployeeAttentionPriority::None,
            EmployeeTerminalActivityState::None,
            "On standby",
            Some("Parked in the waiting room".to_string()),
            None,
            "employee_standby",
        )
    } else if employee.status == EmployeeStatus::Stopped {
        activity_resolution(
            EmployeeActivityStatus::Stopped,
            EmployeeBehaviorState::Offline,
            EmployeeWorkPhase::Idle,
            EmployeeTurnOwner::None,
            None,
            EmployeeAttentionPriority::None,
            EmployeeTerminalActivityState::None,
            "Stopped",
            None,
            None,
            "employee_stopped",
        )
    } else if let Some(terminal_activity) = terminal_owner_wait {
        let mut terminal_activity = terminal_activity.clone();
        terminal_activity.active_action_id = underlying_action_id.clone();
        terminal_activity.activity_reason = match terminal_activity.terminal_state {
            EmployeeTerminalActivityState::CodexWaitingApproval
                if underlying_action_id.is_some() || !active_process_ids.is_empty() =>
            {
                "terminal_waiting_approval_over_active_work".to_string()
            }
            EmployeeTerminalActivityState::CodexWaitingApproval => {
                "terminal_waiting_approval".to_string()
            }
            EmployeeTerminalActivityState::CodexWaitingInstruction
                if underlying_action_id.is_some() || !active_process_ids.is_empty() =>
            {
                "terminal_waiting_instruction_over_active_work".to_string()
            }
            EmployeeTerminalActivityState::CodexWaitingInstruction => {
                "terminal_waiting_instruction".to_string()
            }
            _ => terminal_activity.activity_reason,
        };
        terminal_activity
    } else if matches!(
        employee.status,
        EmployeeStatus::Blocked | EmployeeStatus::Failed
    ) || !blockers.is_empty()
    {
        activity_resolution(
            EmployeeActivityStatus::Blocked,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::Blocked,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::BlockedNeedsHelp),
            EmployeeAttentionPriority::Urgent,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::None),
            "Blocked",
            employee.current_command.clone(),
            underlying_action_id.clone(),
            "employee_blocked",
        )
    } else if let Some(action) = active_action {
        activity_resolution(
            EmployeeActivityStatus::ActionRunning,
            EmployeeBehaviorState::AtDeskTerminal,
            EmployeeWorkPhase::ToolRunning,
            EmployeeTurnOwner::Tool,
            None,
            EmployeeAttentionPriority::None,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::None),
            "Running action",
            Some(action.title.clone()),
            Some(action.id.clone()),
            "action_running",
        )
    } else if let Some(action) = pending_action {
        activity_resolution(
            EmployeeActivityStatus::ActionPendingApproval,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::WaitingForOwner,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::NeedsAppApproval),
            EmployeeAttentionPriority::Urgent,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::None),
            "Waiting for approval",
            Some(action.title.clone()),
            Some(action.id.clone()),
            "app_action_pending_approval",
        )
    } else if let Some(approval) = pending_approval {
        activity_resolution(
            EmployeeActivityStatus::ActionPendingApproval,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::WaitingForOwner,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::NeedsAppApproval),
            EmployeeAttentionPriority::Urgent,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::None),
            "Waiting for approval",
            Some(approval.title.clone()),
            approval.action_id.clone(),
            "app_approval_pending",
        )
    } else if !active_process_ids.is_empty() {
        activity_resolution(
            EmployeeActivityStatus::ProcessRunning,
            EmployeeBehaviorState::AtDeskTerminal,
            EmployeeWorkPhase::ToolRunning,
            EmployeeTurnOwner::Tool,
            None,
            EmployeeAttentionPriority::None,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::None),
            "Running process",
            Some(format!("{} managed process(es)", active_process_ids.len())),
            None,
            "managed_process_running",
        )
    } else if let Some(terminal_activity) = terminal_resolution.as_ref() {
        terminal_activity.clone()
    } else if review_counts.changed_files > 0 {
        activity_resolution(
            EmployeeActivityStatus::ReviewNeeded,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::ReadyToReport,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::ReviewNeeded),
            EmployeeAttentionPriority::Normal,
            EmployeeTerminalActivityState::None,
            "Review needed",
            Some(format!("{} changed file(s)", review_counts.changed_files)),
            None,
            "review_changes_pending",
        )
    } else if handoff_ready {
        activity_resolution(
            EmployeeActivityStatus::HandoffReady,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::ReadyToReport,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::HandoffReady),
            EmployeeAttentionPriority::Normal,
            EmployeeTerminalActivityState::None,
            "Handoff ready",
            Some("employee branch has commits ready to apply".to_string()),
            None,
            "handoff_ready",
        )
    } else if employee.status == EmployeeStatus::Done {
        activity_resolution(
            EmployeeActivityStatus::DoneClean,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::ReadyToReport,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::ReadyToReport),
            EmployeeAttentionPriority::Normal,
            terminal_resolution
                .as_ref()
                .map(|resolution| resolution.terminal_state)
                .unwrap_or(EmployeeTerminalActivityState::Completed),
            "Done",
            Some("ready to report".to_string()),
            None,
            "done_clean",
        )
    } else {
        activity_resolution(
            EmployeeActivityStatus::Idle,
            EmployeeBehaviorState::AtDeskIdle,
            EmployeeWorkPhase::Idle,
            EmployeeTurnOwner::None,
            None,
            EmployeeAttentionPriority::None,
            EmployeeTerminalActivityState::None,
            "Idle",
            None,
            None,
            "idle",
        )
    };
    let lifecycle = lifecycle_for_employee(employee);
    let session_active_terminal = if employee.status == EmployeeStatus::Stopped {
        None
    } else {
        active_terminal
    };
    let session = runtime_session_for_employee(employee, session_active_terminal);
    let ActivityResolution {
        status,
        behavior,
        work,
        attention,
        terminal_state,
        label,
        details,
        active_action_id,
        activity_reason,
    } = resolution;

    EmployeeActivity {
        employee_id: employee.id.clone(),
        status,
        lifecycle,
        behavior,
        session,
        agent,
        work,
        attention,
        terminal_state,
        activity_reason,
        label,
        details,
        last_activity_at: last_activity_at(
            employee,
            &employee_sessions,
            &employee_actions,
            &employee_approvals,
            &employee_processes,
        ),
        active_terminal_session_id,
        active_action_id,
        active_process_ids,
        review_counts,
        blockers,
    }
}

fn lifecycle_for_employee(employee: &Employee) -> EmployeeLifecycleState {
    match employee.status {
        EmployeeStatus::Standby => EmployeeLifecycleState::Standby,
        EmployeeStatus::Stopped => EmployeeLifecycleState::Stopped,
        EmployeeStatus::Failed => EmployeeLifecycleState::Failed,
        _ => EmployeeLifecycleState::Active,
    }
}

fn runtime_session_for_employee(
    employee: &Employee,
    active_terminal: Option<&TerminalSessionRecord>,
) -> EmployeeRuntimeSession {
    if let Some(session) = active_terminal {
        return EmployeeRuntimeSession {
            kind: session_kind_for_profile(session.active_profile.unwrap_or(session.profile)),
            state: EmployeeSessionState::Open,
        };
    }

    if employee.status == EmployeeStatus::Starting {
        return EmployeeRuntimeSession {
            kind: session_kind_for_command(employee.current_command.as_deref()),
            state: EmployeeSessionState::Starting,
        };
    }

    if employee.terminal_session_id.is_some() {
        return EmployeeRuntimeSession {
            kind: session_kind_for_command(employee.current_command.as_deref()),
            state: EmployeeSessionState::Exited,
        };
    }

    EmployeeRuntimeSession {
        kind: EmployeeSessionKind::None,
        state: EmployeeSessionState::Closed,
    }
}

fn latest_agent_session<'a>(
    sessions: &[&'a TerminalSessionRecord],
) -> Option<&'a TerminalSessionRecord> {
    sessions
        .iter()
        .copied()
        .filter(|session| {
            session.profile == TerminalLaunchProfile::Codex
                || session.active_profile == Some(TerminalLaunchProfile::Codex)
        })
        .max_by_key(|session| session.started_at)
}

fn runtime_agent_for_employee(
    employee: &Employee,
    session: Option<&TerminalSessionRecord>,
    agent_runtime: &AgentRuntimeStore,
) -> AgentRuntimeSnapshot {
    if let Some(session) = session {
        if let Some(runtime) = agent_runtime.snapshot(&session.session_id) {
            return runtime;
        }
    }

    let kind = agent_kind_for_command(employee.current_command.as_deref());
    if kind != AgentKind::None && employee.status == EmployeeStatus::Starting {
        return AgentRuntimeSnapshot::with_state(
            kind,
            AgentRuntimeState::Starting,
            Some(employee.updated_at),
        );
    }

    AgentRuntimeSnapshot::none()
}

fn activity_for_terminal_session(
    session: &TerminalSessionRecord,
    agent: AgentRuntimeSnapshot,
) -> ActivityResolution {
    match agent.state {
        AgentRuntimeState::Starting => activity_resolution(
            EmployeeActivityStatus::CodexStarting,
            EmployeeBehaviorState::AtDeskTerminal,
            EmployeeWorkPhase::AgentStarting,
            EmployeeTurnOwner::None,
            None,
            EmployeeAttentionPriority::None,
            EmployeeTerminalActivityState::CodexStarting,
            "Codex starting",
            Some(session.cwd.clone()),
            None,
            "terminal_agent_starting",
        ),
        AgentRuntimeState::WaitingPrompt => activity_resolution(
            EmployeeActivityStatus::CodexWaitingInstruction,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::WaitingForOwner,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::NeedsInstruction),
            EmployeeAttentionPriority::Normal,
            EmployeeTerminalActivityState::CodexWaitingInstruction,
            "Awaiting prompt",
            Some(session.cwd.clone()),
            None,
            "terminal_waiting_instruction",
        ),
        AgentRuntimeState::Failed => activity_resolution(
            EmployeeActivityStatus::Blocked,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::Blocked,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::BlockedNeedsHelp),
            EmployeeAttentionPriority::Urgent,
            EmployeeTerminalActivityState::Failed,
            "Blocked",
            Some(session.cwd.clone()),
            None,
            "terminal_agent_failed",
        ),
        AgentRuntimeState::WaitingApproval => activity_resolution(
            EmployeeActivityStatus::CodexWaitingApproval,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::WaitingForOwner,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::NeedsTerminalApproval),
            EmployeeAttentionPriority::Urgent,
            EmployeeTerminalActivityState::CodexWaitingApproval,
            "Terminal approval required",
            Some(session.cwd.clone()),
            None,
            "terminal_waiting_approval",
        ),
        AgentRuntimeState::Completed => activity_resolution(
            EmployeeActivityStatus::DoneClean,
            EmployeeBehaviorState::WaitingAtOwner,
            EmployeeWorkPhase::ReadyToReport,
            EmployeeTurnOwner::Owner,
            Some(EmployeeAttentionReason::ReadyToReport),
            EmployeeAttentionPriority::Normal,
            EmployeeTerminalActivityState::Completed,
            "Done",
            Some(session.cwd.clone()),
            None,
            "terminal_agent_completed",
        ),
        _ if agent.kind == AgentKind::Codex => activity_resolution(
            EmployeeActivityStatus::CodexRunning,
            EmployeeBehaviorState::AtDeskWorking,
            EmployeeWorkPhase::AgentWorking,
            EmployeeTurnOwner::Agent,
            None,
            EmployeeAttentionPriority::None,
            EmployeeTerminalActivityState::CodexRunning,
            "Codex running",
            Some(session.cwd.clone()),
            None,
            "terminal_agent_working",
        ),
        _ => match session.active_profile.unwrap_or(session.profile) {
            TerminalLaunchProfile::Shell => activity_resolution(
                EmployeeActivityStatus::ShellRunning,
                EmployeeBehaviorState::AtDeskTerminal,
                EmployeeWorkPhase::ShellOpen,
                EmployeeTurnOwner::None,
                None,
                EmployeeAttentionPriority::None,
                EmployeeTerminalActivityState::ShellRunning,
                "Shell running",
                Some(session.cwd.clone()),
                None,
                "terminal_shell_open",
            ),
            TerminalLaunchProfile::Codex => activity_resolution(
                EmployeeActivityStatus::CodexRunning,
                EmployeeBehaviorState::AtDeskWorking,
                EmployeeWorkPhase::AgentWorking,
                EmployeeTurnOwner::Agent,
                None,
                EmployeeAttentionPriority::None,
                EmployeeTerminalActivityState::CodexRunning,
                "Codex running",
                Some(session.cwd.clone()),
                None,
                "terminal_agent_working",
            ),
        },
    }
}

fn session_kind_for_profile(profile: TerminalLaunchProfile) -> EmployeeSessionKind {
    match profile {
        TerminalLaunchProfile::Shell => EmployeeSessionKind::Shell,
        TerminalLaunchProfile::Codex => EmployeeSessionKind::Codex,
    }
}

fn session_kind_for_command(command: Option<&str>) -> EmployeeSessionKind {
    match command {
        Some("codex") => EmployeeSessionKind::Codex,
        Some("shell") => EmployeeSessionKind::Shell,
        Some("claude") => EmployeeSessionKind::Claude,
        _ => EmployeeSessionKind::None,
    }
}

#[allow(clippy::too_many_arguments)]
fn activity_resolution(
    status: EmployeeActivityStatus,
    behavior: EmployeeBehaviorState,
    phase: EmployeeWorkPhase,
    turn_owner: EmployeeTurnOwner,
    reason: Option<EmployeeAttentionReason>,
    priority: EmployeeAttentionPriority,
    terminal_state: EmployeeTerminalActivityState,
    label: &str,
    details: Option<String>,
    active_action_id: Option<String>,
    activity_reason: &str,
) -> ActivityResolution {
    let (work, attention) = runtime(phase, turn_owner, reason, priority);
    ActivityResolution {
        status,
        behavior,
        work,
        attention,
        terminal_state,
        label: label.to_string(),
        details,
        active_action_id,
        activity_reason: activity_reason.to_string(),
    }
}

fn runtime(
    phase: EmployeeWorkPhase,
    turn_owner: EmployeeTurnOwner,
    reason: Option<EmployeeAttentionReason>,
    priority: EmployeeAttentionPriority,
) -> (EmployeeWorkState, EmployeeAttention) {
    (
        EmployeeWorkState { phase, turn_owner },
        EmployeeAttention {
            required: reason.is_some(),
            reason,
            priority,
        },
    )
}

fn active_terminal_session<'a>(
    employee: &Employee,
    sessions: &'a [&TerminalSessionRecord],
) -> Option<&'a TerminalSessionRecord> {
    if let Some(session_id) = employee.terminal_session_id.as_deref() {
        if let Some(session) = sessions.iter().copied().find(|session| {
            session.session_id == session_id && session.status == TerminalSessionStatus::Running
        }) {
            return Some(session);
        }
    }
    sessions
        .iter()
        .copied()
        .filter(|session| session.status == TerminalSessionStatus::Running)
        .max_by_key(|session| session.started_at)
}

fn review_counts_for_employee(
    employee: &Employee,
    blockers: &mut Vec<String>,
) -> EmployeeReviewCounts {
    let Some(worktree_path) = employee.worktree_path.as_deref() else {
        return EmployeeReviewCounts::default();
    };
    let worktree = PathBuf::from(worktree_path);
    if !worktree.is_dir() {
        blockers.push("employee worktree path is missing".to_string());
        return EmployeeReviewCounts::default();
    }
    match run_git(&worktree, &["status", "--porcelain"]) {
        Ok(output) => {
            let status = parse_status_lines(&output);
            let conflicted = conflicted_files_from_status(&status);
            if !conflicted.is_empty() {
                blockers.push(format!(
                    "worktree has {} conflicted file(s)",
                    conflicted.len()
                ));
            }
            review_counts_from_status(&status)
        }
        Err(error) => {
            blockers.push(format!("worktree status unavailable: {error}"));
            EmployeeReviewCounts::default()
        }
    }
}

fn review_counts_from_status(status: &[String]) -> EmployeeReviewCounts {
    let mut changed_paths = HashSet::new();
    let mut staged_files = 0;
    let mut untracked_files = 0;

    for line in status {
        if line.starts_with("?? ") {
            untracked_files += 1;
            changed_paths.insert(status_path(line));
            continue;
        }
        if line
            .as_bytes()
            .first()
            .is_some_and(|staged| *staged != b' ' && *staged != b'?')
        {
            staged_files += 1;
        }
        changed_paths.insert(status_path(line));
    }

    EmployeeReviewCounts {
        changed_files: changed_paths.len(),
        staged_files,
        untracked_files,
    }
}

fn status_path(line: &str) -> String {
    if line.len() < 4 {
        return line.to_string();
    }
    let path = &line[3..];
    path.split_once(" -> ")
        .map(|(_, to)| to.to_string())
        .unwrap_or_else(|| path.to_string())
}

fn conflicted_files_from_status(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter(|line| status_line_is_conflicted(line))
        .map(|line| status_path(line))
        .collect()
}

fn status_line_is_conflicted(line: &str) -> bool {
    let Some(staged) = line.as_bytes().first().copied() else {
        return false;
    };
    let Some(unstaged) = line.as_bytes().get(1).copied() else {
        return false;
    };
    matches!(
        (staged, unstaged),
        (b'D', b'D')
            | (b'A', b'U')
            | (b'U', b'D')
            | (b'U', b'A')
            | (b'D', b'U')
            | (b'A', b'A')
            | (b'U', b'U')
    )
}

fn handoff_ready_for_employee(
    workspace_root: &Path,
    employee: &Employee,
    review_counts: &EmployeeReviewCounts,
    blockers: &mut Vec<String>,
) -> bool {
    if review_counts.changed_files > 0 {
        return false;
    }
    let Some(worktree_path) = employee.worktree_path.as_deref() else {
        return false;
    };
    let worktree = PathBuf::from(worktree_path);
    if !worktree.is_dir() {
        return false;
    }
    if current_branch(workspace_root).ok().flatten().is_none() {
        return false;
    }
    if run_git(workspace_root, &["status", "--porcelain"])
        .map(|output| !parse_status_lines(&output).is_empty())
        .unwrap_or(true)
    {
        return false;
    }
    match commits_between_count(workspace_root, &worktree) {
        Ok(count) => count > 0,
        Err(error) => {
            blockers.push(format!("handoff status unavailable: {error}"));
            false
        }
    }
}

fn commits_between_count(workspace_root: &Path, worktree: &Path) -> Result<usize, String> {
    let main_head = non_empty_trimmed(run_git(workspace_root, &["rev-parse", "--verify", "HEAD"])?)
        .ok_or_else(|| "main workspace HEAD could not be resolved".to_string())?;
    let employee_head =
        non_empty_trimmed(run_git(worktree, &["rev-parse", "--verify", "HEAD"])?)
            .ok_or_else(|| "employee worktree HEAD could not be resolved".to_string())?;
    let range = format!("{main_head}..{employee_head}");
    let count = run_git(workspace_root, &["rev-list", "--count", &range])?;
    non_empty_trimmed(count)
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| "handoff commit count could not be parsed".to_string())
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn last_activity_at(
    employee: &Employee,
    sessions: &[&TerminalSessionRecord],
    actions: &[&Action],
    approvals: &[&ApprovalRequest],
    processes: &[&ManagedProcess],
) -> Option<u64> {
    let mut timestamps = vec![employee.updated_at];
    timestamps.extend(sessions.iter().flat_map(|session| {
        [
            Some(session.started_at),
            session.ended_at,
            session.stopped_at,
            session.last_output_at,
            session.last_prompt_submitted_at,
            session.last_prompt_ready_at,
            session.last_approval_prompt_at,
        ]
        .into_iter()
        .flatten()
    }));
    timestamps.extend(actions.iter().map(|action| action.updated_at));
    timestamps.extend(
        approvals
            .iter()
            .map(|approval| approval.resolved_at.unwrap_or(approval.created_at)),
    );
    timestamps.extend(processes.iter().map(|process| process.updated_at));
    timestamps.into_iter().max()
}

#[cfg(test)]
mod tests {
    use std::{
        fs as std_fs,
        path::Path,
        process::{Command, Stdio},
        sync::Arc,
    };

    use parking_lot::RwLock;

    use super::*;
    use crate::{
        actions::{ActionKind, ActionManager, ActionStatus},
        approvals::{ApprovalKind, ApprovalManager, ApprovalStatus},
        employees::{EmployeeManager, EmployeeRole, EmployeeStatus},
        processes::{ManagedProcessStatus, ProcessManager},
        terminal::TerminalSessionStore,
    };

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("slavey-activity-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn test_state(workspace_root: PathBuf) -> AppState {
        AppState {
            workspace_root: Arc::new(RwLock::new(workspace_root.clone())),
            employees: EmployeeManager::default(),
            terminal: crate::terminal::TerminalManager::default(),
            terminal_sessions: TerminalSessionStore::default(),
            agent_runtime: AgentRuntimeStore::default(),
            persistence: crate::persistence::PersistenceManager::new(
                workspace_root.join("state.json"),
                None,
            ),
            approvals: ApprovalManager::default(),
            actions: ActionManager::default(),
            processes: ProcessManager::default(),
        }
    }

    fn create_employee(state: &AppState) -> Employee {
        state.employees.create(
            "Ada".to_string(),
            EmployeeRole::General,
            state.workspace_root(),
        )
    }

    fn activity(state: &AppState, employee_id: &str) -> EmployeeActivity {
        employee_activity_for_state(state, employee_id).unwrap()
    }

    fn sync_agent_runtime(state: &AppState, session_id: &str) {
        let session = state.terminal_sessions.get(session_id).unwrap();
        state.agent_runtime.sync_from_terminal_session(&session);
    }

    #[test]
    fn idle_employee_activity_is_idle() {
        let root = test_root("idle");
        let state = test_state(root);
        let employee = create_employee(&state);

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Idle);
        assert_eq!(activity.lifecycle, EmployeeLifecycleState::Active);
        assert_eq!(activity.behavior, EmployeeBehaviorState::AtDeskIdle);
        assert_eq!(activity.terminal_state, EmployeeTerminalActivityState::None);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::Idle);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::None);
        assert!(!activity.attention.required);
        assert_eq!(activity.agent.kind, AgentKind::None);
        assert_eq!(activity.agent.state, AgentRuntimeState::NotActive);
        assert_eq!(activity.label, "Idle");
        assert_eq!(activity.active_terminal_session_id, None);
    }

    #[test]
    fn shell_running_activity_uses_structured_terminal_session() {
        let root = test_root("shell");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Shell,
            root.to_string_lossy().to_string(),
        );
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("shell".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::ShellRunning);
        assert_eq!(activity.behavior, EmployeeBehaviorState::AtDeskTerminal);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::ShellRunning
        );
        assert_eq!(activity.session.kind, EmployeeSessionKind::Shell);
        assert_eq!(activity.session.state, EmployeeSessionState::Open);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::ShellOpen);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::None);
        assert!(!activity.attention.required);
        assert_eq!(
            activity.active_terminal_session_id.as_deref(),
            Some("session-1")
        );
    }

    #[test]
    fn codex_running_activity_uses_terminal_profile() {
        let root = test_root("codex");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::CodexRunning);
        assert_eq!(activity.behavior, EmployeeBehaviorState::AtDeskWorking);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexRunning
        );
        assert_eq!(activity.session.kind, EmployeeSessionKind::Codex);
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::Thinking);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::AgentWorking);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Agent);
        assert!(!activity.attention.required);
    }

    #[test]
    fn codex_without_submitted_prompt_is_starting_not_working() {
        let root = test_root("codex-starting");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });
        sync_agent_runtime(&state, &session.session_id);

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::CodexStarting);
        assert_eq!(activity.behavior, EmployeeBehaviorState::AtDeskTerminal);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexStarting
        );
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::Starting);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::AgentStarting);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::None);
        assert!(!activity.attention.required);
    }

    #[test]
    fn codex_prompt_ready_activity_requires_owner_instruction() {
        let root = test_root("codex-waiting");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .record_output(&session.session_id, "\r\n› ");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingInstruction
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexWaitingInstruction
        );
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::WaitingPrompt);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::WaitingForOwner);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsInstruction)
        );
    }

    #[test]
    fn codex_terminal_approval_prompt_requires_owner_approval() {
        let root = test_root("codex-terminal-approval");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        state
            .terminal_sessions
            .record_output(&session.session_id, "Allow command to run?\n› Yes / No");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingApproval
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexWaitingApproval
        );
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::WaitingApproval);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::WaitingForOwner);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(activity.active_action_id, None);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsTerminalApproval)
        );
    }

    #[test]
    fn standby_activity_parks_employee_even_with_running_terminal() {
        let root = test_root("standby");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Shell,
            root.to_string_lossy().to_string(),
        );
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Standby;
            employee.current_command = Some("shell".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Standby);
        assert_eq!(activity.behavior, EmployeeBehaviorState::OnStandby);
        assert_eq!(
            activity.active_terminal_session_id.as_deref(),
            Some("session-1")
        );
    }

    #[test]
    fn stopped_terminal_session_activity_is_not_running() {
        let root = test_root("stopped-session");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Shell,
            root.to_string_lossy().to_string(),
        );
        state.terminal_sessions.stop(&session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Stopped;
            employee.terminal_session_id = Some(session.session_id.clone());
            employee.current_command = None;
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Stopped);
        assert_eq!(activity.behavior, EmployeeBehaviorState::Offline);
        assert_eq!(activity.active_terminal_session_id, None);
        assert_eq!(activity.session.state, EmployeeSessionState::Exited);
    }

    #[test]
    fn stopped_employee_ignores_stale_running_terminal_session() {
        let root = test_root("stopped-stale-running-session");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .record_output(&session.session_id, "Allow command to run?\n› Yes / No");
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Stopped;
            employee.terminal_session_id = Some(session.session_id.clone());
            employee.current_command = None;
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Stopped);
        assert_eq!(activity.behavior, EmployeeBehaviorState::Offline);
        assert_eq!(activity.active_terminal_session_id, None);
        assert_eq!(activity.session.state, EmployeeSessionState::Exited);
        assert_eq!(activity.agent.kind, AgentKind::None);
        assert_eq!(activity.agent.state, AgentRuntimeState::NotActive);
        assert!(!activity.attention.required);
    }

    #[test]
    fn stopped_employee_ignores_historical_failed_agent_session() {
        let root = test_root("stopped-failed-agent");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state.terminal_sessions.finish(&session.session_id, 1);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Stopped;
            employee.terminal_session_id = Some(session.session_id.clone());
            employee.current_command = None;
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Stopped);
        assert_eq!(activity.agent.kind, AgentKind::None);
        assert_eq!(activity.agent.state, AgentRuntimeState::NotActive);
    }

    #[test]
    fn pending_action_activity_reports_approval_wait() {
        let root = test_root("pending-action");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });
        let action = sample_action(&employee.id, ActionStatus::PendingApproval);
        state.actions.replace_all(vec![action.clone()]);

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::ActionPendingApproval
        );
        assert_eq!(activity.work.phase, EmployeeWorkPhase::WaitingForOwner);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsAppApproval)
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexRunning
        );
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::Thinking);
        assert_eq!(
            activity.active_action_id.as_deref(),
            Some(action.id.as_str())
        );
    }

    #[test]
    fn codex_terminal_approval_takes_precedence_over_pending_action_approval() {
        let root = test_root("terminal-approval-precedence");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        state
            .terminal_sessions
            .record_output(&session.session_id, "Allow command to run?\n› Yes / No");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });
        let action = sample_action(&employee.id, ActionStatus::PendingApproval);
        let action_id = action.id.clone();
        let approval = ApprovalRequest {
            id: "approval-1".to_string(),
            employee_id: employee.id.clone(),
            action_id: Some(action_id.clone()),
            kind: ApprovalKind::ShellCommand,
            title: "Approve command".to_string(),
            description: "Approve command".to_string(),
            command: Some("pwd".to_string()),
            path: None,
            cwd: None,
            status: ApprovalStatus::Pending,
            created_at: 2,
            resolved_at: None,
        };
        state.actions.replace_all(vec![action]);
        state.approvals.replace_all(vec![approval]);

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingApproval
        );
        assert_eq!(
            activity.active_action_id.as_deref(),
            Some(action_id.as_str())
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexWaitingApproval
        );
        assert_eq!(
            activity.activity_reason,
            "terminal_waiting_approval_over_active_work"
        );
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::WaitingApproval);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsTerminalApproval)
        );
    }

    #[test]
    fn codex_terminal_approval_over_running_action_preserves_work_context() {
        let root = test_root("terminal-approval-active-action");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        state
            .terminal_sessions
            .record_output(&session.session_id, "Allow command to run?\n› Yes / No");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });
        let action = sample_action(&employee.id, ActionStatus::Running);
        let action_id = action.id.clone();
        state.actions.replace_all(vec![action]);

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingApproval
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::WaitingForOwner);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsTerminalApproval)
        );
        assert_eq!(
            activity.active_action_id.as_deref(),
            Some(action_id.as_str())
        );
        assert_eq!(
            activity.activity_reason,
            "terminal_waiting_approval_over_active_work"
        );
    }

    #[test]
    fn codex_terminal_approval_takes_precedence_over_worktree_blocker() {
        let root = test_root("terminal-approval-blocker");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .mark_prompt_submitted(&session.session_id, "\r");
        state
            .terminal_sessions
            .record_output(&session.session_id, "Allow command to run?\n› Yes / No");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
            employee.worktree_path =
                Some(root.join("missing-worktree").to_string_lossy().to_string());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingApproval
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsTerminalApproval)
        );
        assert_eq!(
            activity.terminal_state,
            EmployeeTerminalActivityState::CodexWaitingApproval
        );
        assert!(!activity.blockers.is_empty());
    }

    #[test]
    fn codex_instruction_wait_over_running_process_preserves_process_context() {
        let root = test_root("terminal-instruction-active-process");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state
            .terminal_sessions
            .record_output(&session.session_id, "\r\n› ");
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });
        let processes = vec![sample_process(&employee.id)];
        let terminal_sessions = vec![state.terminal_sessions.get(&session.session_id).unwrap()];

        let activity = derive_employee_activity(ActivityDerivationInput {
            employee: &employee,
            workspace_root: state.workspace_root(),
            terminal_sessions: &terminal_sessions,
            actions: &[],
            approvals: &[],
            processes: &processes,
            agent_runtime: &state.agent_runtime,
        });

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingInstruction
        );
        assert_eq!(activity.behavior, EmployeeBehaviorState::WaitingAtOwner);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::WaitingForOwner);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsInstruction)
        );
        assert_eq!(activity.active_process_ids, vec!["process-1".to_string()]);
        assert_eq!(
            activity.activity_reason,
            "terminal_waiting_instruction_over_active_work"
        );
    }

    #[test]
    fn pending_approval_activity_reports_approval_wait() {
        let root = test_root("pending-approval");
        let state = test_state(root);
        let employee = create_employee(&state);
        let approval = ApprovalRequest {
            id: "approval-1".to_string(),
            employee_id: employee.id.clone(),
            action_id: Some("action-1".to_string()),
            kind: ApprovalKind::ShellCommand,
            title: "Approve command".to_string(),
            description: "Approve command".to_string(),
            command: Some("pwd".to_string()),
            path: None,
            cwd: None,
            status: ApprovalStatus::Pending,
            created_at: 2,
            resolved_at: None,
        };
        state.approvals.replace_all(vec![approval]);

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::ActionPendingApproval
        );
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::NeedsAppApproval)
        );
        assert_eq!(activity.active_action_id.as_deref(), Some("action-1"));
    }

    #[test]
    fn running_managed_process_activity_reports_process_ids() {
        let root = test_root("process");
        let state = test_state(root);
        let employee = create_employee(&state);
        let processes = vec![sample_process(&employee.id)];

        let activity = derive_employee_activity(ActivityDerivationInput {
            employee: &employee,
            workspace_root: state.workspace_root(),
            terminal_sessions: &[],
            actions: &[],
            approvals: &[],
            processes: &processes,
            agent_runtime: &state.agent_runtime,
        });

        assert_eq!(activity.status, EmployeeActivityStatus::ProcessRunning);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::ToolRunning);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Tool);
        assert_eq!(activity.active_process_ids, vec!["process-1".to_string()]);
    }

    #[test]
    fn review_needed_activity_counts_worktree_status() {
        if !git_available() {
            return;
        }
        let root = test_root("review");
        init_git_repo(&root);
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        state.employees.update(&employee.id, |employee| {
            employee.worktree_path = Some(root.to_string_lossy().to_string());
            employee.cwd = root.to_string_lossy().to_string();
        });
        std_fs::write(root.join("dirty.txt"), "dirty\n").unwrap();

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::ReviewNeeded);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::ReadyToReport);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::ReviewNeeded)
        );
        assert_eq!(activity.review_counts.changed_files, 1);
        assert_eq!(activity.review_counts.untracked_files, 1);
    }

    #[test]
    fn done_clean_activity_requires_owner_report() {
        let root = test_root("done-clean");
        let state = test_state(root.clone());
        let employee = create_employee(&state);
        let session = state.terminal_sessions.create(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        state.terminal_sessions.finish(&session.session_id, 0);
        sync_agent_runtime(&state, &session.session_id);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Done;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::DoneClean);
        assert_eq!(activity.agent.kind, AgentKind::Codex);
        assert_eq!(activity.agent.state, AgentRuntimeState::Completed);
        assert_eq!(activity.work.phase, EmployeeWorkPhase::ReadyToReport);
        assert_eq!(activity.work.turn_owner, EmployeeTurnOwner::Owner);
        assert_eq!(
            activity.attention.reason,
            Some(EmployeeAttentionReason::ReadyToReport)
        );
    }

    #[test]
    fn workspace_switch_leaves_no_employee_activities() {
        let root = test_root("switch-root");
        let next = test_root("switch-next");
        let state = test_state(root);
        create_employee(&state);

        crate::workspace::workspace_set_root_impl(&state, next.to_str().unwrap()).unwrap();

        assert!(employee_activity_list_impl(&state).is_empty());
    }

    #[test]
    fn review_counts_parse_staged_untracked_and_renames() {
        let status = parse_status_lines("A  staged.txt\n?? scratch.txt\nR  old.rs -> new.rs\n");

        let counts = review_counts_from_status(&status);

        assert_eq!(counts.changed_files, 3);
        assert_eq!(counts.staged_files, 2);
        assert_eq!(counts.untracked_files, 1);
    }

    fn sample_action(employee_id: &str, status: ActionStatus) -> Action {
        Action {
            id: "action-1".to_string(),
            employee_id: employee_id.to_string(),
            kind: ActionKind::ShellCommand,
            title: "Inspect workspace".to_string(),
            description: "Inspect workspace".to_string(),
            cwd: None,
            command: Some("pwd".to_string()),
            path: None,
            contents: None,
            source: crate::actions::ActionSource::User,
            timeout_secs: 120,
            output_cap_bytes: crate::actions::MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
            created_at: 1,
            updated_at: 2,
            started_at: None,
            finished_at: None,
        }
    }

    fn sample_process(employee_id: &str) -> ManagedProcess {
        ManagedProcess {
            id: "process-1".to_string(),
            employee_id: Some(employee_id.to_string()),
            title: "Long process".to_string(),
            command: "sleep 999".to_string(),
            cwd: "/tmp".to_string(),
            status: ManagedProcessStatus::Running,
            exit_code: None,
            created_at: 1,
            updated_at: 2,
        }
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn init_git_repo(root: &Path) {
        run_git_test(root, &["init"]);
        run_git_test(root, &["config", "user.name", "Slavey Test"]);
        run_git_test(root, &["config", "user.email", "slavey@example.test"]);
    }

    fn run_git_test(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "git command failed: {args:?}");
    }
}
