use std::{
    collections::HashMap,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    actions::ActionManager,
    approvals::ApprovalManager,
    employees::{resolve_employee_execution_dir, EmployeeManager},
    events::{emit_log, emit_process_log, emit_process_updated, now_ms, LogLevel},
    fs::resolve_existing_dir,
    persistence::{AppStateSnapshotInput, PersistenceManager},
    read_workspace_root,
    terminal::TerminalSessionStore,
    AppState, WorkspaceRootHandle,
};

const MAX_PROCESS_LOG_BYTES: usize = 1024 * 1024;
const PROCESS_LOG_PERSIST_INTERVAL_MS: u64 = 2_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedProcessStatus {
    Running,
    Exited,
    Failed,
    Killed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProcess {
    pub id: String,
    pub employee_id: Option<String>,
    pub title: String,
    pub command: String,
    pub cwd: String,
    pub status: ManagedProcessStatus,
    pub exit_code: Option<i32>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSpawnRequest {
    pub employee_id: Option<String>,
    pub title: String,
    pub command: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLogs {
    pub process_id: String,
    pub base_offset: u64,
    pub next_offset: u64,
    pub contents: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLogSnapshot {
    pub process_id: String,
    pub base_offset: u64,
    pub next_offset: u64,
    pub contents: String,
}

struct RunningProcess {
    child: Arc<Mutex<Child>>,
    killed: Arc<AtomicBool>,
}

#[derive(Default)]
struct LogRing {
    base_offset: u64,
    next_offset: u64,
    contents: Vec<u8>,
}

struct PersistThrottle {
    interval: Duration,
    last_persisted_at: Instant,
}

impl PersistThrottle {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_persisted_at: Instant::now(),
        }
    }

    fn should_persist(&mut self) -> bool {
        self.should_persist_at(Instant::now())
    }

    fn should_persist_at(&mut self, now: Instant) -> bool {
        if now.duration_since(self.last_persisted_at) >= self.interval {
            self.last_persisted_at = now;
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Default)]
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    running: Arc<Mutex<HashMap<String, RunningProcess>>>,
    logs: Arc<Mutex<HashMap<String, LogRing>>>,
}

impl ProcessManager {
    fn create(&self, request: ProcessSpawnRequest, cwd: PathBuf) -> ManagedProcess {
        let now = now_ms();
        let process = ManagedProcess {
            id: Uuid::new_v4().to_string(),
            employee_id: request.employee_id,
            title: request.title,
            command: request.command,
            cwd: cwd.to_string_lossy().to_string(),
            status: ManagedProcessStatus::Running,
            exit_code: None,
            created_at: now,
            updated_at: now,
        };
        self.processes
            .lock()
            .insert(process.id.clone(), process.clone());
        self.logs.lock().entry(process.id.clone()).or_default();
        process
    }

    pub fn list(&self) -> Vec<ManagedProcess> {
        let mut processes = self.processes.lock().values().cloned().collect::<Vec<_>>();
        processes.sort_by_key(|process| process.created_at);
        processes
    }

    pub fn has_running(&self) -> bool {
        !self.running.lock().is_empty()
            || self
                .processes
                .lock()
                .values()
                .any(|process| process.status == ManagedProcessStatus::Running)
    }

    pub fn replace_all(&self, processes: Vec<ManagedProcess>, logs: Vec<ProcessLogSnapshot>) {
        let mut restored_logs = restore_process_logs(&logs);
        let restored_processes = restore_managed_processes(&processes);
        for process in processes
            .iter()
            .filter(|process| process.status == ManagedProcessStatus::Running)
        {
            append_to_log_ring(
                restored_logs.entry(process.id.clone()).or_default(),
                b"app restarted before process completed\n",
            );
        }

        let mut next_processes = HashMap::new();
        for process in restored_processes {
            next_processes.insert(process.id.clone(), process);
        }
        *self.processes.lock() = next_processes;
        *self.logs.lock() = restored_logs;
        self.running.lock().clear();
    }

    pub fn clear(&self) {
        self.processes.lock().clear();
        self.running.lock().clear();
        self.logs.lock().clear();
    }

    pub fn log_snapshots(&self) -> Vec<ProcessLogSnapshot> {
        let mut snapshots = self
            .logs
            .lock()
            .iter()
            .map(|(process_id, ring)| ProcessLogSnapshot {
                process_id: process_id.clone(),
                base_offset: ring.base_offset,
                next_offset: ring.next_offset,
                contents: String::from_utf8_lossy(&ring.contents).to_string(),
            })
            .collect::<Vec<_>>();
        snapshots.sort_by(|a, b| a.process_id.cmp(&b.process_id));
        snapshots
    }

    fn update_status(
        &self,
        process_id: &str,
        status: ManagedProcessStatus,
        exit_code: Option<i32>,
    ) -> Option<ManagedProcess> {
        let mut processes = self.processes.lock();
        let process = processes.get_mut(process_id)?;
        process.status = status;
        process.exit_code = exit_code;
        process.updated_at = now_ms();
        Some(process.clone())
    }

    fn append_log(&self, process_id: &str, bytes: &[u8]) -> Option<ProcessLogs> {
        let mut logs = self.logs.lock();
        let ring = logs.entry(process_id.to_string()).or_default();
        append_to_log_ring(ring, bytes);
        Some(ProcessLogs {
            process_id: process_id.to_string(),
            base_offset: ring.base_offset,
            next_offset: ring.next_offset,
            contents: String::from_utf8_lossy(bytes).to_string(),
            truncated: false,
        })
    }

    fn logs_from(&self, process_id: &str, offset: Option<u64>) -> Option<ProcessLogs> {
        let logs = self.logs.lock();
        let ring = logs.get(process_id)?;
        let requested = offset.unwrap_or(ring.base_offset);
        let start = requested.max(ring.base_offset);
        let index = start.saturating_sub(ring.base_offset) as usize;
        let contents = if index <= ring.contents.len() {
            String::from_utf8_lossy(&ring.contents[index..]).to_string()
        } else {
            String::new()
        };
        Some(ProcessLogs {
            process_id: process_id.to_string(),
            base_offset: ring.base_offset,
            next_offset: ring.next_offset,
            contents,
            truncated: requested < ring.base_offset,
        })
    }

    fn register_running(
        &self,
        process_id: &str,
        child: Arc<Mutex<Child>>,
        killed: Arc<AtomicBool>,
    ) {
        self.running
            .lock()
            .insert(process_id.to_string(), RunningProcess { child, killed });
    }

    fn kill(&self, process_id: &str) -> Result<ManagedProcess, String> {
        let running = self
            .running
            .lock()
            .remove(process_id)
            .ok_or_else(|| "process is not running".to_string())?;
        running.killed.store(true, Ordering::SeqCst);
        terminate_process_tree(&mut running.child.lock());
        self.update_status(process_id, ManagedProcessStatus::Killed, None)
            .ok_or_else(|| "process not found".to_string())
    }
}

#[derive(Clone)]
struct ProcessPersistContext {
    workspace_root: WorkspaceRootHandle,
    employees: EmployeeManager,
    actions: ActionManager,
    approvals: ApprovalManager,
    processes: ProcessManager,
    terminal_sessions: TerminalSessionStore,
    persistence: PersistenceManager,
}

#[tauri::command]
pub fn process_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ProcessSpawnRequest,
) -> Result<ManagedProcess, String> {
    if payload.title.trim().is_empty() {
        return Err("process title is required".to_string());
    }
    if payload.command.trim().is_empty() {
        return Err("process command is required".to_string());
    }
    let employee = match payload.employee_id.as_deref() {
        Some(employee_id) => Some(
            state
                .employees
                .get(employee_id)
                .ok_or_else(|| "employee not found".to_string())?,
        ),
        None => None,
    };

    let workspace_root = state.workspace_root();
    let cwd = match (payload.cwd.as_deref(), employee.as_ref()) {
        (Some(cwd), Some(employee)) if !cwd.trim().is_empty() => {
            resolve_employee_execution_dir(&workspace_root, employee, Some(cwd))?
        }
        (Some(cwd), None) if !cwd.trim().is_empty() => resolve_existing_dir(&workspace_root, cwd)?,
        (_, Some(employee)) => resolve_employee_execution_dir(&workspace_root, employee, None)?,
        _ => workspace_root.clone(),
    };

    let mut command = shell_command(&payload.command);
    command
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_process_tree(&mut child);
            return Err("failed to capture stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_process_tree(&mut child);
            return Err("failed to capture stderr".to_string());
        }
    };

    let process = state.processes.create(payload, cwd);
    let child = Arc::new(Mutex::new(child));
    let killed = Arc::new(AtomicBool::new(false));
    state
        .processes
        .register_running(&process.id, Arc::clone(&child), Arc::clone(&killed));
    let persist_context = ProcessPersistContext {
        workspace_root: state.workspace_root_handle(),
        employees: state.employees.clone(),
        actions: state.actions.clone(),
        approvals: state.approvals.clone(),
        processes: state.processes.clone(),
        terminal_sessions: state.terminal_sessions.clone(),
        persistence: state.persistence.clone(),
    };

    spawn_log_reader(
        app.clone(),
        state.processes.clone(),
        process.id.clone(),
        stdout,
        persist_context.clone(),
    );
    spawn_log_reader(
        app.clone(),
        state.processes.clone(),
        process.id.clone(),
        stderr,
        persist_context.clone(),
    );

    let processes = state.processes.clone();
    let process_id = process.id.clone();
    let wait_app = app.clone();
    let wait_persist_context = persist_context.clone();
    thread::spawn(move || {
        let status = child.lock().wait();
        processes.running.lock().remove(&process_id);
        if killed.load(Ordering::SeqCst) {
            return;
        }

        let updated = match status {
            Ok(status) if status.success() => {
                processes.update_status(&process_id, ManagedProcessStatus::Exited, status.code())
            }
            Ok(status) => {
                processes.update_status(&process_id, ManagedProcessStatus::Failed, status.code())
            }
            Err(_) => processes.update_status(&process_id, ManagedProcessStatus::Failed, None),
        };
        if let Some(updated) = updated {
            emit_process_updated(&wait_app, updated);
            persist_process_snapshot_or_log(&wait_app, &wait_persist_context);
        }
    });

    emit_process_updated(&app, process.clone());
    emit_log(
        &app,
        LogLevel::Info,
        format!("spawned process {}", process.title),
    );
    persist_or_log(&app, &state);
    Ok(process)
}

#[tauri::command]
pub fn process_list(state: State<'_, AppState>) -> Vec<ManagedProcess> {
    state.processes.list()
}

#[tauri::command]
pub fn process_logs(
    state: State<'_, AppState>,
    process_id: String,
    offset: Option<u64>,
) -> Result<ProcessLogs, String> {
    state
        .processes
        .logs_from(&process_id, offset)
        .ok_or_else(|| "process logs not found".to_string())
}

#[tauri::command]
pub fn process_kill(
    app: AppHandle,
    state: State<'_, AppState>,
    process_id: String,
) -> Result<ManagedProcess, String> {
    let updated = state.processes.kill(&process_id)?;
    emit_process_updated(&app, updated.clone());
    emit_log(
        &app,
        LogLevel::Info,
        format!("killed process {}", updated.title),
    );
    persist_or_log(&app, &state);
    Ok(updated)
}

fn spawn_log_reader<R>(
    app: AppHandle,
    processes: ProcessManager,
    process_id: String,
    mut reader: R,
    persist_context: ProcessPersistContext,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut persist_throttle =
            PersistThrottle::new(Duration::from_millis(PROCESS_LOG_PERSIST_INTERVAL_MS));
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if let Some(payload) = processes.append_log(&process_id, &buffer[..read]) {
                        emit_process_log(&app, payload);
                        if persist_throttle.should_persist() {
                            persist_process_snapshot_or_log(&app, &persist_context);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        persist_process_snapshot_or_log(&app, &persist_context);
    });
}

pub fn restore_managed_processes(processes: &[ManagedProcess]) -> Vec<ManagedProcess> {
    processes
        .iter()
        .cloned()
        .map(|mut process| {
            if process.status == ManagedProcessStatus::Running {
                process.status = ManagedProcessStatus::Failed;
                process.exit_code = None;
                process.updated_at = now_ms();
            }
            process
        })
        .collect()
}

fn restore_process_logs(logs: &[ProcessLogSnapshot]) -> HashMap<String, LogRing> {
    let mut restored = HashMap::new();
    for log in logs {
        let mut ring = LogRing {
            base_offset: log.base_offset,
            next_offset: log.base_offset,
            contents: Vec::new(),
        };
        append_to_log_ring(&mut ring, log.contents.as_bytes());
        if log.next_offset > ring.next_offset {
            ring.next_offset = log.next_offset;
            let expected_base = ring.next_offset.saturating_sub(ring.contents.len() as u64);
            ring.base_offset = ring.base_offset.max(expected_base);
        }
        restored.insert(log.process_id.clone(), ring);
    }
    restored
}

fn append_to_log_ring(ring: &mut LogRing, bytes: &[u8]) {
    ring.contents.extend_from_slice(bytes);
    ring.next_offset = ring.next_offset.saturating_add(bytes.len() as u64);
    if ring.contents.len() > MAX_PROCESS_LOG_BYTES {
        let overflow = ring.contents.len() - MAX_PROCESS_LOG_BYTES;
        ring.contents.drain(..overflow);
        ring.base_offset = ring.base_offset.saturating_add(overflow as u64);
    }
}

fn persist_process_snapshot_or_log(app: &AppHandle, context: &ProcessPersistContext) {
    if let Err(error) = persist_process_snapshot(context) {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist process state: {error}"),
        );
    }
}

fn persist_process_snapshot(context: &ProcessPersistContext) -> Result<(), String> {
    let workspace_root = read_workspace_root(&context.workspace_root);
    context.persistence.save(AppStateSnapshotInput {
        workspace_root,
        employees: context.employees.list(),
        terminal_sessions: context.terminal_sessions.list(None),
        actions: context.actions.list(),
        approvals: context.approvals.list(),
        processes: context.processes.list(),
        process_logs: context.processes.log_snapshots(),
    })
}

fn persist_or_log(app: &AppHandle, state: &State<'_, AppState>) {
    if let Err(error) = state.persist() {
        emit_log(
            app,
            LogLevel::Warn,
            format!("failed to persist app state: {error}"),
        );
    }
}

pub fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut process = Command::new("cmd.exe");
        process.args(["/C", command]);
        process
    }

    #[cfg(not(windows))]
    {
        let mut process = Command::new("/bin/sh");
        process.args(["-lc", command]);
        process
    }
}

pub fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        let _ = command;
        // TODO: use Windows Job Objects for full process-tree cleanup. For now,
        // process_kill terminates the direct child process only on Windows.
    }
}

pub fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let pgid = unix_process_group_signal_pid(child.id());
        unsafe {
            let _ = kill(pgid, SIGTERM);
        }
        thread::sleep(Duration::from_millis(150));
        if child.try_wait().ok().flatten().is_none() {
            unsafe {
                let _ = kill(pgid, SIGKILL);
            }
        }
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        // TODO: replace this with Job Object based process-tree termination.
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(unix)]
fn unix_process_group_signal_pid(pid: u32) -> i32 {
    -(pid as i32)
}

#[cfg(unix)]
const SIGTERM: i32 = 15;
#[cfg(unix)]
const SIGKILL: i32 = 9;

#[cfg(unix)]
unsafe extern "C" {
    fn setsid() -> i32;
    fn kill(pid: i32, sig: i32) -> i32;
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{Duration, Instant},
    };

    use super::{
        ManagedProcessStatus, PersistThrottle, ProcessLogSnapshot, ProcessManager,
        ProcessSpawnRequest, MAX_PROCESS_LOG_BYTES,
    };

    #[cfg(unix)]
    #[test]
    fn unix_process_group_signal_pid_is_negative_child_pid() {
        assert_eq!(super::unix_process_group_signal_pid(42), -42);
    }

    #[test]
    fn process_manager_updates_status() {
        let manager = ProcessManager::default();
        let process = manager.create(
            ProcessSpawnRequest {
                employee_id: Some("employee-1".to_string()),
                title: "Test".to_string(),
                command: "echo ok".to_string(),
                cwd: None,
            },
            PathBuf::from("/tmp"),
        );

        let updated = manager
            .update_status(&process.id, ManagedProcessStatus::Exited, Some(0))
            .unwrap();

        assert_eq!(updated.status, ManagedProcessStatus::Exited);
        assert_eq!(updated.exit_code, Some(0));
    }

    #[test]
    fn process_log_ring_is_bounded() {
        let manager = ProcessManager::default();
        let process = manager.create(
            ProcessSpawnRequest {
                employee_id: None,
                title: "Logs".to_string(),
                command: "echo ok".to_string(),
                cwd: None,
            },
            PathBuf::from("/tmp"),
        );
        let bytes = vec![b'x'; MAX_PROCESS_LOG_BYTES + 10];

        manager.append_log(&process.id, &bytes);
        let logs = manager.logs_from(&process.id, Some(0)).unwrap();

        assert!(logs.truncated);
        assert_eq!(logs.contents.len(), MAX_PROCESS_LOG_BYTES);
    }

    #[test]
    fn restore_running_process_as_failed_with_restart_log() {
        let manager = ProcessManager::default();
        let mut process = manager.create(
            ProcessSpawnRequest {
                employee_id: Some("employee-1".to_string()),
                title: "Long task".to_string(),
                command: "sleep 999".to_string(),
                cwd: None,
            },
            PathBuf::from("/tmp"),
        );
        process.status = ManagedProcessStatus::Running;

        manager.replace_all(vec![process.clone()], Vec::new());
        let restored = manager.list();
        let logs = manager.logs_from(&process.id, None).unwrap();

        assert_eq!(restored[0].status, ManagedProcessStatus::Failed);
        assert!(logs
            .contents
            .contains("app restarted before process completed"));
    }

    #[test]
    fn restored_process_logs_remain_capped() {
        let manager = ProcessManager::default();
        let contents = "x".repeat(MAX_PROCESS_LOG_BYTES + 50);

        manager.replace_all(
            Vec::new(),
            vec![ProcessLogSnapshot {
                process_id: "process-1".to_string(),
                base_offset: 0,
                next_offset: contents.len() as u64,
                contents,
            }],
        );
        let logs = manager.logs_from("process-1", Some(0)).unwrap();

        assert!(logs.truncated);
        assert_eq!(logs.contents.len(), MAX_PROCESS_LOG_BYTES);
    }

    #[test]
    fn log_snapshots_are_capped() {
        let manager = ProcessManager::default();
        let process = manager.create(
            ProcessSpawnRequest {
                employee_id: None,
                title: "Logs".to_string(),
                command: "echo ok".to_string(),
                cwd: None,
            },
            PathBuf::from("/tmp"),
        );
        manager.append_log(&process.id, &vec![b'x'; MAX_PROCESS_LOG_BYTES + 128]);

        let snapshots = manager.log_snapshots();

        assert_eq!(snapshots[0].contents.len(), MAX_PROCESS_LOG_BYTES);
        assert_eq!(
            snapshots[0].next_offset,
            (MAX_PROCESS_LOG_BYTES + 128) as u64
        );
    }

    #[test]
    fn persist_throttle_waits_for_interval() {
        let start = Instant::now();
        let mut throttle = PersistThrottle {
            interval: Duration::from_secs(2),
            last_persisted_at: start,
        };

        assert!(!throttle.should_persist_at(start + Duration::from_millis(500)));
        assert!(throttle.should_persist_at(start + Duration::from_secs(2)));
        assert!(!throttle.should_persist_at(start + Duration::from_secs(3)));
        assert!(throttle.should_persist_at(start + Duration::from_secs(4)));
    }
}
