use std::{
    io::Read,
    process::{Child, Command as ProcessCommand, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use super::CodexCliStatus;
use crate::processes::{configure_process_group, terminate_process_tree};

const CODEX_STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const CODEX_STATUS_STDOUT_CAP: usize = 8 * 1024;
const CODEX_STATUS_STDERR_CAP: usize = 8 * 1024;
const COMMAND_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(100);

pub fn codex_cli_status_impl() -> CodexCliStatus {
    let mut command = ProcessCommand::new("codex");
    command.arg("--version");
    command.env("CI", "true");
    command.env("NO_COLOR", "1");
    command.env("TERM", "dumb");

    match run_bounded_command(
        command,
        CODEX_STATUS_TIMEOUT,
        CODEX_STATUS_STDOUT_CAP,
        CODEX_STATUS_STDERR_CAP,
    ) {
        Ok(output) => codex_status_from_output(output),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI not found".to_string(),
        },
        Err(error) => CodexCliStatus {
            available: false,
            version: None,
            message: codex_status_error_message(error.kind()),
        },
    }
}

#[derive(Debug, Clone)]
struct BoundedCommandOutput {
    status_code: Option<i32>,
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandOutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
struct CommandOutputChunk {
    stream: CommandOutputStream,
    bytes: Vec<u8>,
}

fn run_bounded_command(
    mut command: ProcessCommand,
    timeout: Duration,
    stdout_cap: usize,
    stderr_cap: usize,
) -> std::io::Result<BoundedCommandOutput> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);

    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("failed to capture stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("failed to capture stderr"))?;
    let (sender, receiver) = mpsc::channel();
    spawn_command_output_reader(stdout, CommandOutputStream::Stdout, sender.clone());
    spawn_command_output_reader(stderr, CommandOutputStream::Stderr, sender);

    let deadline = Instant::now() + timeout;
    let mut output = BoundedCommandOutput {
        status_code: None,
        success: false,
        stdout: Vec::new(),
        stderr: Vec::new(),
        timed_out: false,
        stdout_truncated: false,
        stderr_truncated: false,
    };

    loop {
        drain_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
        if let Some(status) = child.try_wait()? {
            output.status_code = status.code();
            output.success = status.success();
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        if output.stdout_truncated || output.stderr_truncated {
            terminate_status_child(&mut child);
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        let now = Instant::now();
        if now >= deadline {
            output.timed_out = true;
            terminate_status_child(&mut child);
            drain_remaining_command_output(&receiver, &mut output, stdout_cap, stderr_cap);
            return Ok(output);
        }

        let remaining = deadline.saturating_duration_since(now);
        let wait = remaining.min(Duration::from_millis(20));
        match receiver.recv_timeout(wait) {
            Ok(chunk) => append_command_output(&mut output, chunk, stdout_cap, stderr_cap),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
    }
}

fn spawn_command_output_reader<R>(
    mut reader: R,
    stream: CommandOutputStream,
    sender: mpsc::Sender<CommandOutputChunk>,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if sender
                        .send(CommandOutputChunk {
                            stream,
                            bytes: buffer[..read].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_command_output(
    receiver: &mpsc::Receiver<CommandOutputChunk>,
    output: &mut BoundedCommandOutput,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    while let Ok(chunk) = receiver.try_recv() {
        append_command_output(output, chunk, stdout_cap, stderr_cap);
    }
}

fn drain_remaining_command_output(
    receiver: &mpsc::Receiver<CommandOutputChunk>,
    output: &mut BoundedCommandOutput,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    let deadline = Instant::now() + COMMAND_OUTPUT_DRAIN_TIMEOUT;
    loop {
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(chunk) => append_command_output(output, chunk, stdout_cap, stderr_cap),
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn append_command_output(
    output: &mut BoundedCommandOutput,
    chunk: CommandOutputChunk,
    stdout_cap: usize,
    stderr_cap: usize,
) {
    match chunk.stream {
        CommandOutputStream::Stdout => {
            append_capped_bytes(
                &mut output.stdout,
                &chunk.bytes,
                stdout_cap,
                &mut output.stdout_truncated,
            );
        }
        CommandOutputStream::Stderr => {
            append_capped_bytes(
                &mut output.stderr,
                &chunk.bytes,
                stderr_cap,
                &mut output.stderr_truncated,
            );
        }
    }
}

fn append_capped_bytes(target: &mut Vec<u8>, bytes: &[u8], cap: usize, truncated: &mut bool) {
    if *truncated {
        return;
    }
    let remaining = cap.saturating_sub(target.len());
    if bytes.len() > remaining {
        target.extend_from_slice(&bytes[..remaining]);
        *truncated = true;
    } else {
        target.extend_from_slice(bytes);
    }
}

fn terminate_status_child(child: &mut Child) {
    terminate_process_tree(child);
}

fn codex_status_from_output(output: BoundedCommandOutput) -> CodexCliStatus {
    if output.timed_out {
        return CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI version check timed out".to_string(),
        };
    }

    if output.stdout_truncated || output.stderr_truncated {
        return CodexCliStatus {
            available: false,
            version: None,
            message: "Codex CLI version check produced too much output".to_string(),
        };
    }

    if output.success {
        let version =
            first_output_line(&output.stdout).or_else(|| first_output_line(&output.stderr));
        CodexCliStatus {
            available: true,
            version: version.clone(),
            message: version.unwrap_or_else(|| "Codex CLI is available".to_string()),
        }
    } else {
        CodexCliStatus {
            available: false,
            version: None,
            message: match output.status_code {
                Some(code) => format!("Codex CLI version check failed with exit code {code}"),
                None => "Codex CLI version check failed".to_string(),
            },
        }
    }
}

fn codex_status_error_message(kind: std::io::ErrorKind) -> String {
    match kind {
        std::io::ErrorKind::PermissionDenied => {
            "Codex CLI could not be executed due to permissions".to_string()
        }
        _ => "failed to check Codex CLI".to_string(),
    }
}

fn first_output_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command as ProcessCommand,
        time::{Duration, Instant},
    };

    use super::{
        append_capped_bytes, codex_status_from_output, run_bounded_command, BoundedCommandOutput,
    };

    #[test]
    fn codex_status_parses_successful_version_from_stdout() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: Some(0),
            success: true,
            stdout: b"codex 1.2.3\n".to_vec(),
            stderr: Vec::new(),
            timed_out: false,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(status.available);
        assert_eq!(status.version.as_deref(), Some("codex 1.2.3"));
    }

    #[test]
    fn codex_status_hides_failure_output() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: Some(2),
            success: false,
            stdout: Vec::new(),
            stderr: b"auth config path should not be surfaced\n".to_vec(),
            timed_out: false,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(!status.available);
        assert_eq!(
            status.message,
            "Codex CLI version check failed with exit code 2"
        );
    }

    #[test]
    fn codex_status_reports_timeout() {
        let status = codex_status_from_output(BoundedCommandOutput {
            status_code: None,
            success: false,
            stdout: Vec::new(),
            stderr: Vec::new(),
            timed_out: true,
            stdout_truncated: false,
            stderr_truncated: false,
        });

        assert!(!status.available);
        assert_eq!(status.message, "Codex CLI version check timed out");
    }

    #[test]
    fn capped_output_helper_truncates_without_growing_past_cap() {
        let mut target = b"abcd".to_vec();
        let mut truncated = false;

        append_capped_bytes(&mut target, b"efgh", 6, &mut truncated);

        assert_eq!(target, b"abcdef");
        assert!(truncated);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_command_times_out() {
        let mut command = ProcessCommand::new("/bin/sh");
        command.args(["-c", "sleep 2"]);
        let start = Instant::now();

        let output = run_bounded_command(command, Duration::from_millis(50), 1024, 1024).unwrap();

        assert!(output.timed_out);
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
