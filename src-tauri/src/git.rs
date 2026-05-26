use std::{
    fs as std_fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    employees::Employee,
    events::{emit_employee_updated, emit_log, LogLevel},
    fs::resolve_existing_dir,
    processes::{configure_process_group, terminate_process_tree},
    AppState,
};

const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;
const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub employee_id: String,
    pub has_worktree: bool,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub is_repo: bool,
    pub dirty: bool,
    pub changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReview {
    pub employee_id: String,
    pub worktree_path: String,
    pub branch_name: Option<String>,
    pub status: Vec<String>,
    pub unstaged_diff: String,
    pub staged_diff: String,
    pub untracked_files: Vec<String>,
}

#[tauri::command]
pub fn git_is_repo(state: State<'_, AppState>, path: Option<String>) -> bool {
    let root = match path {
        Some(path) if !path.trim().is_empty() => {
            match resolve_existing_dir(&state.workspace_root, &path) {
                Ok(path) => path,
                Err(_) => return false,
            }
        }
        _ => state.workspace_root.clone(),
    };

    git_success(&root, &["rev-parse", "--show-toplevel"])
}

#[tauri::command]
pub fn git_worktree_create_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    if !git_success(&state.workspace_root, &["rev-parse", "--show-toplevel"]) {
        return Err("workspace root is not a git repository".to_string());
    }

    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    if employee.worktree_path.is_some() {
        return Err("employee already has a worktree".to_string());
    }

    let worktree_root = state.workspace_root.join(".slavey").join("worktrees");
    std_fs::create_dir_all(&worktree_root).map_err(|error| error.to_string())?;
    if ensure_slavey_excluded(&state.workspace_root)? {
        emit_log(&app, LogLevel::Info, "added .slavey/ to .git/info/exclude");
    }

    let worktree_path = worktree_root.join(&employee.id);
    if worktree_path.exists() {
        return Err(format!(
            "worktree path already exists: {}",
            worktree_path.display()
        ));
    }

    let branch_name = branch_name_for_employee(&employee);
    if git_success(
        &state.workspace_root,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch_name}"),
        ],
    ) {
        return Err(format!("branch already exists: {branch_name}"));
    }

    run_git(
        &state.workspace_root,
        &[
            "worktree",
            "add",
            "-b",
            &branch_name,
            path_to_str(&worktree_path)?,
            "HEAD",
        ],
    )?;

    let canonical_worktree = worktree_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let updated = state
        .employees
        .update(&employee_id, |employee| {
            let path = canonical_worktree.to_string_lossy().to_string();
            employee.worktree_path = Some(path.clone());
            employee.branch_name = Some(branch_name.clone());
            employee.cwd = path;
        })
        .ok_or_else(|| "employee not found".to_string())?;
    state.persist()?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("created worktree {} for {}", branch_name, updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    Ok(updated)
}

#[tauri::command]
pub fn git_worktree_status_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeStatus, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let Some(worktree_path) = employee.worktree_path.clone() else {
        return Ok(WorktreeStatus {
            employee_id,
            has_worktree: false,
            worktree_path: None,
            branch_name: employee.branch_name,
            is_repo: false,
            dirty: false,
            changes: Vec::new(),
        });
    };

    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
    let is_repo = git_success(&path, &["rev-parse", "--show-toplevel"]);
    let changes = if is_repo {
        parse_status_lines(&run_git(&path, &["status", "--porcelain"])?)
    } else {
        Vec::new()
    };
    let dirty = !changes.is_empty();

    Ok(WorktreeStatus {
        employee_id,
        has_worktree: true,
        worktree_path: Some(path.to_string_lossy().to_string()),
        branch_name: employee.branch_name,
        is_repo,
        dirty,
        changes,
    })
}

#[tauri::command]
pub fn git_worktree_remove_for_employee(
    app: AppHandle,
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Employee, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let Some(worktree_path) = employee.worktree_path else {
        return Ok(employee);
    };

    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
    let changes = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    if !changes.is_empty() {
        return Err(
            "worktree has uncommitted changes; review or discard before removing".to_string(),
        );
    }

    // TODO: add a deliberate force-remove path behind a git_operation approval.
    run_git(
        &state.workspace_root,
        &["worktree", "remove", path_to_str(&path)?],
    )?;

    let updated = state
        .employees
        .update(&employee_id, |employee| {
            employee.worktree_path = None;
            employee.branch_name = None;
            employee.cwd = state.workspace_root.to_string_lossy().to_string();
        })
        .ok_or_else(|| "employee not found".to_string())?;
    state.persist()?;

    emit_log(
        &app,
        LogLevel::Info,
        format!("removed worktree for {}", updated.name),
    );
    emit_employee_updated(&app, updated.clone());
    Ok(updated)
}

#[tauri::command]
pub fn git_worktree_diff_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<String, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let worktree_path = employee
        .worktree_path
        .ok_or_else(|| "employee has no worktree".to_string())?;
    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
    run_git(&path, &["diff"])
}

#[tauri::command]
pub fn git_worktree_review_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<WorktreeReview, String> {
    let employee = state
        .employees
        .get(&employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let worktree_path = employee
        .worktree_path
        .ok_or_else(|| "employee has no worktree".to_string())?;
    let path = resolve_existing_dir(&state.workspace_root, &worktree_path)?;
    let status = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    let untracked_files = parse_untracked_files(&status);

    Ok(WorktreeReview {
        employee_id,
        worktree_path: path.to_string_lossy().to_string(),
        branch_name: employee.branch_name,
        status,
        unstaged_diff: run_git(&path, &["diff"])?,
        staged_diff: run_git(&path, &["diff", "--cached"])?,
        untracked_files,
    })
}

#[tauri::command]
pub fn git_worktree_changed_files_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
) -> Result<Vec<String>, String> {
    let (path, _) = employee_worktree(&state, &employee_id)?;
    let status = parse_status_lines(&run_git(&path, &["status", "--porcelain"])?);
    Ok(parse_changed_files(&status))
}

#[tauri::command]
pub fn git_worktree_file_diff_for_employee(
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<String, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    let staged = run_git(&worktree, &["diff", "--cached", "--", &relative])?;
    let unstaged = run_git(&worktree, &["diff", "--", &relative])?;
    Ok(
        match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
            (true, true) => String::new(),
            (false, true) => format!("staged diff\n{staged}"),
            (true, false) => format!("unstaged diff\n{unstaged}"),
            (false, false) => format!("staged diff\n{staged}\nunstaged diff\n{unstaged}"),
        },
    )
}

#[tauri::command]
pub fn git_worktree_stage_file(
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    run_git(&worktree, &["add", "--", &relative])?;
    git_worktree_review_for_employee(state, employee_id)
}

#[tauri::command]
pub fn git_worktree_unstage_file(
    state: State<'_, AppState>,
    employee_id: String,
    path: String,
) -> Result<WorktreeReview, String> {
    let (worktree, _) = employee_worktree(&state, &employee_id)?;
    let relative = resolve_worktree_relative_path(&worktree, &path)?;
    run_git(&worktree, &["restore", "--staged", "--", &relative])?;
    git_worktree_review_for_employee(state, employee_id)
}

fn employee_worktree(
    state: &State<'_, AppState>,
    employee_id: &str,
) -> Result<(PathBuf, Option<String>), String> {
    let employee = state
        .employees
        .get(employee_id)
        .ok_or_else(|| "employee not found".to_string())?;
    let worktree_path = employee
        .worktree_path
        .ok_or_else(|| "employee has no worktree".to_string())?;
    Ok((
        resolve_existing_dir(&state.workspace_root, &worktree_path)?,
        employee.branch_name,
    ))
}

fn git_success(cwd: &Path, args: &[&str]) -> bool {
    bounded_git_output(cwd, args)
        .map(|output| output.success)
        .unwrap_or(false)
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = bounded_git_output(cwd, args)?;

    if output.success {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err("git command failed".to_string())
        } else {
            Err(stderr)
        }
    }
}

struct GitCommandOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

enum GitOutputChunk {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
}

fn bounded_git_output(cwd: &Path, args: &[&str]) -> Result<GitCommandOutput, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_process_tree(&mut child);
            return Err("failed to capture git stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_process_tree(&mut child);
            return Err("failed to capture git stderr".to_string());
        }
    };
    let (sender, receiver) = mpsc::sync_channel::<GitOutputChunk>(64);
    spawn_git_reader(stdout, sender.clone(), true);
    spawn_git_reader(stderr, sender, false);

    let deadline = Instant::now() + Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut total = 0_usize;

    loop {
        if let Err(error) = drain_git_output(&receiver, &mut stdout, &mut stderr, &mut total) {
            terminate_process_tree(&mut child);
            return Err(error);
        }

        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            drain_remaining_git_output(&receiver, &mut stdout, &mut stderr, &mut total)?;
            return Ok(GitCommandOutput {
                success: status.success(),
                stdout,
                stderr,
            });
        }

        if Instant::now() >= deadline {
            terminate_process_tree(&mut child);
            let _ = drain_remaining_git_output(&receiver, &mut stdout, &mut stderr, &mut total);
            return Err(format!(
                "git command timed out after {GIT_COMMAND_TIMEOUT_SECS} seconds"
            ));
        }

        thread::sleep(Duration::from_millis(20));
    }
}

fn spawn_git_reader<R>(mut reader: R, sender: SyncSender<GitOutputChunk>, stdout: bool)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let chunk = if stdout {
                        GitOutputChunk::Stdout(buffer[..read].to_vec())
                    } else {
                        GitOutputChunk::Stderr(buffer[..read].to_vec())
                    };
                    if sender.send(chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_git_output(
    receiver: &Receiver<GitOutputChunk>,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    total: &mut usize,
) -> Result<(), String> {
    loop {
        match receiver.try_recv() {
            Ok(chunk) => append_git_output(stdout, stderr, total, chunk)?,
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return Ok(()),
        }
    }
}

fn drain_remaining_git_output(
    receiver: &Receiver<GitOutputChunk>,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    total: &mut usize,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => append_git_output(stdout, stderr, total, chunk)?,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn append_git_output(
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    total: &mut usize,
    chunk: GitOutputChunk,
) -> Result<(), String> {
    let bytes = match &chunk {
        GitOutputChunk::Stdout(bytes) | GitOutputChunk::Stderr(bytes) => bytes,
    };
    if total.saturating_add(bytes.len()) > MAX_GIT_OUTPUT_BYTES {
        return Err(format!(
            "git command output exceeded {} bytes",
            MAX_GIT_OUTPUT_BYTES
        ));
    }
    *total += bytes.len();
    match chunk {
        GitOutputChunk::Stdout(bytes) => stdout.extend_from_slice(&bytes),
        GitOutputChunk::Stderr(bytes) => stderr.extend_from_slice(&bytes),
    }
    Ok(())
}

fn ensure_slavey_excluded(repo_root: &Path) -> Result<bool, String> {
    let exclude_path_output = run_git(repo_root, &["rev-parse", "--git-path", "info/exclude"])?;
    let raw_path = PathBuf::from(exclude_path_output.trim());
    let exclude_path = if raw_path.is_absolute() {
        raw_path
    } else {
        repo_root.join(raw_path)
    };

    if let Some(parent) = exclude_path.parent() {
        std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = std_fs::read_to_string(&exclude_path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ".slavey/") {
        return Ok(false);
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(".slavey/\n");
    std_fs::write(&exclude_path, next).map_err(|error| error.to_string())?;
    Ok(true)
}

fn parse_status_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(ToString::to_string)
        .collect()
}

fn parse_untracked_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter_map(|line| line.strip_prefix("?? "))
        .map(ToString::to_string)
        .collect()
}

fn parse_changed_files(status: &[String]) -> Vec<String> {
    status
        .iter()
        .filter_map(|line| parse_status_path(line))
        .collect()
}

fn parse_status_path(line: &str) -> Option<String> {
    if line.len() < 4 {
        return None;
    }
    let path = &line[3..];
    if let Some((_, to)) = path.split_once(" -> ") {
        Some(to.to_string())
    } else {
        Some(path.to_string())
    }
}

fn resolve_worktree_relative_path(worktree: &Path, input: &str) -> Result<String, String> {
    let input_path = PathBuf::from(input);
    if input_path.is_absolute() {
        let resolved = if input_path.exists() {
            input_path
                .canonicalize()
                .map_err(|error| error.to_string())?
        } else {
            return Err("absolute path must exist inside the worktree".to_string());
        };
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let candidate = worktree.join(input_path);
    if candidate.exists() {
        let resolved = candidate
            .canonicalize()
            .map_err(|error| error.to_string())?;
        ensure_path_inside(worktree, &resolved)?;
        return path_to_str(
            resolved
                .strip_prefix(worktree)
                .map_err(|_| "path is outside the worktree".to_string())?,
        )
        .map(ToString::to_string);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_path_inside(worktree, &parent)?;
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    let resolved = parent.join(file_name);
    ensure_path_inside(worktree, &resolved)?;
    path_to_str(
        resolved
            .strip_prefix(worktree)
            .map_err(|_| "path is outside the worktree".to_string())?,
    )
    .map(ToString::to_string)
}

fn ensure_path_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("path is outside the worktree".to_string())
    }
}

fn branch_name_for_employee(employee: &Employee) -> String {
    let sanitized = sanitize_branch_component(&employee.name);
    let fallback = employee.id.chars().take(8).collect::<String>();
    if sanitized.is_empty() {
        format!("slavey/{fallback}")
    } else {
        format!("slavey/{sanitized}-{fallback}")
    }
}

fn sanitize_branch_component(input: &str) -> String {
    input
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if matches!(character, '-' | '_' | ' ' | '.') {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn path_to_str(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| "path is not valid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        append_git_output, parse_changed_files, parse_status_lines, parse_untracked_files,
        GitOutputChunk, MAX_GIT_OUTPUT_BYTES,
    };

    #[test]
    fn status_parser_detects_clean_output() {
        assert!(parse_status_lines("").is_empty());
        assert!(parse_status_lines("\n\n").is_empty());
    }

    #[test]
    fn status_parser_keeps_dirty_lines() {
        let changes = parse_status_lines(" M src/main.rs\n?? new.txt\n");
        assert_eq!(changes, vec![" M src/main.rs", "?? new.txt"]);
    }

    #[test]
    fn untracked_parser_extracts_only_untracked_paths() {
        let changes =
            parse_status_lines(" M src/main.rs\nA  staged.rs\n?? new.txt\n?? dir/file.rs\n");

        assert_eq!(
            parse_untracked_files(&changes),
            vec!["new.txt".to_string(), "dir/file.rs".to_string()]
        );
    }

    #[test]
    fn changed_file_parser_handles_renames_and_untracked_files() {
        let changes = parse_status_lines(" M src/main.rs\nR  old.rs -> new.rs\n?? scratch.txt\n");

        assert_eq!(
            parse_changed_files(&changes),
            vec![
                "src/main.rs".to_string(),
                "new.rs".to_string(),
                "scratch.txt".to_string()
            ]
        );
    }

    #[test]
    fn git_output_limit_is_enforced() {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut total = MAX_GIT_OUTPUT_BYTES;

        let error = append_git_output(
            &mut stdout,
            &mut stderr,
            &mut total,
            GitOutputChunk::Stdout(vec![b'x']),
        )
        .unwrap_err();

        assert!(error.contains("git command output exceeded"));
    }

    #[test]
    fn git_output_appends_stdout_and_stderr() {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut total = 0;

        append_git_output(
            &mut stdout,
            &mut stderr,
            &mut total,
            GitOutputChunk::Stdout(b"out".to_vec()),
        )
        .unwrap();
        append_git_output(
            &mut stdout,
            &mut stderr,
            &mut total,
            GitOutputChunk::Stderr(b"err".to_vec()),
        )
        .unwrap();

        assert_eq!(stdout, b"out");
        assert_eq!(stderr, b"err");
        assert_eq!(total, 6);
    }
}
