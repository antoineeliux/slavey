# Architecture

This document explains the current Slavey architecture after the employee activity contract and Codex runtime work.

## System Shape

Slavey is a local-first Tauri desktop app.

- Backend: Rust, Tauri commands, in-memory managers, JSON persistence, local filesystem/Git/process/terminal access.
- Frontend: React, TypeScript, Zustand, Vite, Three.js employee floor, xterm.js terminal, CodeMirror editor.
- Boundary: all frontend/backend calls go through typed wrappers in `src/lib/tauriCommands.ts`.
- Source of truth: backend state. Frontend state mirrors backend records and renders them.

The app has no remote service dependency. It works against local workspaces, local Git repositories, local terminals, and local Codex tooling.

## Backend Modules

Backend files live in `src-tauri/src`.

| Module | Responsibility |
| --- | --- |
| `lib.rs` | Tauri setup, `AppState`, persistence restore, command registration. |
| `workspace.rs` | Workspace root selection, recent workspaces, repo health, workspace switch cleanup. |
| `employees.rs` | Employee lifecycle, roles, work folders, standby/resume, terminal start/stop ownership. |
| `activity.rs` | Collects per-employee evidence and emits `EmployeeActivity` records. |
| `activity_contract.rs` | Canonical activity contract resolver and invariant tests. |
| `terminal.rs` | PTY lifecycle, terminal I/O, Codex wrapper markers, CWD markers, image upload commands. |
| `terminal/session_store.rs` | Terminal session records, prompt/turn state, active profile, runtime session history. |
| `terminal/agent_runtime.rs` | Agent runtime snapshots from PTY fallback and Codex app-server structured events. |
| `terminal/codex_status.rs` | Codex CLI availability checks. |
| `codex_app_server.rs` | Structured Codex task submission and JSON-RPC notification handling. |
| `actions.rs` and `actions/*` | Structured actions, action transitions, persistence, and action execution. |
| `approvals.rs` | Approval requests and approval/action linkage. |
| `processes.rs` | Managed background processes and bounded logs. |
| `git.rs` and `git/*` | Git status, parsing, worktree review, diffs, commits, and handoff flows. |
| `fs.rs` and `fs/*` | Workspace-safe file listing, search, metadata, read/write/create/rename/delete. |
| `diagnostics.rs` and `diagnostics/redaction.rs` | Redacted diagnostics summary/export and support metadata. |
| `persistence.rs` | App state snapshot persistence and restore normalization. |
| `events.rs` | Tauri event payloads and event emit helpers. |

## Frontend Modules

Frontend files live in `src`.

| Module | Responsibility |
| --- | --- |
| `src/lib/tauriCommands.ts` | Typed command wrapper around Tauri `invoke`; swaps to E2E mock when enabled. |
| `src/types.ts` | Shared frontend types for backend payloads and UI models. |
| `src/store/appStore.ts` | Zustand store composition. |
| `src/store/slices/*` | Domain slices for bootstrap, workspace, employees/activity, terminal, actions, review, processes, editor, and events. |
| `src/lib/employeeActivityContractView.ts` | Contract-to-visual adapter for labels, details, attention, and floor intent. |
| `src/components/employee-scene/activityPresentation.ts` | Builds employee presentation records from activity data and first-load fallback data. |
| `src/components/employee-floor/employeeFloorViewModel.ts` | Converts presentation into office/floor routing and state. |
| `src/components/employee-floor/*` | Three.js office floor, character behavior, navigation, runtime, materials, and avatar appearance. |
| `src/components/office/*` | Office-pane view model, toolbar, status HUD, context actions, terminal dock, and creation/customization modals. |
| `src/components/EmployeeTerminalSurface.tsx` | xterm.js terminal surface, terminal replay, resize, image paste/drop. |
| `src/components/EditorPane.tsx` | File tree, search, editor, dirty state, and save workflow. |
| `src/components/ReviewPanel.tsx` | Worktree review, diffs, staging, commit, handoff. |
| `src/lib/e2eTauriMock.ts` | Browser-only mock Tauri backend for Playwright smoke tests. |

## Runtime State

`AppState` in `src-tauri/src/lib.rs` owns the backend runtime state:

- `workspace_root`: selected workspace.
- `employees`: employee records and role policies.
- `terminal`: live PTY manager.
- `codex_app_server`: structured Codex app-server manager.
- `terminal_sessions`: durable terminal metadata and turn state.
- `agent_runtime`: runtime snapshots for active agents.
- `persistence`: JSON snapshot load/save.
- `approvals`: approval requests.
- `actions`: structured actions.
- `processes`: managed background processes and logs.

Only selected metadata is persisted. Raw terminal output is kept in runtime buffers and is not persisted. Process logs are bounded. Restored running actions, processes, and terminal sessions are normalized to stopped or failed states.

## Command Boundary

The frontend must not call raw `invoke` outside `src/lib/tauriCommands.ts`.

The command layer provides typed functions for:

- Workspace and settings.
- Employees and role policies.
- Employee activity records.
- Terminal session list/write/resize/output/stop/rename.
- Terminal image upload.
- Codex CLI/app-server status and Codex task submission.
- Diagnostics summary/export.
- Actions and approvals.
- Managed processes and logs.
- Git worktree review, staging, commit, handoff, and file diffs.
- Workspace-safe filesystem operations.

Browser E2E tests use the same command functions. When `VITE_SLAVEY_E2E=true`, `tauriCommands.ts` dynamically imports `e2eTauriMock.ts` instead of invoking Tauri.

## Events And Refresh

The backend emits Tauri events when domain records change:

- `terminal:data`
- `terminal:session-updated`
- `employee:updated`
- `employee:activity-updated`
- `approval:updated`
- `action:updated`
- `process:updated`
- `process:log`
- `app:log`

Important rule: terminal, employee, approval, action, process, workspace, and Git handoff changes emit or trigger `employee:activity-updated` when they can change employee activity. The frontend listens in `bootstrapSlice.ts` and refreshes the affected activity record through `employee_activity_get`, or reloads all activities when no employee id is provided.

## Employee Activity Data Flow

Employee activity is the most important app-wide state because it drives the office floor, status pills, owner attention, and context actions.

1. Backend collects evidence in `activity.rs`.
2. Backend resolves legacy compatibility fields and the canonical `EmployeeActivity.contract`.
3. Backend emits `employee:activity-updated` after relevant state changes.
4. Frontend refreshes `employeeActivities[employeeId]`.
5. `presentEmployeeActivity` creates presentation data.
6. `resolveEmployeeActivityContractView` maps the contract to stable UI semantics.
7. `createEmployeeFloorViewModel` maps the presentation to floor zones and actor behavior.
8. Three.js runtime updates actors from the view models.

When an activity record exists, the frontend must use `EmployeeActivity.contract` for visual routing. Legacy activity fields remain for compatibility, details, and diagnostics only.

See [Employee Activity Contract](activity-contract.md) for the full contract.

## Terminal And Codex Runtime

Slavey supports two Codex paths:

- PTY fallback: a shell or Codex terminal session with prompt/output heuristics.
- Codex app-server: structured task submission and structured runtime notifications.

Terminal session records include:

- launch `profile`: shell or codex.
- `runtime`: PTY or Codex app-server.
- `activeProfile`: current effective shell/codex mode.
- `turnState`: shell, codex starting, owner prompt ready, owner composing, prompt submitted, agent working, waiting approval, completed, or failed.
- prompt timestamps for submitted prompt, prompt ready, and approval prompt.

PTY sessions use terminal output only as fallback evidence. The parser recognizes strong signals like Codex prompt-ready, approval prompts, and `Working ... esc to interrupt`. Echoed owner draft text does not count as agent work.

Codex app-server sessions prefer structured JSON-RPC notifications and preserve structured source/confidence through activity contracts.

See [Terminal Evidence Flow](terminal-evidence-flow.md) for the current terminal/Codex evidence audit, state mapping table, event refresh flow, diagnostics trace, fixture/stress coverage, and known risk areas.

## Workspaces, Files, And Editor

The workspace root is selected in the backend and can be overridden locally with `SLAVEY_WORKSPACE_ROOT`.

Filesystem operations:

- validate paths against the workspace root.
- reject parent escapes and sensitive paths.
- expose structured file metadata.
- keep search/list/read/write/create/rename/delete behind Tauri commands.

The editor frontend treats backend metadata and validation as canonical. Unsaved changes are guarded before file switches, workspace switches, and editor close paths.

## Employees And Worktrees

Employees are local records with:

- id, name, role, status.
- current working folder.
- optional Git worktree path.
- optional terminal session id.

Worktrees are the preferred execution boundary for employee work. Git review and handoff commands operate through backend commands. Handoff apply and abort require explicit confirmation and surface conflicts instead of auto-resolving them.

Pet companions are normal backend employees with dependent office-floor movement. Their own backend activity drives status and indicators, while floor routing follows a parent employee. See [Pet Companion System](pet-companion-system.md).

## Actions, Approvals, And Processes

Actions are structured operations with explicit transitions. Risky action flows use approvals. Approvals are the audit layer and can be linked to actions.

Managed processes are started by the backend with bounded logs and explicit lifecycle transitions. On Unix/macOS, process cancellation attempts to terminate the process group. On Windows, the current cleanup path terminates the direct child process only.

## Diagnostics

Diagnostics are opt-in and local. Exported bundles are redacted and intentionally omit raw terminal output, environment variables, credentials, tokens, raw process logs, and file-write contents.

Diagnostics include:

- workspace and repo health summary.
- counts for employees, terminal sessions, actions, approvals, processes.
- employee activity contract traces.
- terminal runtime/turn evidence.
- redacted labels, paths, and messages.

See the diagnostics trace section in [Terminal Evidence Flow](terminal-evidence-flow.md#diagnostics-trace) for how terminal/session evidence, runtime source/confidence, activity state, and the canonical contract are exported together.

## Persistence

Persistence stores app state in Tauri app config storage:

- workspace root.
- employees.
- terminal session metadata.
- actions and approvals.
- managed processes and bounded process log snapshots.
- UI settings and selected state.

On restore:

- running terminal sessions become stopped.
- running actions/processes become failed.
- pending approvals linked to non-pending actions are rejected.
- terminal/runtime snapshots are rebuilt from session records.

## Testing Strategy

Local validation is layered:

- Rust unit tests cover backend rules, parsing, path safety, actions, approvals, persistence, terminal runtime, activity contract, Git parsing/review, diagnostics, and workspace behavior.
- Vitest covers frontend store, typed command mock paths, presentation, floor view models, rendered scenes, terminal surface, panels, and helper logic.
- Playwright smoke tests run the browser app with `VITE_SLAVEY_E2E=true` and mock Tauri data.
- Production bundle guard checks that E2E fixture data does not leak into the production build.

Run `npm run check` before pushing.

## Adding New Behavior

Use these boundaries:

- Add backend command payloads and validation in Rust.
- Add typed frontend wrappers in `src/lib/tauriCommands.ts`.
- Update shared frontend types in `src/types.ts`.
- Store domain state in the relevant Zustand slice.
- Emit events from backend state changes when the UI needs live refresh.
- If employee visuals change, update the backend activity contract first, then the frontend contract adapter and floor tests.
- Add focused Rust and frontend tests before broad UI work.

Avoid adding UI-only inference for backend-owned state. If the frontend needs to know whether something is working, blocked, waiting, or done, the backend contract should say so.
