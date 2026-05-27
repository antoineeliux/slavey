use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::State;

use crate::{
    actions::{Action, ActionFailureReason, ActionKind, ActionSource, ActionStatus},
    approvals::{ApprovalKind, ApprovalRequest, ApprovalStatus},
    events::now_ms,
    persistence::AppSettings,
    processes::{ManagedProcess, ManagedProcessStatus},
    terminal::{
        codex_cli_status_impl, CodexCliStatus, TerminalLaunchProfile, TerminalSessionRecord,
        TerminalSessionStatus, TerminalStopReason,
    },
    workspace::{repo_health_for_workspace, RepoHealth},
    AppState,
};

const MAX_DIAGNOSTIC_STRING_CHARS: usize = 240;
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
pub struct DiagnosticsTerminalSessionMetadata {
    pub session_id: String,
    pub employee_id: String,
    pub profile: TerminalLaunchProfile,
    pub cwd: String,
    pub status: TerminalSessionStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub stopped_at: Option<u64>,
    pub stop_reason: Option<TerminalStopReason>,
    pub label: String,
    pub last_output_at: Option<u64>,
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
    let codex_status = codex_cli_status_impl();
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
    let repo_health = repo_health_for_workspace(&workspace_root, codex_cli_status_impl());
    let actions = recent_items(state.actions.list(None), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_action_metadata)
        .collect();
    let approvals = recent_items(state.approvals.list(None), MAX_EXPORT_ITEMS)
        .into_iter()
        .map(sanitize_approval_metadata)
        .collect();
    let terminal_sessions = recent_items(state.terminal_sessions.list(None), MAX_EXPORT_ITEMS)
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
        settings: state.persistence.settings(),
        workspace: diagnostics_workspace_info(&workspace_root, repo_health, state),
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

fn sanitize_terminal_session_metadata(
    session: TerminalSessionRecord,
) -> DiagnosticsTerminalSessionMetadata {
    DiagnosticsTerminalSessionMetadata {
        session_id: session.session_id,
        employee_id: session.employee_id,
        profile: session.profile,
        cwd: redact_path_string(&session.cwd),
        status: session.status,
        exit_code: session.exit_code,
        started_at: session.started_at,
        ended_at: session.ended_at,
        stopped_at: session.stopped_at,
        stop_reason: session.stop_reason,
        label: redact_diagnostic_string(&session.label),
        last_output_at: session.last_output_at,
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

fn redact_path_string(path: &str) -> String {
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
    use crate::{approvals::ApprovalRequest, processes::ManagedProcess};

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
            cwd: "/tmp".to_string(),
            status: TerminalSessionStatus::Running,
            exit_code: None,
            started_at: 1,
            ended_at: None,
            stopped_at: None,
            stop_reason: None,
            label: "Shell".to_string(),
            last_output_at: None,
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
