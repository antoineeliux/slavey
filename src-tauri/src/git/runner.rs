use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    thread,
    time::{Duration, Instant},
};

use crate::processes::{configure_process_group, terminate_process_tree};

const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;
const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;

pub(super) struct GitCommandOutput {
    pub(super) success: bool,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
}

enum GitOutputChunk {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
}

pub(crate) fn git_success(cwd: &Path, args: &[&str]) -> bool {
    bounded_git_output(cwd, args)
        .map(|output| output.success)
        .unwrap_or(false)
}

pub(crate) fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
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

pub(super) fn bounded_git_output(cwd: &Path, args: &[&str]) -> Result<GitCommandOutput, String> {
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

#[cfg(test)]
mod tests {
    use super::{append_git_output, GitOutputChunk, MAX_GIT_OUTPUT_BYTES};

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
