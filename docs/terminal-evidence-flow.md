# Terminal Evidence Flow

This audit documents the current terminal and Codex evidence flow. It describes how the app works now, including fallback parsing and known weak spots. It is not a design proposal for future behavior.

## Overview

Slavey has two Codex evidence paths.

The preferred path is the Codex app-server path. It uses structured JSON-RPC responses, notifications, and requests from `codex app-server --stdio`. Those events are recorded in `AgentRuntimeStore` with `source: codex_app_server` and `confidence: structured`.

The fallback path is PTY parsing. Shell sessions and direct Codex terminal sessions stream terminal bytes through a PTY reader. Slavey strips its own control markers, stores bounded terminal metadata, and parses bounded output tails for strong Codex signals such as prompt-ready output, approval prompts, and active working output. PTY parsing is fallback evidence because terminal output is not a stable protocol.

`EmployeeActivity.contract` remains the canonical employee state for the frontend. The floor, employee labels, attention state, and routing should consume the backend activity contract, not terminal text. Legacy activity fields and frontend terminal prompt parsing exist for compatibility, diagnostics, and local terminal display.

## Backend Evidence Sources

### `TerminalSessionRecord`

`TerminalSessionRecord` in `src-tauri/src/terminal/session_store.rs` is the durable terminal metadata record. It contains:

- `session_id` and `employee_id`, which tie evidence to one employee/session ownership boundary.
- `profile`, the launch profile: `shell` or `codex`.
- `runtime`, the execution path: `pty` or `codex_app_server`.
- `active_profile`, the effective current profile. A shell session can become effectively `codex` when Codex starts inside the shell.
- `cwd`, the session start directory.
- `current_cwd`, the current shell directory when shell integration markers are available.
- `status`: `running`, `exited`, `failed`, or `stopped`.
- `turn_state`: `unknown`, `shell`, `codex_starting`, `owner_prompt_ready`, `owner_composing`, `prompt_submitted`, `agent_working`, `waiting_approval`, `completed`, or `failed`.
- `last_output_at`, the latest visible output timestamp.
- `last_prompt_submitted_at`, set when owner input submits a Codex prompt or task.
- `last_prompt_ready_at`, set when output suggests the Codex prompt is ready.
- `last_approval_prompt_at`, set when output suggests Codex is waiting for terminal approval.
- `last_output_tail`, a non-serialized bounded tail used only for prompt detection across split chunks.

The session store keeps only bounded metadata for persistence. Raw PTY output is not persisted as terminal session metadata.

### Status, Profile, Runtime, And `activeProfile`

`profile` describes how the session was launched. Direct Codex sessions launch as `codex`; normal shells launch as `shell`.

`runtime` describes the implementation path. PTY sessions use `TerminalManager` and terminal output callbacks. Codex app-server sessions use `CodexAppServerManager` and structured JSON-RPC events.

`activeProfile` is the effective profile. For shell-launched Codex, Unix shell integration installs a temporary `codex` wrapper. The wrapper emits start/end control markers, allowing the backend to switch a shell session between effective `shell` and effective `codex`.

### `turnState`

`turnState` is the terminal session's current turn-level state. For Codex, it distinguishes startup, owner prompt readiness, owner draft input, prompt submission, agent work, terminal approval, completion, and failure.

`turnState` is not itself the final employee state. It feeds `AgentRuntimeStore`, which feeds `EmployeeActivity`, which feeds `EmployeeActivity.contract`.

### Prompt And Approval Timestamps

The prompt timestamps are ordered evidence:

- `last_prompt_submitted_at`: owner submitted a prompt.
- `last_prompt_ready_at`: Codex prompt returned and the owner can type.
- `last_approval_prompt_at`: Codex is waiting on terminal approval.

The parser uses these timestamps with `turnState` to decide whether Codex is waiting on the owner, waiting on approval, or still working.

### Last Output Tail

`last_output_tail` stores a bounded, non-persisted tail of recent output for PTY prompt detection. `record_output` combines the previous tail with the new chunk so split approval prompts or split prompt-ready output can be detected without scanning the full terminal buffer.

### Active Profile Markers

Shell-launched Codex detection uses internal OSC 777 markers:

- `slavey-codex=start`: effective profile becomes `codex`.
- `slavey-codex=end`: effective profile returns to `shell`.

The PTY reader strips these markers from visible terminal output before emitting `terminal:data`.

### CWD Markers

Shell current-working-directory tracking also uses OSC 777 markers:

- `slavey-cwd=<path>` updates `TerminalSessionRecord.current_cwd`.

This integration is currently configured for Unix `bash` and `zsh` shells. The marker is stripped before visible output is emitted.

### `AgentRuntimeStore` Snapshots

`AgentRuntimeStore` stores per-session runtime snapshots and events. Snapshots include:

- `kind`: `none`, `codex`, or `claude`.
- `state`: `not_active`, `starting`, `thinking`, `waiting_prompt`, `waiting_approval`, `completed`, or `failed`.
- `source`: `none`, `terminal_fallback`, or `codex_app_server`.
- `confidence`: `none`, `terminal_fallback`, or `structured`.
- `turn_owner`: `none`, `owner`, `agent`, or `tool`.

PTY sessions sync into fallback runtime snapshots. Codex app-server sessions sync into structured snapshots. For running app-server sessions, an existing structured app-server snapshot is preserved when it is newer than the session-derived snapshot.

### Codex App-Server Notifications

`src-tauri/src/codex_app_server.rs` starts `codex app-server --stdio`, sends JSON-RPC requests, parses JSON-RPC lines, routes events by thread id to the owning session, and records structured runtime state.

Current notification mapping includes:

- `turn/started`, `item/started`, `item/updated`, and `item/completed` map to `thinking`.
- approval request methods map to `waiting_approval`.
- `item/tool/requestUserInput` maps to `waiting_prompt`.
- `turn/completed` maps to `waiting_prompt` unless the turn status is `failed`.
- `thread/status/changed` maps `active` to `thinking`, `idle` and `notLoaded` to `waiting_prompt`, and `systemError` to `failed`.
- `thread/closed` maps to `completed`.
- `error` maps to `failed`.

### Actions, Approvals, Processes, Review, And Handoff

`activity.rs` also collects non-terminal evidence:

- running actions.
- pending actions.
- pending app approvals.
- running managed processes.
- Git review changes.
- handoff readiness.
- employee blockers, failed state, standby state, stopped state, and done state.

Terminal owner-wait states, such as Codex waiting for instruction or terminal approval, intentionally outrank active actions and processes because the owner must act before work can continue. Active actions and processes outrank ordinary terminal-running states.

## PTY Flow

1. `employee_start_terminal` creates a `TerminalSessionRecord`, syncs an initial agent runtime snapshot, and starts a PTY session through `TerminalManager`.
2. `TerminalManager` spawns the requested shell or Codex command. Direct Codex sessions run `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox`. Shell sessions install shell integrations where supported.
3. The terminal reader receives chunks from the PTY in an 8192-byte buffer.
4. `parse_terminal_control_markers` removes Slavey control markers and reports active-profile and CWD changes. Partial markers can be held in a pending buffer across reads.
5. Visible output is appended to the in-memory bounded terminal output buffer and emitted as `terminal:data`.
6. The output callback calls `TerminalSessionStore.record_output`.
7. `record_output` builds a bounded detection string from `last_output_tail` plus the new output.
8. `record_output` detects terminal approval prompts, active work, prompt-ready output, and prompt-at-end stale redraws.
9. If output shows an approval prompt, the session becomes `waiting_approval`, `last_approval_prompt_at` is set, and prompt-ready state is cleared.
10. If output shows active work and does not end at a prompt, the session becomes `agent_working`, prompt-ready and approval timestamps are cleared, and a missing submitted timestamp may be filled when work resumes from an owner-wait state.
11. If output shows a Codex prompt ready, the session becomes `owner_prompt_ready`, `last_prompt_ready_at` is set, and approval state is cleared.
12. If the session is already waiting for owner input or approval, echoed owner draft text and prompt redraws do not prove that the agent resumed work.
13. Otherwise visible output updates `last_output_at`; active Codex sessions that emit visible text while already submitted or working remain `agent_working`.
14. When relevant session fields change, `AgentRuntimeStore.sync_from_terminal_session` records a fallback runtime snapshot and the backend emits `terminal:session-updated`.
15. `emit_terminal_session_updated` also emits `employee:activity-updated`.

Input follows a separate path:

1. `terminal_write` writes owner input to the PTY.
2. `TerminalSessionStore.record_input` runs for running Codex-tracked sessions.
3. Any input containing carriage return or newline submits a prompt and moves `turnState` to `prompt_submitted`.
4. Nonempty input without carriage return or newline marks `owner_composing` only when the session is already waiting for instruction or approval.
5. Relevant input changes sync the runtime snapshot and emit `terminal:session-updated`.

The recent stale-redraw fix lives in this flow: if a final output chunk contains stale `Working ... esc to interrupt` text but the last meaningful line is the `›` prompt, prompt-ready wins over active work.

## Codex App-Server Flow

The structured Codex app-server path starts at `codex_task_submit`.

1. The backend validates the prompt, employee ownership, workspace root, execution directory, and session reuse rules.
2. It creates or reuses a `TerminalSessionRecord` with `profile: codex` and `runtime: codex_app_server`.
3. The employee is marked running with `current_command: codex` and the app-server session id.
4. The backend records a prompt submission on the terminal session, syncs a structured app-server runtime snapshot, emits `terminal:session-updated`, and appends a transcript line containing the prompt.
5. `CodexAppServerManager.submit_turn` ensures the app-server process is running, starts a thread if needed, and sends `turn/start`.
6. The app-server stdout reader parses JSON-RPC lines.
7. Responses resolve pending request waiters. Notifications and requests are routed to the session handler using the thread id.
8. App-server requests are answered with conservative default responses. Approval requests are declined or denied by default.
9. The session handler records app-server notifications in `AgentRuntimeStore` with `source: codex_app_server` and `confidence: structured`.
10. Transcript deltas from agent messages, command output, file changes, and reasoning summaries are appended to the app-server transcript and emitted as `terminal:data`.
11. `turn/completed` with a successful status records `waiting_prompt` and appends a waiting-for-next-instruction prompt to the transcript.
12. `error` marks the terminal session failed and emits `terminal:session-updated`. Other structured events emit `employee:activity-updated` directly.

For app-server sessions, activity state is driven by structured `AgentRuntimeStore` snapshots whenever those snapshots exist. The terminal transcript exists for user visibility and replay, not as the source of truth for employee activity.

## State Mapping Table

| Input signal | TerminalSession `turnState` | AgentRuntime state | EmployeeActivity status | Contract render placement/activity | Owner attention |
| --- | --- | --- | --- | --- | --- |
| Shell open | `shell` | `not_active` | `shell_running` | `done_room` / `terminal` | No |
| Codex starting | `codex_starting` | `starting` | `codex_starting` | `done_room` / `terminal` | No |
| Owner prompt ready | `owner_prompt_ready` | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| Owner composing | `owner_composing` | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| Prompt submitted | `prompt_submitted` | `thinking` | `codex_running` | `desk` / `working` | No |
| Agent working | `agent_working` | `thinking` | `codex_running` | `desk` / `working` | No |
| Final answer / prompt returns | `owner_prompt_ready` | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| Approval prompt | `waiting_approval` | `waiting_approval` | `codex_waiting_approval` | `owner_office` / `approval` | `needs_terminal_approval` |
| Approval resolved | `prompt_submitted` or `agent_working` until the next prompt or failure signal | `thinking` until the next prompt or failure signal | `codex_running` | `desk` / `working` | No |
| App-server turn started | usually `prompt_submitted`; app-server notifications do not rewrite `turnState` | `thinking` | `codex_running` | `desk` / `working` | No |
| App-server turn completed | usually unchanged from submit; structured snapshot carries the owner-wait state | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| Error/failure | `failed` | `failed` | `blocked` | `owner_office` / `blocked` | `blocked_needs_help` |
| Terminal stopped/exited | `completed` for stopped or clean exit; `failed` for failed exit | `completed` or `failed` for Codex sessions | explicit stop becomes `stopped`; clean completion usually becomes `done_clean`; failure becomes `blocked` | `offline` / `idle`, `owner_office` / `handoff`, or `owner_office` / `blocked` | None, `ready_to_report`, or `blocked_needs_help` |
| Review needed | no terminal signal required | usually `not_active` unless historical agent evidence exists | `review_needed` | `owner_office` / `review` | `review_needed` |
| Handoff ready | no terminal signal required | usually `not_active` unless historical agent evidence exists | `handoff_ready` | `owner_office` / `handoff` | `handoff_ready` |
| Done clean | no running terminal required | usually `completed` for a completed Codex session or `not_active` for non-terminal done state | `done_clean` | `owner_office` / `handoff` | `ready_to_report` |

## Event/Refresh Flow

The backend emits three important event families for terminal evidence.

`terminal:data` carries visible terminal output. The frontend appends it to bounded terminal buffers. `terminalSlice` also mirrors some prompt parsing locally so terminal session display can react before the next session list reload. This frontend parsing is not the source of truth for employee activity.

`terminal:session-updated` carries a full `TerminalSessionRecord`. The frontend upserts it into `terminalSessions`. On the backend, emitting this event also emits `employee:activity-updated` for the same employee.

`employee:activity-updated` tells the frontend to refresh canonical activity. In `bootstrapSlice.ts`, the frontend calls `employee_activity_get` for the affected employee, or reloads all activities when no employee id is provided.

The floor must not infer employee state directly from terminal text because terminal output is only one evidence source and PTY text is lossy. The intended path is:

1. Backend evidence updates terminal sessions, runtime snapshots, actions, approvals, processes, review, handoff, blockers, and employee lifecycle.
2. `activity.rs` derives `EmployeeActivity`.
3. `activity_contract.rs` resolves `EmployeeActivity.contract`.
4. `employeeActivityContractView.ts` maps the contract to presentation state, detail, attention, and floor intent.
5. `employeeFloorViewModel.ts` maps floor intent into desk, owner office, done room, standby, or offline zones.

## Current Risk Areas

- PTY output is not a stable protocol. Codex UI text, prompt glyphs, progress wording, and redraw behavior can change outside Slavey's control.
- Redraws, ANSI/control sequences, carriage returns, and split chunks can create edge cases. The parser handles known stale redraws and split Slavey control markers, but the corpus is not complete.
- Frontend terminal state still mirrors some Codex prompt parsing for local terminal display. Backend activity refresh remains canonical, but frontend display can briefly disagree with backend state if event timing differs.
- The fixture corpus is not complete yet. Existing tests cover important prompt-ready, approval, active-work, owner-draft, app-server, and stale-redraw cases, but they are not a broad transcript replay suite.
- Structured app-server evidence is preferred, but shell-launched Codex still relies on PTY fallback and wrapper markers.
- App-server notifications update `AgentRuntimeStore` and activity directly, but most notifications do not rewrite `TerminalSessionRecord.turnState`. Activity can still be correct through the structured runtime snapshot, while terminal-session display may lag or show the submission state until another session update arrives.
- CWD markers are currently shell-integration dependent. Unsupported shells or failed shell integration can leave `current_cwd` at the start directory even when terminal output and activity continue normally.

No concrete production bug was confirmed during this audit. The items above are hardening risks to carry into later phases.

## Next Hardening Phases

These phases are listed for planning context only. This document does not implement them.

- Phase 2: Build a terminal transcript fixture corpus and replay harness for PTY parser regressions.
- Phase 3: Consolidate parser ownership and add backend/frontend parity coverage where local display still mirrors backend logic.
- Phase 4: Harden event ordering, session update freshness, and activity refresh behavior under rapid terminal output.
- Phase 5: Strengthen Codex app-server state handling, including request/approval edge cases and terminal-session display consistency.
- Phase 6: Expand diagnostics for terminal evidence decisions, runtime source/confidence, and activity contract traces.
- Phase 7: Add state-driven frontend and browser smoke coverage for critical terminal/activity/floor transitions.
- Phase 8: Reduce reliance on PTY fallback for shell-launched Codex where a structured source can be used.
- Phase 9: Final validation, cleanup, and release-readiness pass for terminal/Codex hardening.
