# Privacy

Slavey is designed as a local-first desktop app.

## Data Stored Locally

Slavey may store local application state such as workspace history, employee metadata, action state, process state, and UI preferences.

The project policy is to avoid persisting:

- secrets or credentials,
- environment variables,
- raw terminal output,
- raw process logs,
- raw file-write contents,
- private prompts.

## Diagnostics

Diagnostics are opt-in and local. Diagnostic exports are redacted and should omit raw terminal output, raw process logs, environment variables, credentials, tokens, and file-write contents.

Do not attach diagnostics publicly unless you have reviewed them and are comfortable sharing the contents.

## Network Activity

Slavey itself should not add telemetry without an explicit design review and documentation update.

External tools launched by users, such as package managers, Git, shells, or AI coding agents, may perform their own network requests according to their own configuration and policies.

## Reporting Privacy Issues

Report privacy or redaction issues through the security process in `SECURITY.md`.
