# Terminal Evidence Flow

This audit documents the current terminal and Codex evidence flow. It describes how the app works now, including fallback parsing and known weak spots. It is not a design proposal for future behavior.

## Overview

Slavey has three Codex evidence paths.

The preferred path is the Codex app-server path. It uses structured JSON-RPC responses, notifications, and requests from `codex app-server --stdio`. Those events are recorded in `AgentRuntimeStore` with `source: codex_app_server` and `confidence: structured`.

PTY-launched Codex sessions also get a scoped Codex `notify` override. Codex calls a Slavey-owned helper for `agent-turn-complete`; the helper writes the official notification payload into a per-session temp directory. The backend watcher records the turn completion directly on the owning terminal session — moving it to `owner_prompt_ready` even from `prompt_submitted` or `agent_working` — and then re-applies the current PTY size so Codex repaints its final state for display. The notification is authoritative for turn completion because it does not depend on recognizing terminal text, but it still records terminal-fallback source/confidence because it is attached to a PTY session rather than an app-server session.

The final fallback path is PTY parsing. Shell sessions and direct Codex terminal sessions stream terminal bytes through a PTY reader. Slavey strips its own control markers, stores bounded terminal metadata, and parses bounded output tails for strong Codex signals such as prompt-ready output, approval prompts, and active working output. PTY parsing is fallback evidence because terminal output is not a stable protocol.

`EmployeeActivity.contract` remains the canonical employee state for the frontend. The floor, employee labels, attention state, and routing should consume the backend activity contract, not terminal text. Legacy activity fields exist for compatibility and diagnostics. The frontend keeps bounded terminal buffers fresh and interprets backend session records for presentation fallback, but it does not parse raw terminal output to infer Codex turn state.

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

PTY sessions sync into fallback runtime snapshots, including prompt readiness discovered after Codex notify-triggered redraws. Codex app-server sessions sync into structured snapshots. For running app-server sessions, an existing structured app-server snapshot is preserved when it is newer than the session-derived snapshot.

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
3. On Unix, `TerminalManager` creates a per-session Codex notify bridge. Direct Codex PTYs receive `--config notify=[...]`; shell PTYs expose the same override through the temporary `codex` wrapper. The helper writes Codex notification JSON to a per-session temp directory; when the watcher sees `agent-turn-complete` it records the completion on the terminal session first and then re-applies the current PTY size so Codex repaints for display.
4. The terminal reader receives chunks from the PTY in an 8192-byte buffer.
5. `parse_terminal_control_markers` removes Slavey control markers and reports active-profile and CWD changes. Partial markers can be held in a pending buffer across reads.
6. Visible output is appended to the in-memory bounded terminal output buffer and emitted as `terminal:data`.
7. The output callback calls `TerminalSessionStore.record_output`.
8. `record_output` builds a bounded detection string from `last_output_tail` plus the new output.
9. `record_output` collects PTY evidence for terminal approval prompts, active work, prompt-ready output, prompt-at-end stale redraws, owner-wait state, and visible text.
10. A private backend resolver turns that immutable session state and output evidence into a `TerminalTurnTransition`. Applying the transition to the mutable session record is a separate step.
11. If output shows an approval prompt, the session becomes `waiting_approval`, `last_approval_prompt_at` is set, and prompt-ready state is cleared. Approval detection applies only to shell-launched sessions: direct Codex sessions run with approvals bypassed, so approval prompts cannot occur there and approval-like answer text is ignored. Approval keyword matching is word-boundary based so prose like "allowed" or "now" does not count as approval evidence.
12. If output shows active work and does not end at a prompt, the session becomes `agent_working`, prompt-ready and approval timestamps are cleared, and a missing submitted timestamp may be filled when work resumes from an owner-wait state.
13. If output shows a Codex prompt ready, the session becomes `owner_prompt_ready`, `last_prompt_ready_at` is set, and approval state is cleared.
14. If a Codex notify `agent-turn-complete` event arrives for a PTY session, the backend records the completion directly: the session becomes `owner_prompt_ready`, `last_prompt_ready_at` is set, approval state is cleared, and a notify completion timestamp is stored on the session. The watcher then refreshes the PTY so Codex repaints its final state for display. Notify events older than the latest prompt submission are ignored. The heuristic completion-text path remains for sessions without a notify bridge: status-only working redraws that end at a prompt glyph remain `agent_working`, while working redraws with completion text before the returned prompt can become `owner_prompt_ready`.
15. If the session is already waiting for owner input or approval, echoed owner draft text and prompt redraws do not prove that the agent resumed work. After a notify-confirmed completion, stale `Working ... esc to interrupt` redraw text also cannot move the session back to `agent_working`; only the next owner submission clears the notify timestamp and re-enables active-work evidence.
16. Otherwise visible output updates `last_output_at`; active Codex sessions that emit visible text while already submitted or working remain `agent_working`.
17. When relevant session fields change, `AgentRuntimeStore.sync_from_terminal_session` records a fallback runtime snapshot and the backend emits `terminal:session-updated`.
18. `emit_terminal_session_updated` also emits `employee:activity-updated`.

Input follows a separate path:

1. `terminal_write` writes owner input to the PTY.
2. `TerminalSessionStore.record_input` runs for running Codex-tracked sessions.
3. Any input containing carriage return or newline submits a prompt and moves `turnState` to `prompt_submitted`.
4. Nonempty input without carriage return or newline marks `owner_composing` only when the session is already waiting for instruction or approval.
5. Relevant input changes sync the runtime snapshot and emit `terminal:session-updated`.

The recent stale-redraw fix lives in this flow: if a final output chunk contains stale `Working ... esc to interrupt` text but the last meaningful line is the `›` prompt, prompt-ready wins over active work.

The resolver records transition reasons such as `shell_output`, `codex_approval_prompt`, `codex_active_work`, `codex_prompt_ready`, `codex_prompt_ready_at_end_stale_work_redraw`, `codex_notify_agent_turn_complete`, `owner_prompt_echo_ignored`, `owner_input_submitted`, `owner_composing`, `active_profile_reset_to_shell`, `active_profile_changed_to_codex`, `session_finished_completed`, and `session_finished_failed`. App-server session sync records app-server transition reasons such as `app_server_thinking`, `app_server_waiting_prompt`, `app_server_waiting_approval`, `app_server_completed`, and `app_server_failed`. These labels are persisted on `TerminalSessionRecord.lastTransitionReason` for support/debugging; they are not UI routing state.

## Fixture Corpus

The PTY parser fixture corpus lives in `src-tauri/src/terminal/session_fixture_tests.rs`. It is compiled only for Rust tests through the `#[cfg(test)]` module registration in `src-tauri/src/terminal.rs`.

The corpus replays sanitized in-code fixtures through `TerminalSessionStore` and `AgentRuntimeStore`. It covers shell-open state, direct Codex startup, prompt-ready output, owner composing, prompt submission, active working output, prompt echo plus working output, final answer prompt return, stale redraw prompt return, approval prompts, approval response submission, split approval prompts, split prompt-ready output, shell-launched Codex profile switching, shell reset, clean Codex exit to `completed`, and failed Codex exit to `failed`. It also covers Codex notify turn completion: fast turns that never paint a recognizable working line, long final answers that scroll the working line out of the bounded detection tail, and stale working redraws arriving after a notify-confirmed completion. Approval fixtures use shell-launched Codex sessions because direct Codex sessions bypass approvals; a direct-Codex fixture asserts that approval-like answer text stays `owner_prompt_ready`.

To add a regression fixture, add a sanitized `Fixture` entry with ordered `Output`, `Input`, `ActiveProfile`, `NotifyTurnComplete`, or `Finish` events. Avoid local usernames, machine paths, real private prompts, secrets, or raw logs. Assert the final launch profile, effective profile, turn state, prompt/approval timestamp presence, runtime state, source, and confidence so the fixture documents current behavior precisely.

### Stress Matrix

The fixture corpus also runs through a deterministic PTY stress matrix:

- chunk-boundary invariance replays every fixture with each output event split at char-boundary positions. Short output strings test every possible single split; longer strings test representative boundaries around the start, first character, middle, final character, ANSI/control sequences, `›`, `Working`, and approval-choice text.
- single-character streaming replays critical flows one output character at a time: prompt-ready output, prompt echo plus `Working`, final answer prompt return, stale `Working` redraw prompt return, split approval prompts, and shell-launched Codex working output.
- redraw/control coverage splits fixtures around `\x1b[2K`, carriage returns, and returned prompts so clear-line redraws continue to resolve to the expected turn state.
- duplicate/redraw-like coverage includes repeated `Working ... esc to interrupt` redraw text followed by a final prompt, ensuring the final prompt remains authoritative.

Activity-level tests also replay stressed PTY flows through `EmployeeActivity.contract` for working, final prompt return, and approval prompt states. This verifies the parser output still resolves to the expected desk/owner-office placement and render activity.

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
10. When a structured app-server event maps to an `AgentRuntimeState`, `TerminalSessionStore.record_app_server_runtime_state` semantically updates the owning app-server `TerminalSessionRecord` and emits `terminal:session-updated` if active profile, turn state, or prompt/approval timestamps changed.
11. Transcript deltas from agent messages, command output, file changes, and reasoning summaries are appended to the app-server transcript and emitted as `terminal:data`.
12. `turn/started` rewrites the app-server terminal record from `prompt_submitted` to `agent_working`, preserving the submitted timestamp and clearing prompt-ready and approval timestamps.
13. `turn/completed` with a successful status records `waiting_prompt`, rewrites the terminal record to `owner_prompt_ready`, sets `lastPromptReadyAt` when entering that state, and appends a waiting-for-next-instruction prompt to the transcript.
14. Approval request events rewrite the terminal record to `waiting_approval`, set `lastApprovalPromptAt` when entering that state, and clear the prompt-ready timestamp.
15. `turn/completed` with failed status and `error` rewrite the terminal record to `failed`. The `error` path also keeps the existing terminal-status failure behavior and emits `terminal:session-updated` for that status change.
16. If a structured runtime event changes only the runtime snapshot and not the terminal session record, the handler emits `employee:activity-updated` directly.

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
| Codex notify `agent-turn-complete` | `owner_prompt_ready` | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| Approval prompt | `waiting_approval` | `waiting_approval` | `codex_waiting_approval` | `owner_office` / `approval` | `needs_terminal_approval` |
| Approval resolved | `prompt_submitted` or `agent_working` until the next prompt or failure signal | `thinking` until the next prompt or failure signal | `codex_running` | `desk` / `working` | No |
| App-server turn started | `agent_working` | `thinking` | `codex_running` | `desk` / `working` | No |
| App-server turn completed | `owner_prompt_ready` with `lastPromptReadyAt` set on entry | `waiting_prompt` | `codex_waiting_instruction` | `owner_office` / `waiting_instruction` | `needs_instruction` |
| App-server approval request | `waiting_approval` with `lastApprovalPromptAt` set on entry | `waiting_approval` | `codex_waiting_approval` | `owner_office` / `approval` | `needs_terminal_approval` |
| App-server failed turn / error | `failed` | `failed` | `blocked` | `owner_office` / `blocked` | `blocked_needs_help` |
| Error/failure | `failed` | `failed` | `blocked` | `owner_office` / `blocked` | `blocked_needs_help` |
| Terminal stopped/exited | explicit stop and clean Codex process exit use `completed`; failed Codex process exit uses `failed` | `completed` or `failed` for Codex sessions | explicit stop becomes `stopped`; clean completion usually becomes `done_clean`; failure becomes `blocked` | `offline` / `idle`, `owner_office` / `handoff`, or `owner_office` / `blocked` | None, `ready_to_report`, or `blocked_needs_help` |
| Review needed | no terminal signal required | usually `not_active` unless historical agent evidence exists | `review_needed` | `owner_office` / `review` | `review_needed` |
| Handoff ready | no terminal signal required | usually `not_active` unless historical agent evidence exists | `handoff_ready` | `owner_office` / `handoff` | `handoff_ready` |
| Done clean | no running terminal required | usually `completed` for a completed Codex session or `not_active` for non-terminal done state | `done_clean` | `owner_office` / `handoff` | `ready_to_report` |

## Event/Refresh Flow

The backend emits three important event families for terminal evidence.

`terminal:data` carries visible terminal output. The frontend appends it to bounded terminal buffers and may refresh display-only output freshness metadata. It does not parse raw terminal output for Codex prompt readiness, submitted prompts, active work, approval prompts, stale redraws, or effective Codex profile.

`terminal:session-updated` carries a full `TerminalSessionRecord`. The frontend upserts it into `terminalSessions`; this backend record is authoritative for terminal turn state, prompt timestamps, approval timestamps, runtime, and effective profile. On the backend, emitting this event also emits `employee:activity-updated` for the same employee.

`employee:activity-updated` tells the frontend to refresh canonical activity. In `bootstrapSlice.ts`, the frontend calls `employee_activity_get` for the affected employee, or reloads all activities when no employee id is provided.

The floor must not infer employee state directly from terminal text because terminal output is only one evidence source and PTY text is lossy. The intended path is:

1. Backend evidence updates terminal sessions, runtime snapshots, actions, approvals, processes, review, handoff, blockers, and employee lifecycle.
2. `activity.rs` derives `EmployeeActivity`.
3. `activity_contract.rs` resolves `EmployeeActivity.contract`.
4. `employeeActivityContractView.ts` maps the contract to presentation state, detail, attention, and floor intent.
5. `employeeFloorViewModel.ts` maps floor intent into desk, owner office, done room, standby, or offline zones.

### Activity Refresh Guarantees

Backend mutation paths that can affect `EmployeeActivity.contract` should emit `employee:activity-updated` directly or through a state-specific helper:

- `emit_terminal_session_updated` emits `terminal:session-updated` and then `employee:activity-updated` for the session owner.
- `emit_employee_updated` emits `employee:updated` and then `employee:activity-updated` for that employee.
- `emit_action_updated`, `emit_approval_updated`, and `emit_process_updated` emit their domain update event and then refresh activity for the affected employee.
- Git review and handoff mutations that change review counts, handoff readiness, or blockers call `emit_employee_activity_updated` for the employee.
- Workspace switching clears workspace-bound state and emits a global `employee:activity-updated` with no employee id so the frontend reloads all activities.

The Phase 6 audit covered terminal output/input, active-profile changes, CWD changes, terminal stop/finish/fail, Codex app-server structured events and errors, employee lifecycle changes, actions, approvals, managed processes, review and handoff mutations, and workspace switch cleanup. Direct backend event mocking was not added because Tauri event assertions require an `AppHandle`; the contract is instead centralized in the helper functions above and covered through command/store behavior.

On the frontend, activity refreshes are protected against out-of-order async responses. Each per-employee `employee_activity_get` request receives a monotonic sequence id, and only the latest request for that employee can write to `employeeActivities`. A global `employee_activity_list` reload also receives a sequence id; stale global responses are ignored, and a global reload does not overwrite newer per-employee refresh results. This keeps rapid `terminal:session-updated` and `employee:activity-updated` delivery from leaving the floor stuck on stale activity when a slower earlier refresh resolves after a newer one.

### Diagnostics Trace

The diagnostics export includes an employee activity trace for each exported `EmployeeActivity`. The trace is compact and answers why the backend placed an employee in a given state:

- legacy activity evidence: status, lifecycle, behavior, terminal state, and activity reason.
- active terminal evidence: session id, status, runtime, launch profile, active profile, turn state, prompt/approval timestamp fields, and `lastTransitionReason`.
- agent runtime evidence: kind, state, source, confidence, and turn owner.
- canonical contract evidence: lifecycle, work, render, attention, source runtime, and source confidence.
- surrounding context: active action id, active process ids/count, review counts, blockers, and last activity timestamp.

Terminal session diagnostics also include `lastTransitionReason` alongside runtime, profile, active profile, turn state, and prompt timestamps. This reason is intended for support/debugging so a wrong-state report can be traced back to the most recent backend transition decision. Frontend floor placement must still route through `EmployeeActivity.contract`; transition reasons are not a presentation API.

Diagnostics continue to exclude raw terminal output, raw process logs, environment variables, credentials/tokens, and file-write contents. Paths, labels, messages, and other diagnostic strings are redacted/truncated at export time.

## Current Risk Areas

- PTY output is not a stable protocol. Codex UI text, prompt glyphs, progress wording, and redraw behavior can change outside Slavey's control. The Codex notify side-channel records turn completion authoritatively for PTY sessions, which removes the dependence on recognizing working/prompt text at turn end; remaining PTY heuristics still cover turn start, approval prompts, and platforms or shells where the notify bridge is unavailable.
- Redraws, ANSI/control sequences, carriage returns, and split chunks can create edge cases. The parser handles known stale redraws and split Slavey control markers, but the corpus is not complete.
- Frontend terminal buffers may update before the matching `terminal:session-updated` record arrives. During that gap, terminal text can be fresher than terminal session turn metadata, but backend session records remain authoritative for Codex state.
- Activity refresh responses can still be delayed by IPC or command latency, but stale responses are ignored so a slower old refresh should not overwrite a newer backend activity contract.
- Diagnostics now expose the terminal/session evidence, runtime source/confidence, activity reason, and activity contract chain. They make wrong-state bugs easier to explain, but they do not make PTY fallback signals less heuristic.
- The fixture corpus and stress matrix cover important prompt-ready, approval, active-work, owner-draft, app-server, stale-redraw, duplicate-redraw, chunk-boundary, and single-character streaming cases. They are broader than targeted unit tests, but still not a full transcript replay suite.
- Structured app-server evidence is preferred, but shell-launched Codex still relies on PTY fallback, wrapper markers, and the scoped Codex notify bridge.
- CWD markers are currently shell-integration dependent. Unsupported shells or failed shell integration can leave `current_cwd` at the start directory even when terminal output and activity continue normally.

The items above are remaining production risks. This document records current behavior and does not imply runtime changes.

## Remaining Hardening Work

The terminal/Codex hardening phases described in this document are complete and reflected in the flow, mapping, diagnostics, refresh, fixture, and stress-matrix sections above. Remaining follow-up work should be scoped as new changes rather than presented as incomplete phase work:

- Add broader sanitized transcript replay cases when new PTY edge cases are found in production.
- Add state-driven browser smoke coverage for terminal/activity/floor transitions once it can stay stable and cheap.
- Reduce reliance on PTY fallback for shell-launched Codex where a stronger structured source or wrapper protocol can be used.
- Split large frontend chunks in a separate performance pass instead of hiding build warnings.
