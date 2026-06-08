# Slavey

Slavey is a local desktop app for managing AI coding-agent employees across a workspace. It combines a Tauri 2 Rust backend with a React, TypeScript, Vite, Zustand, Three.js, xterm.js, and CodeMirror frontend.

The app is built around one rule: backend state is the source of truth. The frontend renders employees, terminals, approvals, reviews, and diagnostics from structured backend data rather than ad hoc UI guesses.

## What Slavey Does

- Open and switch local workspaces with repo health, Codex availability, Git identity checks, diagnostics, and recent workspace history.
- Create, select, pause, resume, and remove employees, optionally backed by Git worktrees.
- Run shell and Codex sessions per employee with ownership checks, session history, runtime metadata, and bounded terminal buffers.
- Submit Codex tasks through the structured Codex app-server path when available, while still supporting PTY shell sessions.
- Show a Three.js office floor where employees move according to the canonical backend `EmployeeActivity.contract`.
- Edit files with a file tree, recent files, search, CodeMirror, dirty-state handling, and save-conflict messaging.
- Review employee worktree changes grouped by conflicted, staged, unstaged, and untracked files.
- Commit employee worktree changes and run explicit handoff preflight/apply/abort flows without push or PR automation.
- Track actions, approvals, managed processes, logs, and redacted diagnostics without persisting raw terminal output.

## How The App Works

At runtime, the frontend calls typed Tauri commands from `src/lib/tauriCommands.ts`. Backend state lives in `AppState` in `src-tauri/src/lib.rs` and is split across managers for employees, terminal sessions, Codex app-server sessions, agent runtime snapshots, actions, approvals, processes, persistence, and workspace metadata.

The employee floor is driven by this pipeline:

1. Backend evidence is collected from employees, terminal sessions, agent runtime snapshots, actions, approvals, processes, Git review, handoff state, blockers, and lifecycle state.
2. `src-tauri/src/activity_contract.rs` resolves that evidence into `EmployeeActivity.contract`.
3. Frontend presentation uses `src/lib/employeeActivityContractView.ts` to map the contract to labels, detail text, attention state, and floor intent.
4. `src/components/employee-floor/employeeFloorViewModel.ts` routes employees to desks, owner office, done room, standby, or offline zones.
5. The Three.js floor and character behavior render the result.

Desk sitting is reserved for active productive work. Idle, shell-open, startup, handoff, review, blocked, and owner-waiting states route away from desks.

See [Architecture](docs/architecture.md), [Employee Activity Contract](docs/activity-contract.md), and [Terminal Evidence Flow](docs/terminal-evidence-flow.md) for the full system model.

## Development

Install dependencies and hooks:

```sh
npm install
npm run install-hooks
```

Run the desktop app:

```sh
npm run dev
```

Run the Vite-only web app:

```sh
npm run dev:web
```

Build the desktop app:

```sh
npm run build
```

The Tauri app serves the Vite frontend at `http://localhost:1420` during development.

## Validation

Use the full local gate before pushing:

```sh
npm run check
```

`npm run check` runs:

- TypeScript typecheck.
- Vitest web tests.
- Production Vite build.
- Production bundle guard.
- Rust formatting check.
- Rust clippy with `-D warnings`.
- Rust tests.

Run browser smoke tests separately:

```sh
npm run test:e2e:run
```

For the interactive Playwright runner:

```sh
npm run test:e2e
```

If Chromium is not installed locally:

```sh
npx playwright install chromium
```

The E2E harness sets `VITE_SLAVEY_E2E=true` through Playwright's web server environment. Browser tests run against mock Tauri data at the typed command boundary and are app-shell smoke tests, not backend validation. The production bundle guard fails if E2E fixture strings leak into `dist/`.

## Workspace Safety

The backend restricts file reads and writes to the selected workspace root. In development, the root defaults to your home directory unless a persisted workspace is available. You can override it with:

```sh
SLAVEY_WORKSPACE_ROOT=/path/to/workspace npm run dev
```

Backend filesystem operations validate paths, reject workspace escapes, block sensitive paths, and keep destructive operations explicit.

## Documentation

- [Architecture](docs/architecture.md): module map, data flow, runtime state, persistence, events, diagnostics, and testing strategy.
- [Employee Activity Contract](docs/activity-contract.md): canonical employee activity semantics and routing rules.
- [Terminal Evidence Flow](docs/terminal-evidence-flow.md): current terminal, Codex, runtime, and activity evidence flow plus risk areas.
- [Engineering Rules](docs/engineering-rules.md): standards for safety, validation, module boundaries, and Git workflow.
- [Contributing](CONTRIBUTING.md): setup, branch workflow, validation, and contribution expectations.

## Current Limitations

- No push, pull request, or remote hosting automation.
- Handoff conflicts are surfaced for manual resolution; Slavey does not auto-resolve conflicts.
- Browser smoke tests use mock Tauri data and do not replace Rust/backend tests.
- Windows managed-process cleanup terminates the direct child process only; full process-tree cleanup should use Job Objects in a later phase.
- Large frontend chunks are currently tolerated by validation; future work should split lazy routes or vendor chunks instead of hiding warnings.
