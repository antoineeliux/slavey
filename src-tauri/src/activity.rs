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
    terminal::{TerminalLaunchProfile, TerminalSessionRecord, TerminalSessionStatus},
    AppState,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeActivityStatus {
    Idle,
    ShellRunning,
    CodexRunning,
    ActionPendingApproval,
    ActionRunning,
    ProcessRunning,
    ReviewNeeded,
    HandoffReady,
    Blocked,
    Stopped,
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
    let active_terminal_session_id = active_terminal.map(|session| session.session_id.clone());
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

    let (status, label, details, active_action_id) = if let Some(action) = active_action {
        (
            EmployeeActivityStatus::ActionRunning,
            "Running action".to_string(),
            Some(action.title.clone()),
            Some(action.id.clone()),
        )
    } else if let Some(action) = pending_action {
        (
            EmployeeActivityStatus::ActionPendingApproval,
            "Waiting for approval".to_string(),
            Some(action.title.clone()),
            Some(action.id.clone()),
        )
    } else if let Some(approval) = pending_approval {
        (
            EmployeeActivityStatus::ActionPendingApproval,
            "Waiting for approval".to_string(),
            Some(approval.title.clone()),
            approval.action_id.clone(),
        )
    } else if !active_process_ids.is_empty() {
        (
            EmployeeActivityStatus::ProcessRunning,
            "Running process".to_string(),
            Some(format!("{} managed process(es)", active_process_ids.len())),
            None,
        )
    } else if let Some(session) = active_terminal {
        match session.profile {
            TerminalLaunchProfile::Shell => (
                EmployeeActivityStatus::ShellRunning,
                "Shell running".to_string(),
                Some(session.cwd.clone()),
                None,
            ),
            TerminalLaunchProfile::Codex => (
                EmployeeActivityStatus::CodexRunning,
                "Codex running".to_string(),
                Some(session.cwd.clone()),
                None,
            ),
        }
    } else if matches!(
        employee.status,
        EmployeeStatus::Blocked | EmployeeStatus::Failed
    ) {
        (
            EmployeeActivityStatus::Blocked,
            "Blocked".to_string(),
            employee.current_command.clone(),
            None,
        )
    } else if review_counts.changed_files > 0 {
        (
            EmployeeActivityStatus::ReviewNeeded,
            "Review needed".to_string(),
            Some(format!("{} changed file(s)", review_counts.changed_files)),
            None,
        )
    } else if handoff_ready {
        (
            EmployeeActivityStatus::HandoffReady,
            "Handoff ready".to_string(),
            Some("employee branch has commits ready to apply".to_string()),
            None,
        )
    } else if employee.status == EmployeeStatus::Stopped {
        (
            EmployeeActivityStatus::Stopped,
            "Stopped".to_string(),
            None,
            None,
        )
    } else {
        (EmployeeActivityStatus::Idle, "Idle".to_string(), None, None)
    };

    EmployeeActivity {
        employee_id: employee.id.clone(),
        status,
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
        Ok(output) => review_counts_from_status(&parse_status_lines(&output)),
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

    #[test]
    fn idle_employee_activity_is_idle() {
        let root = test_root("idle");
        let state = test_state(root);
        let employee = create_employee(&state);

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::Idle);
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
        state.employees.update(&employee.id, |employee| {
            employee.status = EmployeeStatus::Running;
            employee.current_command = Some("codex".to_string());
            employee.terminal_session_id = Some(session.session_id.clone());
        });

        let activity = activity(&state, &employee.id);

        assert_eq!(activity.status, EmployeeActivityStatus::CodexRunning);
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
        assert_eq!(activity.active_terminal_session_id, None);
    }

    #[test]
    fn pending_action_activity_reports_approval_wait() {
        let root = test_root("pending-action");
        let state = test_state(root);
        let employee = create_employee(&state);
        let action = sample_action(&employee.id, ActionStatus::PendingApproval);
        state.actions.replace_all(vec![action.clone()]);

        let activity = activity(&state, &employee.id);

        assert_eq!(
            activity.status,
            EmployeeActivityStatus::ActionPendingApproval
        );
        assert_eq!(
            activity.active_action_id.as_deref(),
            Some(action.id.as_str())
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
        });

        assert_eq!(activity.status, EmployeeActivityStatus::ProcessRunning);
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
        assert_eq!(activity.review_counts.changed_files, 1);
        assert_eq!(activity.review_counts.untracked_files, 1);
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
