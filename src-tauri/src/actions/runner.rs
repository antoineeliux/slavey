use std::{
    io::Read,
    path::PathBuf,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use tauri::AppHandle;

use super::{
    transitions::ensure_file_write_size, Action, ActionFailureReason, ActionKind, ActionManager,
    ActionStatus, MAX_ACTION_OUTPUT_BYTES,
};
use crate::{
    approvals::ApprovalManager,
    employees::{resolve_employee_execution_dir, EmployeeManager},
    events::{emit_action_updated, emit_log, LogLevel},
    fs::write_file_in_workspace,
    persistence::{AppStateSnapshotInput, PersistenceManager},
    processes::{configure_process_group, shell_command, terminate_process_tree, ProcessManager},
    read_workspace_root,
    terminal::TerminalSessionStore,
    WorkspaceRootHandle,
};

pub(super) struct ActionRunContext {
    pub(super) execution_root: PathBuf,
    pub(super) workspace_root: WorkspaceRootHandle,
    pub(super) employees: EmployeeManager,
    pub(super) approvals: ApprovalManager,
    pub(super) actions: ActionManager,
    pub(super) processes: ProcessManager,
    pub(super) terminal_sessions: TerminalSessionStore,
    pub(super) persistence: PersistenceManager,
}

#[derive(Debug)]
pub(super) struct ActionFailure {
    pub(super) reason: ActionFailureReason,
    pub(super) message: String,
    pub(super) output: String,
}

pub(super) type ActionExecutionResult = Result<String, ActionFailure>;

impl ActionFailure {
    fn new(reason: ActionFailureReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
            output: String::new(),
        }
    }

    fn with_output(reason: ActionFailureReason, message: impl Into<String>, output: &[u8]) -> Self {
        Self {
            reason,
            message: message.into(),
            output: bytes_to_string(output),
        }
    }
}

impl From<String> for ActionFailure {
    fn from(message: String) -> Self {
        ActionFailure::new(ActionFailureReason::ValidationFailed, message)
    }
}

pub(super) fn run_action_impl(
    context: &ActionRunContext,
    actions: &ActionManager,
    action: &Action,
) -> ActionExecutionResult {
    if action_is_cancelled(actions, &action.id) {
        return Err(ActionFailure::new(
            ActionFailureReason::Cancelled,
            "action cancelled",
        ));
    }

    match action.kind {
        ActionKind::ShellCommand => run_shell_action(context, actions, action),
        ActionKind::FileWrite => run_file_write_action(context, action),
        ActionKind::GitOperation => Err(ActionFailure::new(
            ActionFailureReason::Unsupported,
            "git_operation actions are approval-only in this phase",
        )),
    }
}

pub(super) fn finish_background_action(
    app: &AppHandle,
    context: &ActionRunContext,
    action_id: &str,
    result: ActionExecutionResult,
) {
    let updated = match result {
        Ok(output) => context.actions.finish_success(action_id, output),
        Err(failure) => context.actions.finish_failure(
            action_id,
            failure.reason,
            failure.message,
            failure.output,
        ),
    };

    match updated {
        Ok(action) => emit_action_updated(app, action),
        Err(error) => {
            if context
                .actions
                .get(action_id)
                .is_some_and(|action| action.status == ActionStatus::Cancelled)
            {
                return;
            }
            emit_log(
                app,
                LogLevel::Warn,
                format!("action {action_id} finished with stale state: {error}"),
            );
        }
    }

    if let Err(error) = persist_context_snapshot(context) {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist completed action: {error}"),
        );
    }
}

fn persist_context_snapshot(context: &ActionRunContext) -> Result<(), String> {
    let workspace_root = read_workspace_root(&context.workspace_root);
    context.persistence.save(AppStateSnapshotInput {
        workspace_root,
        employees: context.employees.list(),
        terminal_sessions: context.terminal_sessions.list(None),
        actions: context.actions.list(None),
        approvals: context.approvals.list(None),
        processes: context.processes.list(),
        process_logs: context.processes.log_snapshots(),
    })
}

fn run_shell_action(
    context: &ActionRunContext,
    actions: &ActionManager,
    action: &Action,
) -> ActionExecutionResult {
    let employee = context.employees.get(&action.employee_id).ok_or_else(|| {
        ActionFailure::new(ActionFailureReason::ValidationFailed, "employee not found")
    })?;
    let cwd =
        resolve_employee_execution_dir(&context.execution_root, &employee, action.cwd.as_deref())
            .map_err(ActionFailure::from)?;
    let command = action.command.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "shell command action requires command",
        )
    })?;

    let mut command = shell_command(command);
    command
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        ActionFailure::new(ActionFailureReason::FailedToStart, error.to_string())
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::FailedToStart,
            "failed to capture stdout",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::FailedToStart,
            "failed to capture stderr",
        )
    })?;
    let child = Arc::new(Mutex::new(child));
    let cancel = Arc::new(AtomicBool::new(false));
    actions.register_running_process(&action.id, Arc::clone(&child), Arc::clone(&cancel));
    if action_is_cancelled(actions, &action.id) {
        actions.cancel_running_process(&action.id);
        return Err(ActionFailure::new(
            ActionFailureReason::Cancelled,
            "action cancelled",
        ));
    }

    let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(64);
    spawn_pipe_reader(stdout, sender.clone());
    spawn_pipe_reader(stderr, sender);

    let deadline = Instant::now() + Duration::from_secs(action.timeout_secs);
    let mut output = Vec::new();

    loop {
        if let Err(failure) = drain_available_output(&receiver, &mut output) {
            terminate_child(&child);
            actions.remove_running_process(&action.id);
            return Err(failure);
        }

        if cancel.load(Ordering::SeqCst) {
            terminate_child(&child);
            actions.remove_running_process(&action.id);
            return Err(ActionFailure::with_output(
                ActionFailureReason::Cancelled,
                "action cancelled",
                &output,
            ));
        }

        let status = {
            let mut child = child.lock();
            child.try_wait().map_err(|error| {
                ActionFailure::new(ActionFailureReason::CommandFailed, error.to_string())
            })?
        };
        if let Some(status) = status {
            if let Err(failure) = drain_remaining_output(&receiver, &mut output) {
                terminate_child(&child);
                actions.remove_running_process(&action.id);
                return Err(failure);
            }
            actions.remove_running_process(&action.id);
            let combined = bytes_to_string(&output);
            return if status.success() {
                Ok(combined)
            } else {
                Err(ActionFailure {
                    reason: ActionFailureReason::CommandFailed,
                    message: format!("command exited with {status}"),
                    output: combined,
                })
            };
        }

        if Instant::now() >= deadline {
            terminate_child(&child);
            let _ = drain_remaining_output(&receiver, &mut output);
            actions.remove_running_process(&action.id);
            return Err(ActionFailure::with_output(
                ActionFailureReason::TimedOut,
                format!(
                    "action timed out after {} seconds; process killed",
                    action.timeout_secs
                ),
                &output,
            ));
        }

        thread::sleep(Duration::from_millis(20));
    }
}

fn run_file_write_action(context: &ActionRunContext, action: &Action) -> ActionExecutionResult {
    let path = action.path.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "file write action requires path",
        )
    })?;
    let contents = action.contents.as_deref().ok_or_else(|| {
        ActionFailure::new(
            ActionFailureReason::ValidationFailed,
            "file write action requires contents",
        )
    })?;
    ensure_file_write_size(contents).map_err(ActionFailure::from)?;
    let root = resolve_file_write_action_root(context, action)?;
    write_file_in_workspace(&root, path, contents).map_err(ActionFailure::from)?;
    Ok(format!("wrote {path}"))
}

fn resolve_file_write_action_root(
    context: &ActionRunContext,
    action: &Action,
) -> Result<PathBuf, ActionFailure> {
    let employee = context.employees.get(&action.employee_id).ok_or_else(|| {
        ActionFailure::new(ActionFailureReason::ValidationFailed, "employee not found")
    })?;
    resolve_employee_execution_dir(&context.execution_root, &employee, action.cwd.as_deref())
        .map_err(ActionFailure::from)
}

fn spawn_pipe_reader<R>(mut reader: R, sender: SyncSender<Vec<u8>>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if sender.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_available_output(
    receiver: &Receiver<Vec<u8>>,
    output: &mut Vec<u8>,
) -> Result<(), ActionFailure> {
    loop {
        match receiver.try_recv() {
            Ok(chunk) => append_output(output, &chunk)?,
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn drain_remaining_output(
    receiver: &Receiver<Vec<u8>>,
    output: &mut Vec<u8>,
) -> Result<(), ActionFailure> {
    let drain_deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => append_output(output, &chunk)?,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= drain_deadline => {
                return Ok(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn append_output(output: &mut Vec<u8>, chunk: &[u8]) -> Result<(), ActionFailure> {
    if output.len().saturating_add(chunk.len()) > MAX_ACTION_OUTPUT_BYTES {
        let remaining = MAX_ACTION_OUTPUT_BYTES.saturating_sub(output.len());
        output.extend_from_slice(&chunk[..remaining]);
        return Err(ActionFailure::with_output(
            ActionFailureReason::OutputLimitExceeded,
            format!(
                "action output exceeded {} bytes; process killed",
                MAX_ACTION_OUTPUT_BYTES
            ),
            output,
        ));
    }
    output.extend_from_slice(chunk);
    Ok(())
}

fn terminate_child(child: &Arc<Mutex<Child>>) {
    let mut child = child.lock();
    terminate_process_tree(&mut child);
}

fn bytes_to_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

fn action_is_cancelled(actions: &ActionManager, action_id: &str) -> bool {
    actions
        .get(action_id)
        .is_some_and(|action| action.status == ActionStatus::Cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs as std_fs, path::Path};

    use crate::employees::{EmployeeManager, EmployeeRole};
    use parking_lot::RwLock;

    fn test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("slavey-actions-{name}-{}", uuid::Uuid::new_v4()));
        std_fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn test_context(root: &Path, worktree: Option<&Path>) -> (ActionRunContext, String) {
        let employees = EmployeeManager::default();
        let employee = employees.create(
            "Employee".to_string(),
            EmployeeRole::General,
            root.to_path_buf(),
        );
        if let Some(worktree) = worktree {
            employees.update(&employee.id, |employee| {
                let worktree = worktree.to_string_lossy().to_string();
                employee.worktree_path = Some(worktree.clone());
                employee.cwd = worktree;
            });
        }

        (
            ActionRunContext {
                execution_root: root.to_path_buf(),
                workspace_root: Arc::new(RwLock::new(root.to_path_buf())),
                employees,
                approvals: ApprovalManager::default(),
                actions: ActionManager::default(),
                processes: ProcessManager::default(),
                terminal_sessions: TerminalSessionStore::default(),
                persistence: PersistenceManager::new(root.join("state.json"), None),
            },
            employee.id,
        )
    }

    fn file_write_action(employee_id: String, path: impl Into<String>) -> Action {
        Action {
            id: "action-1".to_string(),
            employee_id,
            kind: ActionKind::FileWrite,
            title: "Write file".to_string(),
            description: "Test write".to_string(),
            cwd: None,
            command: None,
            path: Some(path.into()),
            contents: Some("written by action".to_string()),
            source: super::super::ActionSource::User,
            timeout_secs: super::super::DEFAULT_ACTION_TIMEOUT_SECS,
            output_cap_bytes: MAX_ACTION_OUTPUT_BYTES,
            approval_id: None,
            status: ActionStatus::Approved,
            output: String::new(),
            error: None,
            failure_reason: None,
            cancellation_reason: None,
            created_at: 1,
            updated_at: 1,
            started_at: None,
            finished_at: None,
        }
    }

    #[test]
    fn file_write_action_with_worktree_writes_inside_worktree_by_default() {
        let root = test_root("worktree-default");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, "notes.txt");

        run_file_write_action(&context, &action).unwrap();

        assert_eq!(
            std_fs::read_to_string(worktree.join("notes.txt")).unwrap(),
            "written by action"
        );
        assert!(!root.join("notes.txt").exists());
    }

    #[test]
    fn file_write_action_with_worktree_rejects_absolute_path_outside_worktree() {
        let root = test_root("worktree-absolute-outside");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, root.join("outside.txt").to_string_lossy());

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("outside the workspace"));
        assert!(!root.join("outside.txt").exists());
    }

    #[test]
    fn file_write_action_with_worktree_rejects_relative_path_outside_worktree() {
        let root = test_root("worktree-relative-outside");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, "../../outside.txt");

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("outside the workspace"));
    }

    #[test]
    fn file_write_action_without_worktree_writes_inside_workspace() {
        let root = test_root("workspace-default");
        let (context, employee_id) = test_context(&root, None);
        let action = file_write_action(employee_id, "notes.txt");

        run_file_write_action(&context, &action).unwrap();

        assert_eq!(
            std_fs::read_to_string(root.join("notes.txt")).unwrap(),
            "written by action"
        );
    }

    #[test]
    fn file_write_action_sensitive_paths_remain_blocked() {
        let root = test_root("sensitive");
        let worktree = root.join(".slavey").join("worktrees").join("employee-1");
        std_fs::create_dir_all(&worktree).unwrap();
        let (context, employee_id) = test_context(&root, Some(&worktree));
        let action = file_write_action(employee_id, ".env");

        let error = run_file_write_action(&context, &action).unwrap_err();

        assert!(error.message.contains("blocked"));
        assert!(!worktree.join(".env").exists());
    }
}
