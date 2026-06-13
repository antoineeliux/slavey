use std::{collections::BTreeMap, path::Path};

use serde::Serialize;
use tauri::State;

use crate::{
    actions::{Action, ActionFailureReason, ActionKind, ActionSource, ActionStatus},
    activity::{
        employee_activity_list_impl, EmployeeActivity, EmployeeActivityStatus, EmployeeAttention,
        EmployeeBehaviorState, EmployeeLifecycleState, EmployeeReviewCounts,
        EmployeeRuntimeSession, EmployeeTerminalActivityState, EmployeeWorkState,
    },
    activity_contract::EmployeeActivityContract,
    approvals::{ApprovalKind, ApprovalRequest, ApprovalStatus},
    events::now_ms,
    persistence::AppSettings,
    processes::{ManagedProcess, ManagedProcessStatus},
    terminal::{
        codex_cli_status_impl, codex_program_from_settings, AgentRuntimeSnapshot, CodexCliStatus,
        TerminalLaunchProfile, TerminalSessionRecord, TerminalSessionRuntime,
        TerminalSessionStatus, TerminalStopReason, TerminalTurnState, TerminalTurnTransitionReason,
    },
    workspace::{repo_health_for_workspace, RepoHealth},
    AppState,
};

mod redaction;

use self::redaction::{redact_diagnostic_string, redact_path_string};

const MAX_EXPORT_ITEMS: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub workspace_selected: bool,
    pub workspace_path: Option<String>,
    pub workspace_exists: bool,
    pub workspace_is_git_repo: bool,
    pub git_user_name_configured: bool,
    pub git_user_email_configured: bool,
    pub codex_cli_available: bool,
    pub codex_cli_version: Option<String>,
    pub codex_cli_message: String,
    pub counts: DiagnosticsCounts,
    pub health_flags: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCounts {
    pub employees: usize,
    pub active_terminal_sessions: usize,
    pub recent_terminal_sessions: usize,
    pub actions_by_status: BTreeMap<String, usize>,
    pub approvals_by_status: BTreeMap<String, usize>,
    pub managed_processes_by_status: BTreeMap<String, usize>,
    pub recent_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportBundle {
    pub generated_at: u64,
    pub summary: DiagnosticsSummary,
    pub settings: AppSettings,
    pub workspace: DiagnosticsWorkspaceInfo,
    pub employee_activities: Vec<DiagnosticsEmployeeActivityMetadata>,
    pub actions: Vec<DiagnosticsActionMetadata>,
    pub approvals: Vec<DiagnosticsApprovalMetadata>,
    pub terminal_sessions: Vec<DiagnosticsTerminalSessionMetadata>,
    pub processes: Vec<DiagnosticsProcessMetadata>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsWorkspaceInfo {
    pub workspace_path: Option<String>,
    pub workspace_exists: bool,
    pub is_git_repo: bool,
    pub repo_root: Option<String>,
    pub current_branch: Option<String>,
    pub dirty: bool,
    pub git_user_name_configured: bool,
    pub git_user_email_configured: bool,
    pub worktree_supported: bool,
    pub worktree_blockers: Vec<String>,
    pub handoff_blockers: Vec<String>,
    pub switch_blockers: Vec<String>,
    pub codex_cli_status: CodexCliStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsActionMetadata {
    pub id: String,
    pub employee_id: String,
    pub kind: ActionKind,
    pub title: String,
    pub description: String,
    pub cwd: Option<String>,
    pub path: Option<String>,
    pub source: ActionSource,
    pub timeout_secs: u64,
    pub output_cap_bytes: usize,
    pub approval_id: Option<String>,
    pub status: ActionStatus,
    pub error: Option<String>,
    pub failure_reason: Option<ActionFailureReason>,
    pub cancellation_reason: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsApprovalMetadata {
    pub id: String,
    pub employee_id: String,
    pub action_id: Option<String>,
    pub kind: ApprovalKind,
    pub title: String,
    pub description: String,
    pub path: Option<String>,
    pub cwd: Option<String>,
    pub status: ApprovalStatus,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEmployeeActivityMetadata {
    pub employee_id: String,
    pub status: EmployeeActivityStatus,
    pub lifecycle: EmployeeLifecycleState,
    pub behavior: EmployeeBehaviorState,
    pub terminal_state: EmployeeTerminalActivityState,
    pub activity_reason: String,
    pub session: EmployeeRuntimeSession,
    pub agent: AgentRuntimeSnapshot,
    pub work: EmployeeWorkState,
    pub attention: EmployeeAttention,
    pub contract: EmployeeActivityContract,
    pub active_terminal_session_id: Option<String>,
    pub active_action_id: Option<String>,
    pub active_process_ids: Vec<String>,
    pub review_counts: EmployeeReviewCounts,
    pub blockers: Vec<String>,
    pub last_activity_at: Option<u64>,
    pub trace: DiagnosticsEmployeeActivityTrace,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEmployeeActivityTrace {
    pub employee_id: String,
    pub legacy: DiagnosticsLegacyActivityTrace,
    pub active_terminal_session_id: Option<String>,
    pub terminal: Option<DiagnosticsTerminalEvidenceTrace>,
    pub agent_runtime: AgentRuntimeSnapshot,
    pub contract: EmployeeActivityContract,
    pub active_action_id: Option<String>,
    pub active_process_ids: Vec<String>,
    pub active_process_count: usize,
    pub review_counts: EmployeeReviewCounts,
    pub blockers: Vec<String>,
    pub last_activity_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsLegacyActivityTrace {
    pub status: EmployeeActivityStatus,
    pub lifecycle: EmployeeLifecycleState,
    pub behavior: EmployeeBehaviorState,
    pub terminal_state: EmployeeTerminalActivityState,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsTerminalEvidenceTrace {
    pub session_id: String,
    pub employee_id: String,
    pub status: TerminalSessionStatus,
    pub runtime: TerminalSessionRuntime,
    pub profile: TerminalLaunchProfile,
    pub active_profile: Option<TerminalLaunchProfile>,
    pub turn_state: TerminalTurnState,
    pub last_prompt_submitted_at: Option<u64>,
    pub last_prompt_ready_at: Option<u64>,
    pub last_approval_prompt_at: Option<u64>,
    pub last_transition_reason: Option<TerminalTurnTransitionReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsTerminalSessionMetadata {
    pub session_id: String,
    pub employee_id: String,
    pub profile: TerminalLaunchProfile,
    pub runtime: TerminalSessionRuntime,
    pub active_profile: Option<TerminalLaunchProfile>,
    pub cwd: String,
    pub current_cwd: Option<String>,
    pub status: TerminalSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub stopped_at: Option<u64>,
    pub stop_reason: Option<TerminalStopReason>,
    pub label: String,
    pub last_output_at: Option<u64>,
    pub last_prompt_submitted_at: Option<u64>,
    pub last_prompt_ready_at: Option<u64>,
    pub last_approval_prompt_at: Option<u64>,
    pub turn_state: TerminalTurnState,
    pub last_transition_reason: Option<TerminalTurnTransitionReason>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsProcessMetadata {
    pub id: String,
    pub employee_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub status: ManagedProcessStatus,
    pub exit_code: Option<i32>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[tauri::command]
pub fn diagnostics_summary(state: State<'_, AppState>) -> DiagnosticsSummary {
    diagnostics_summary_impl(&state)
}

#[tauri::command]
pub fn diagnostics_export_bundle(state: State<'_, AppState>) -> DiagnosticsExportBundle {
    diagnostics_export_bundle_impl(&state)
}

fn diagnostics_summary_impl(state: &AppState) -> DiagnosticsSummary {
    let workspace_root = state.workspace_root();
    let settings = state.persistence.settings();
    let codex_program = codex_program_from_settings(&settings);
    let codex_status = codex_cli_status_impl(&codex_program);
    let repo_health = repo_health_for_workspace(&workspace_root, codex_status.clone());
    let terminal_sessions = state.terminal_sessions.list(None);
    let actions = state.actions.list(None);
    let approvals = state.approvals.list(None);
    let processes = state.processes.list();
    let counts = diagnostics_counts(
        state.employees.list().len(),
        &terminal_sessions,
        &actions,
        &approvals,
        &processes,
        state.persistence.recent_files_count(),
    );
    let switch_blockers = switch_blockers_from_state(state);
    let (health_flags, blockers) = diagnostics_health(&repo_health, &counts, &switch_blockers);

    DiagnosticsSummary {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        workspace_selected: !workspace_root.as_os_str().is_empty(),
        workspace_path: Some(redact_path_string(&workspace_root.to_string_lossy())),
        workspace_exists: repo_health.is_existing_directory,
        workspace_is_git_repo: repo_health.is_git_repo,
        git_user_name_configured: repo_health.git_user_name_configured,
        git_user_email_configured: repo_health.git_user_email_configured,
        codex_cli_available: repo_health.codex_cli_status.available,
        codex_cli_version: repo_health
            .codex_cli_status
            .version
            .as_deref()
            .map(redact_diagnostic_string),
        codex_cli_message: redact_diagnostic_string(&repo_health.codex_cli_status.message),
        counts,
        health_flags,
        blockers,
    }
}

fn diagnostics_export_bundle_impl(state: &AppState) -> DiagnosticsExportBundle {
    let workspace_root = state.workspace_root();
    let settings = state.persistence.settings();
    let codex_program = codex_program_from_settings(&settings);
    let repo_health =
        repo_health_for_workspace(&workspace_root, codex_cli_status_impl(&codex_program));
    let terminal_session_records = state.terminal_sessions.list(None);
    let terminal_sessions_by_id = terminal_session_records
        .iter()
        .map(|session| (session.session_id.clone(), session.clone()))
        .collect::<BTreeMap<_, _>>();
    let employee_activities = recent_items(employee_activity_list_impl(state), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(|activity| sanitize_employee_activity_metadata(activity, &terminal_sessions_by_id))
        .collect();
    let actions = recent_items(state.actions.list(None), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_action_metadata)
        .collect();
    let approvals = recent_items(state.approvals.list(None), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_approval_metadata)
        .collect();
    let terminal_sessions = recent_items(terminal_session_records, MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_terminal_session_metadata)
        .collect();
    let processes = recent_items(state.processes.list(), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_process_metadata)
        .collect();

    DiagnosticsExportBundle {
        generated_at: now_ms(),
        summary: diagnostics_summary_impl(state),
        settings: sanitize_settings(settings),
        workspace: diagnostics_workspace_info(&workspace_root, repo_health, state),
        employee_activities,
        actions,
        approvals,
        terminal_sessions,
        processes,
        notes: vec![
            "Diagnostics are local-only and opt-in.".to_string(),
            "Terminal output, process logs, environment variables, credentials, tokens, and file-write contents are excluded.".to_string(),
        ],
    }
}

fn sanitize_settings(mut settings: AppSettings) -> AppSettings {
    if !settings.codex_binary_path.trim().is_empty() {
        settings.codex_binary_path = redact_path_string(&settings.codex_binary_path);
    }
    settings
}

fn diagnostics_workspace_info(
    workspace_root: &Path,
    repo_health: RepoHealth,
    state: &AppState,
) -> DiagnosticsWorkspaceInfo {
    DiagnosticsWorkspaceInfo {
        workspace_path: Some(redact_path_string(&workspace_root.to_string_lossy())),
        workspace_exists: repo_health.is_existing_directory,
        is_git_repo: repo_health.is_git_repo,
        repo_root: repo_health.repo_root.as_deref().map(redact_path_string),
        current_branch: repo_health
            .current_branch
            .as_deref()
            .map(redact_diagnostic_string),
        dirty: repo_health.dirty,
        git_user_name_configured: repo_health.git_user_name_configured,
        git_user_email_configured: repo_health.git_user_email_configured,
        worktree_supported: repo_health.worktree_supported,
        worktree_blockers: sanitize_strings(repo_health.worktree_blockers),
        handoff_blockers: sanitize_strings(repo_health.handoff_blockers),
        switch_blockers: sanitize_strings(switch_blockers_from_state(state)),
        codex_cli_status: sanitize_codex_status(repo_health.codex_cli_status),
    }
}

fn diagnostics_counts(
    employee_count: usize,
    terminal_sessions: &[TerminalSessionRecord],
    actions: &[Action],
    approvals: &[ApprovalRequest],
    processes: &[ManagedProcess],
    recent_files: usize,
) -> DiagnosticsCounts {
    DiagnosticsCounts {
        employees: employee_count,
        active_terminal_sessions: terminal_sessions
            .iter()
            .filter(|session| session.status == TerminalSessionStatus::Running)
            .count(),
        recent_terminal_sessions: terminal_sessions.len(),
        actions_by_status: count_actions_by_status(actions),
        approvals_by_status: count_approvals_by_status(approvals),
        managed_processes_by_status: count_processes_by_status(processes),
        recent_files,
    }
}

fn count_actions_by_status(actions: &[Action]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for action in actions {
        increment_count(&mut counts, action_status_key(action.status));
    }
    counts
}

fn count_approvals_by_status(approvals: &[ApprovalRequest]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for approval in approvals {
        increment_count(&mut counts, approval_status_key(approval.status));
    }
    counts
}

fn count_processes_by_status(processes: &[ManagedProcess]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for process in processes {
        increment_count(&mut counts, process_status_key(process.status));
    }
    counts
}

fn increment_count(counts: &mut BTreeMap<String, usize>, key: &str) {
    *counts.entry(key.to_string()).or_insert(0) += 1;
}

fn diagnostics_health(
    repo_health: &RepoHealth,
    counts: &DiagnosticsCounts,
    switch_blockers: &[String],
) -> (Vec<String>, Vec<String>) {
    let mut flags = Vec::new();
    let mut blockers = Vec::new();

    if !repo_health.is_existing_directory {
        flags.push("workspace_missing".to_string());
        blockers.push("workspace path is not an existing directory".to_string());
    }
    if !repo_health.is_git_repo {
        flags.push("workspace_not_git_repo".to_string());
    }
    if repo_health.is_git_repo
        && (!repo_health.git_user_name_configured || !repo_health.git_user_email_configured)
    {
        flags.push("git_identity_incomplete".to_string());
    }
    if !repo_health.worktree_blockers.is_empty() {
        flags.push("worktree_blocked".to_string());
        blockers.extend(repo_health.worktree_blockers.clone());
    }
    if !repo_health.handoff_blockers.is_empty() {
        flags.push("handoff_blocked".to_string());
        blockers.extend(repo_health.handoff_blockers.clone());
    }
    if !repo_health.codex_cli_status.available {
        flags.push("codex_cli_unavailable".to_string());
    }
    if counts.active_terminal_sessions > 0 {
        flags.push("terminal_active".to_string());
    }
    if counts
        .managed_processes_by_status
        .get("running")
        .copied()
        .unwrap_or_default()
        > 0
    {
        flags.push("process_running".to_string());
    }
    if counts
        .actions_by_status
        .get("running")
        .copied()
        .unwrap_or_default()
        > 0
    {
        flags.push("action_running".to_string());
    }
    if !switch_blockers.is_empty() {
        blockers.extend(switch_blockers.iter().cloned());
    }

    blockers.sort();
    blockers.dedup();
    (flags, sanitize_strings(blockers))
}

fn switch_blockers_from_state(state: &AppState) -> Vec<String> {
    let mut blockers = Vec::new();
    if state.terminal.has_active_sessions() || state.terminal_sessions.has_running() {
        blockers.push("a terminal session is active".to_string());
    }
    if state.processes.has_running() {
        blockers.push("a managed process is running".to_string());
    }
    if state.actions.has_running() {
        blockers.push("an action is running".to_string());
    }
    blockers
}

fn sanitize_action_metadata(action: Action) -> DiagnosticsActionMetadata {
    DiagnosticsActionMetadata {
        id: action.id,
        employee_id: action.employee_id,
        kind: action.kind,
        title: redact_diagnostic_string(&action.title),
        description: redact_diagnostic_string(&action.description),
        cwd: action.cwd.as_deref().map(redact_path_string),
        path: action.path.as_deref().map(redact_path_string),
        source: action.source,
        timeout_secs: action.timeout_secs,
        output_cap_bytes: action.output_cap_bytes,
        approval_id: action.approval_id,
        status: action.status,
        error: action.error.as_deref().map(redact_diagnostic_string),
        failure_reason: action.failure_reason,
        cancellation_reason: action
            .cancellation_reason
            .as_deref()
            .map(redact_diagnostic_string),
        created_at: action.created_at,
        updated_at: action.updated_at,
        started_at: action.started_at,
        finished_at: action.finished_at,
    }
}

fn sanitize_approval_metadata(approval: ApprovalRequest) -> DiagnosticsApprovalMetadata {
    DiagnosticsApprovalMetadata {
        id: approval.id,
        employee_id: approval.employee_id,
        action_id: approval.action_id,
        kind: approval.kind,
        title: redact_diagnostic_string(&approval.title),
        description: redact_diagnostic_string(&approval.description),
        path: approval.path.as_deref().map(redact_path_string),
        cwd: approval.cwd.as_deref().map(redact_path_string),
        status: approval.status,
        created_at: approval.created_at,
        resolved_at: approval.resolved_at,
    }
}

fn sanitize_employee_activity_metadata(
    activity: EmployeeActivity,
    terminal_sessions_by_id: &BTreeMap<String, TerminalSessionRecord>,
) -> DiagnosticsEmployeeActivityMetadata {
    let activity_reason = redact_diagnostic_string(&activity.activity_reason);
    let blockers = sanitize_strings(activity.blockers);
    let terminal = activity
        .active_terminal_session_id
        .as_deref()
        .and_then(|session_id| terminal_sessions_by_id.get(session_id))
        .map(sanitize_terminal_evidence_trace);
    let trace = DiagnosticsEmployeeActivityTrace {
        employee_id: activity.employee_id.clone(),
        legacy: DiagnosticsLegacyActivityTrace {
            status: activity.status,
            lifecycle: activity.lifecycle,
            behavior: activity.behavior,
            terminal_state: activity.terminal_state,
            reason: activity_reason.clone(),
        },
        active_terminal_session_id: activity.active_terminal_session_id.clone(),
        terminal,
        agent_runtime: activity.agent,
        contract: activity.contract,
        active_action_id: activity.active_action_id.clone(),
        active_process_ids: activity.active_process_ids.clone(),
        active_process_count: activity.active_process_ids.len(),
        review_counts: activity.review_counts.clone(),
        blockers: blockers.clone(),
        last_activity_at: activity.last_activity_at,
    };

    DiagnosticsEmployeeActivityMetadata {
        employee_id: activity.employee_id,
        status: activity.status,
        lifecycle: activity.lifecycle,
        behavior: activity.behavior,
        terminal_state: activity.terminal_state,
        activity_reason,
        session: activity.session,
        agent: activity.agent,
        work: activity.work,
        attention: activity.attention,
        contract: activity.contract,
        active_terminal_session_id: activity.active_terminal_session_id,
        active_action_id: activity.active_action_id,
        active_process_ids: activity.active_process_ids,
        review_counts: activity.review_counts,
        blockers,
        last_activity_at: activity.last_activity_at,
        trace,
    }
}

fn sanitize_terminal_evidence_trace(
    session: &TerminalSessionRecord,
) -> DiagnosticsTerminalEvidenceTrace {
    DiagnosticsTerminalEvidenceTrace {
        session_id: session.session_id.clone(),
        employee_id: session.employee_id.clone(),
        status: session.status,
        runtime: session.runtime,
        profile: session.profile,
        active_profile: session.active_profile,
        turn_state: session.turn_state,
        last_prompt_submitted_at: session.last_prompt_submitted_at,
        last_prompt_ready_at: session.last_prompt_ready_at,
        last_approval_prompt_at: session.last_approval_prompt_at,
        last_transition_reason: session.last_transition_reason,
    }
}

fn sanitize_terminal_session_metadata(
    session: TerminalSessionRecord,
) -> DiagnosticsTerminalSessionMetadata {
    DiagnosticsTerminalSessionMetadata {
        session_id: session.session_id,
        employee_id: session.employee_id,
        profile: session.profile,
        runtime: session.runtime,
        active_profile: session.active_profile,
        cwd: redact_path_string(&session.cwd),
        current_cwd: session.current_cwd.as_deref().map(redact_path_string),
        status: session.status,
        exit_code: session.exit_code,
        started_at: session.started_at,
        ended_at: session.ended_at,
        stopped_at: session.stopped_at,
        stop_reason: session.stop_reason,
        label: redact_diagnostic_string(&session.label),
        last_output_at: session.last_output_at,
        last_prompt_submitted_at: session.last_prompt_submitted_at,
        last_prompt_ready_at: session.last_prompt_ready_at,
        last_approval_prompt_at: session.last_approval_prompt_at,
        turn_state: session.turn_state,
        last_transition_reason: session.last_transition_reason,
        message: session.message.as_deref().map(redact_diagnostic_string),
    }
}

fn sanitize_process_metadata(process: ManagedProcess) -> DiagnosticsProcessMetadata {
    DiagnosticsProcessMetadata {
        id: process.id,
        employee_id: process.employee_id,
        title: redact_diagnostic_string(&process.title),
        cwd: redact_path_string(&process.cwd),
        status: process.status,
        exit_code: process.exit_code,
        created_at: process.created_at,
        updated_at: process.updated_at,
    }
}

fn sanitize_codex_status(status: CodexCliStatus) -> CodexCliStatus {
    CodexCliStatus {
        available: status.available,
        version: status.version.as_deref().map(redact_diagnostic_string),
        message: redact_diagnostic_string(&status.message),
        path: status.path.as_deref().map(redact_path_string),
    }
}

fn sanitize_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| redact_diagnostic_string(&value))
        .collect()
}

fn recent_items<T>(mut items: Vec<T>, limit: usize) -> Vec<T> {
    if items.len() <= limit {
        return items;
    }
    items.drain(0..items.len() - limit);
    items
}

fn action_status_key(status: ActionStatus) -> &'static str {
    match status {
        ActionStatus::Draft => "draft",
        ActionStatus::PendingApproval => "pending_approval",
        ActionStatus::Approved => "approved",
        ActionStatus::Running => "running",
        ActionStatus::Succeeded => "succeeded",
        ActionStatus::Failed => "failed",
        ActionStatus::Rejected => "rejected",
        ActionStatus::Cancelled => "cancelled",
    }
}

fn approval_status_key(status: ApprovalStatus) -> &'static str {
    match status {
        ApprovalStatus::Pending => "pending",
        ApprovalStatus::Approved => "approved",
        ApprovalStatus::Rejected => "rejected",
        ApprovalStatus::Expired => "expired",
    }
}

fn process_status_key(status: ManagedProcessStatus) -> &'static str {
    match status {
        ManagedProcessStatus::Running => "running",
        ManagedProcessStatus::Exited => "exited",
        ManagedProcessStatus::Failed => "failed",
        ManagedProcessStatus::Killed => "killed",
    }
}

#[cfg(test)]
mod tests {
    use std::{fs as std_fs, path::PathBuf, sync::Arc};

    use parking_lot::RwLock;

    use super::*;
    use crate::{
        activity::EmployeeActivityStatus,
        activity_contract::{
            EmployeeActivityContractRenderPlacement, EmployeeActivityContractSourceConfidence,
            EmployeeActivityContractSourceRuntime,
        },
        approvals::{ApprovalManager, ApprovalRequest},
        employees::{EmployeeManager, EmployeeRole, EmployeeStatus},
        processes::{ManagedProcess, ProcessManager},
        terminal::{
            AgentRuntimeConfidence, AgentRuntimeSource, AgentRuntimeState, TerminalManager,
            TerminalSessionStore, TerminalTurnTransitionReason,
        },
    };

    #[test]
    fn diagnostics_count_aggregation_groups_statuses() {
        let actions = vec![
            sample_action(ActionStatus::Running),
            sample_action(ActionStatus::Failed),
            sample_action(ActionStatus::Failed),
        ];
        let approvals = vec![
            sample_approval(ApprovalStatus::Pending),
            sample_approval(ApprovalStatus::Rejected),
        ];
        let processes = vec![
            sample_process(ManagedProcessStatus::Running),
            sample_process(ManagedProcessStatus::Exited),
            sample_process(ManagedProcessStatus::Exited),
        ];
        let sessions = vec![TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Shell,
            runtime: crate::terminal::TerminalSessionRuntime::Pty,
            active_profile: Some(TerminalLaunchProfile::Shell),
            cwd: "/tmp".to_string(),
            current_cwd: Some("/tmp".to_string()),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: "Shell".to_string(),
            last_output_at: None,
            last_prompt_submitted_at: None,
            last_prompt_ready_at: None,
            last_approval_prompt_at: None,
            turn_state: crate::terminal::TerminalTurnState::Shell,
            last_transition_reason: None,
            last_output_tail: String::new(),
            last_notify_turn_complete_at: None,
            message: None,
        }];

        let counts = diagnostics_counts(2, &sessions, &actions, &approvals, &processes, 3);

        assert_eq!(counts.employees, 2);
        assert_eq!(counts.active_terminal_sessions, 1);
        assert_eq!(counts.actions_by_status.get("failed"), Some(&2));
        assert_eq!(counts.approvals_by_status.get("pending"), Some(&1));
        assert_eq!(counts.managed_processes_by_status.get("exited"), Some(&2));
        assert_eq!(counts.recent_files, 3);
    }

    #[test]
    fn export_metadata_excludes_sensitive_fields() {
        let action = sample_action(ActionStatus::Failed);
        let approval = sample_approval(ApprovalStatus::Pending);
        let process = sample_process(ManagedProcessStatus::Failed);
        let action_metadata = sanitize_action_metadata(action);
        let approval_metadata = sanitize_approval_metadata(approval);
        let process_metadata = sanitize_process_metadata(process);
        let json = serde_json::to_string(&serde_json::json!({
            "action": action_metadata,
            "approval": approval_metadata,
            "process": process_metadata,
        }))
        .unwrap();

        assert!(!json.contains("raw terminal output"));
        assert!(!json.contains("TOKEN=abc123"));
        assert!(!json.contains("TOKEN=abc123 npm run dev"));
        assert!(!json.contains("hunter2"));
        assert!(!json.contains("SECRET=top"));
        assert!(!json.contains("contents"));
        assert!(!json.contains("\"command\""));
    }

    #[test]
    fn export_bundle_includes_employee_activity_contract_trace() {
        let root = test_root("activity-contract-trace");
        let state = test_state(root.clone());
        let employee = state.employees.create(
            "Ada".to_string(),
            EmployeeRole::General,
            state.workspace_root(),
        );
        let session = state.terminal_sessions.create_with_runtime(
            "session-1".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
            TerminalSessionRuntime::CodexAppServer,
        );
        let prompt_record = state
            .terminal_sessions
            .record_input(&session.session_id, "\r")
            .unwrap();
        state
            .agent_runtime
            .sync_from_terminal_session(&prompt_record);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let bundle = diagnostics_export_bundle_impl(&state);

        let activity = bundle
            .employee_activities
            .iter()
            .find(|activity| activity.employee_id == employee.id)
            .expect("employee activity diagnostics should include employee");
        assert_eq!(activity.status, EmployeeActivityStatus::CodexRunning);
        assert_eq!(activity.activity_reason, "terminal_agent_working");
        assert_eq!(activity.agent.state, AgentRuntimeState::Thinking);
        assert_eq!(activity.agent.source, AgentRuntimeSource::CodexAppServer);
        assert_eq!(
            activity.contract.source.runtime,
            EmployeeActivityContractSourceRuntime::CodexAppServer
        );
        assert_eq!(
            activity.contract.source.confidence,
            EmployeeActivityContractSourceConfidence::Structured
        );
        assert_eq!(
            activity.contract.render.placement,
            EmployeeActivityContractRenderPlacement::Desk
        );
        assert_eq!(
            activity.active_terminal_session_id.as_deref(),
            Some("session-1")
        );
        assert_eq!(activity.trace.employee_id, employee.id);
        assert_eq!(
            activity.trace.legacy.status,
            EmployeeActivityStatus::CodexRunning
        );
        assert_eq!(activity.trace.legacy.reason, "terminal_agent_working");
        assert_eq!(
            activity
                .trace
                .terminal
                .as_ref()
                .expect("trace should include terminal evidence")
                .runtime,
            TerminalSessionRuntime::CodexAppServer
        );
        assert_eq!(
            activity.trace.terminal.as_ref().unwrap().turn_state,
            TerminalTurnState::PromptSubmitted
        );
        assert_eq!(
            activity
                .trace
                .terminal
                .as_ref()
                .unwrap()
                .last_prompt_submitted_at,
            prompt_record.last_prompt_submitted_at
        );
        assert_eq!(
            activity
                .trace
                .terminal
                .as_ref()
                .unwrap()
                .last_transition_reason,
            Some(TerminalTurnTransitionReason::OwnerInputSubmitted)
        );
        assert_eq!(
            activity.trace.agent_runtime.source,
            AgentRuntimeSource::CodexAppServer
        );
        assert_eq!(
            activity.trace.agent_runtime.confidence,
            AgentRuntimeConfidence::Structured
        );
        assert_eq!(
            activity.trace.contract.source.confidence,
            EmployeeActivityContractSourceConfidence::Structured
        );
        assert_eq!(activity.trace.active_process_count, 0);
    }

    #[test]
    fn export_bundle_includes_pty_terminal_transition_reason_trace() {
        let root = test_root("pty-transition-trace");
        let state = test_state(root.clone());
        let employee = state.employees.create(
            "Ada".to_string(),
            EmployeeRole::General,
            state.workspace_root(),
        );
        let session = state.terminal_sessions.create(
            "session-pty".to_string(),
            employee.id.clone(),
            TerminalLaunchProfile::Codex,
            root.to_string_lossy().to_string(),
        );
        let ready_record = state
            .terminal_sessions
            .record_output(&session.session_id, "\r\n› ")
            .unwrap();
        state
            .agent_runtime
            .sync_from_terminal_session(&ready_record);
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let bundle = diagnostics_export_bundle_impl(&state);
        let activity = bundle
            .employee_activities
            .iter()
            .find(|activity| activity.employee_id == employee.id)
            .expect("employee activity diagnostics should include employee");
        let terminal = activity
            .trace
            .terminal
            .as_ref()
            .expect("trace should include active terminal evidence");

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::CodexWaitingInstruction
        );
        assert_eq!(terminal.runtime, TerminalSessionRuntime::Pty);
        assert_eq!(terminal.turn_state, TerminalTurnState::OwnerPromptReady);
        assert_eq!(
            terminal.last_transition_reason,
            Some(TerminalTurnTransitionReason::CodexPromptReady)
        );
        assert_eq!(
            activity.trace.agent_runtime.source,
            AgentRuntimeSource::TerminalFallback
        );
        assert_eq!(
            activity.trace.agent_runtime.confidence,
            AgentRuntimeConfidence::TerminalFallback
        );
    }

    #[test]
    fn terminal_diagnostics_include_runtime_turn_evidence_and_redact_strings() {
        let cwd = "/Users/alice/project/token=abc123";
        let current_cwd = "/Users/alice/project/secret=top";
        let metadata = sanitize_terminal_session_metadata(TerminalSessionRecord {
            session_id: "term-1".to_string(),
            employee_id: "employee-1".to_string(),
            profile: TerminalLaunchProfile::Codex,
            runtime: TerminalSessionRuntime::CodexAppServer,
            active_profile: Some(TerminalLaunchProfile::Codex),
            cwd: cwd.to_string(),
            current_cwd: Some(current_cwd.to_string()),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: "Codex token=abc123".to_string(),
            last_output_at: Some(2),
            last_prompt_submitted_at: Some(3),
            last_prompt_ready_at: Some(4),
            last_approval_prompt_at: Some(5),
            turn_state: TerminalTurnState::WaitingApproval,
            last_transition_reason: Some(TerminalTurnTransitionReason::CodexApprovalPrompt),
            last_output_tail: "raw terminal output TOKEN=abc123".to_string(),
            last_notify_turn_complete_at: None,
            message: Some("password: hunter2".to_string()),
        });

        assert_eq!(metadata.runtime, TerminalSessionRuntime::CodexAppServer);
        assert_eq!(metadata.active_profile, Some(TerminalLaunchProfile::Codex));
        assert_eq!(metadata.cwd, redact_path_string(cwd));
        assert_eq!(
            metadata.current_cwd.as_deref(),
            Some(redact_path_string(current_cwd).as_str())
        );
        assert_eq!(metadata.last_prompt_submitted_at, Some(3));
        assert_eq!(metadata.last_prompt_ready_at, Some(4));
        assert_eq!(metadata.last_approval_prompt_at, Some(5));
        assert_eq!(metadata.turn_state, TerminalTurnState::WaitingApproval);
        assert_eq!(
            metadata.last_transition_reason,
            Some(TerminalTurnTransitionReason::CodexApprovalPrompt)
        );

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("codex_app_server"));
        assert!(json.contains("waiting_approval"));
        assert!(json.contains("codex_approval_prompt"));
        assert!(!json.contains("raw terminal output"));
        assert!(!json.contains("lastOutputTail"));
        assert!(!json.contains("abc123"));
        assert!(!json.contains("hunter2"));
        assert!(!json.contains("SECRET=top"));
    }

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "slavey-diagnostics-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn test_state(workspace_root: PathBuf) -> AppState {
        AppState {
            workspace_root: Arc::new(RwLock::new(workspace_root.clone())),
            employees: EmployeeManager::default(),
            terminal: TerminalManager::default(),
            codex_app_server: crate::codex_app_server::CodexAppServerManager::default(),
            terminal_sessions: TerminalSessionStore::default(),
            agent_runtime: crate::terminal::AgentRuntimeStore::default(),
            persistence: crate::persistence::PersistenceManager::new(
                workspace_root.join("state.json"),
                None,
            ),
            approvals: ApprovalManager::default(),
            actions: crate::actions::ActionManager::default(),
            processes: ProcessManager::default(),
        }
    }

    fn sample_action(status: ActionStatus) -> Action {
        Action {
            id: "action-1".to_string(),
            employee_id: "employee-1".to_string(),
            kind: ActionKind::FileWrite,
            title: "Write token=abc123".to_string(),
            description: "password: hunter2".to_string(),
            cwd: Some("/Users/alice/project".to_string()),
            command: Some("echo TOKEN=abc123".to_string()),
            path: Some("/Users/alice/project/file.txt".to_string()),
            contents: Some("SECRET=top".to_string()),
            source: ActionSource::User,
            timeout_secs: 120,
            output_cap_bytes: 100,
            approval_id: Some("approval-1".to_string()),
            status,
            output: "raw terminal output TOKEN=abc123".to_string(),
            error: Some("failed token=abc123".to_string()),
            failure_reason: Some(ActionFailureReason::ValidationFailed),
            cancellation_reason: Some("password=hunter2".to_string()),
            created_at: 1,
            updated_at: 2,
            started_at: Some(3),
            finished_at: Some(4),
        }
    }

    fn sample_approval(status: ApprovalStatus) -> ApprovalRequest {
        ApprovalRequest {
            id: "approval-1".to_string(),
            employee_id: "employee-1".to_string(),
            action_id: Some("action-1".to_string()),
            kind: ApprovalKind::ShellCommand,
            title: "Approve token=abc123".to_string(),
            description: "Run password=hunter2".to_string(),
            command: Some("curl -H Authorization: Bearer abc".to_string()),
            path: Some("/Users/alice/project/secret.txt".to_string()),
            cwd: Some("/Users/alice/project".to_string()),
            status,
            created_at: 1,
            resolved_at: None,
        }
    }

    fn sample_process(status: ManagedProcessStatus) -> ManagedProcess {
        ManagedProcess {
            id: "process-1".to_string(),
            employee_id: Some("employee-1".to_string()),
            title: "Serve SECRET=top".to_string(),
            command: "TOKEN=abc123 npm run dev".to_string(),
            cwd: "/Users/alice/project".to_string(),
            status,
            exit_code: None,
            created_at: 1,
            updated_at: 2,
        }
    }
}
