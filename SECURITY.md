# Security Policy

Slavey is a local desktop app that can run commands and edit files in a selected workspace. Security reports are treated as high priority.

## Supported Versions

The `main` branch and the latest tagged release are supported. Older releases may receive fixes case by case while the project is pre-1.0.

## Reporting a Vulnerability

Please do not open a public issue with exploit details.

Preferred reporting path:

1. Use GitHub private vulnerability reporting for this repository if it is enabled.
2. If private reporting is unavailable, open a public issue asking for a secure contact path, but do not include reproduction details, secrets, logs, or exploit code.

Useful reports include:

- affected version or commit,
- operating system,
- clear reproduction steps,
- expected and actual behavior,
- impact assessment,
- whether the issue is already public.

## Security Scope

High-priority areas include:

- workspace path escape,
- command execution without explicit user intent,
- persistence of secrets, environment variables, raw terminal output, raw process logs, or file-write contents,
- unsafe Tauri permissions,
- diagnostics redaction failures,
- dependency-chain vulnerabilities that affect runtime behavior.

## Disclosure

Maintainers will acknowledge valid reports, investigate, and coordinate a fix before public disclosure when practical. Do not use a vulnerability to access, modify, or exfiltrate data that does not belong to you.
