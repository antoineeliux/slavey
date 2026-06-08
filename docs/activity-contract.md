# Employee Activity Contract

`EmployeeActivity.contract` is the canonical contract for employee work state and visual routing.

This contract exists because the UI previously inferred "working" from several legacy fields and terminal text signals. That caused drift. The current design has one backend-owned contract, one frontend adapter, and explicit tests at each boundary.

## Source Files

- Backend resolver: `src-tauri/src/activity_contract.rs`
- Backend evidence collection: `src-tauri/src/activity.rs`
- Frontend shared types: `src/types.ts`
- Frontend contract adapter: `src/lib/employeeActivityContractView.ts`
- Floor routing: `src/components/employee-floor/employeeFloorViewModel.ts`
- Character behavior: `src/components/employee-floor/scene/characterBehavior.ts`

## Contract Shape

Serialized TypeScript shape:

```ts
type EmployeeActivityContract = {
  lifecycle: "active" | "standby" | "stopped" | "failed";
  work: {
    kind: "none" | "shell" | "codex" | "action" | "process" | "review";
    phase:
      | "idle"
      | "starting"
      | "working"
      | "waiting_owner"
      | "waiting_approval"
      | "ready"
      | "blocked";
    turnOwner: "none" | "owner" | "agent" | "tool";
  };
  render: {
    placement: "desk" | "owner_office" | "standby" | "done_room" | "offline";
    posture: "sitting" | "standing";
    activity:
      | "idle"
      | "working"
      | "terminal"
      | "waiting_instruction"
      | "approval"
      | "review"
      | "handoff"
      | "blocked";
  };
  attention: {
    required: boolean;
    reason:
      | "needs_instruction"
      | "needs_approval"
      | "needs_app_approval"
      | "needs_terminal_approval"
      | "ready_to_report"
      | "review_needed"
      | "handoff_ready"
      | "blocked_needs_help"
      | null;
    priority: "none" | "normal" | "urgent";
  };
  source: {
    runtime: "none" | "pty" | "codex_app_server";
    confidence: "none" | "fallback" | "structured";
  };
};
```

## Field Semantics

### `lifecycle`

High-level employee lifecycle. Standby and stopped lifecycle states override active work evidence.

### `work`

Canonical work semantics.

- `kind` names the kind of work.
- `phase` describes where that work is in its lifecycle.
- `turnOwner` identifies who must act next.

Examples:

- Codex thinking: `{ kind: "codex", phase: "working", turnOwner: "agent" }`
- Waiting for user prompt: `{ kind: "codex", phase: "waiting_owner", turnOwner: "owner" }`
- Running managed process: `{ kind: "process", phase: "working", turnOwner: "tool" }`

### `render`

Canonical visual intent. This is what the frontend uses to decide where the employee goes and whether they sit.

Important invariant:

- `placement: "desk"` always implies `posture: "sitting"`.
- Every non-desk placement implies `posture: "standing"`.
- Desk placement is reserved for productive `working` or `terminal` activity.

### `attention`

Whether the owner needs to act.

Owner-office states must have:

- `required: true`
- a non-null `reason`
- `turnOwner: "owner"`

### `source`

Where the runtime signal came from.

- `codex_app_server` plus `structured`: structured Codex app-server evidence.
- `pty` plus `fallback`: PTY/session fallback evidence.
- `none` plus `none`: no active runtime signal.

## Status To Contract Rules

The backend keeps an explicit `STATUS_CONTRACT_RULES` table. Tests require one rule for every `EmployeeActivityStatus`.

| Status | Work kind | Render placement | Render activity | Meaning |
| --- | --- | --- | --- | --- |
| `idle` | `none` | `done_room` | `idle` | Available, not working. |
| `shell_running` | `shell` | `done_room` | `terminal` | Shell is open, but this is not productive desk work. |
| `codex_starting` | `codex` | `done_room` | `terminal` | Codex session is starting, but no active turn is running yet. |
| `codex_running` | `codex` | `desk` | `working` | Codex/agent owns the turn and is actively working. |
| `codex_waiting_instruction` | `codex` | `owner_office` | `waiting_instruction` | Codex is waiting for the owner to provide a prompt. |
| `codex_waiting_approval` | `codex` | `owner_office` | `approval` | Codex is waiting for terminal approval. |
| `standby` | `none` | `standby` | `idle` | Employee is parked in standby. |
| `action_pending_approval` | `action` | `owner_office` | `approval` | App action needs owner approval. |
| `action_running` | `action` | `desk` | `working` | Structured app action is running. |
| `process_running` | `process` | `desk` | `terminal` | Managed process is running. |
| `review_needed` | `review` | `owner_office` | `review` | Worktree changes need owner review. |
| `handoff_ready` | `review` | `owner_office` | `handoff` | Handoff is ready for owner action. |
| `done_clean` | `review` | `owner_office` | `handoff` | Work is done and ready to report. |
| `blocked` | `none` | `owner_office` | `blocked` | Employee needs owner help. |
| `stopped` | `none` | `offline` | `idle` | Employee/session is offline. |

## Evidence Priority

`activity.rs` collects evidence first, then resolves legacy compatibility fields and the canonical contract.

The current high-level priority is:

1. Standby/stopped lifecycle.
2. Terminal owner-wait states, such as prompt needed or terminal approval needed.
3. Employee blocked/failed state and hard blockers.
4. Active actions.
5. Pending actions or approvals.
6. Active managed processes.
7. Terminal/agent runtime state.
8. Review changes.
9. Handoff ready.
10. Done.
11. Idle.

The contract resolver is evidence-driven and no longer depends on legacy UI presentation fields.

## Frontend Consumption

Frontend code should follow this path:

1. Receive `EmployeeActivity`.
2. Call `resolveEmployeeActivityContractView(activity)`.
3. Use `contractView.state`, `label`, `detail`, `attentionRequired`, `attentionReason`, and `floorIntent`.
4. Route the employee through `createEmployeeFloorViewModel`.

When an activity record exists, do not use these legacy fields to override contract-backed visuals:

- `activity.status`
- `activity.behavior`
- `activity.terminalState`
- `activity.agent`
- `activity.label`
- `activity.details`

Those fields are compatibility and diagnostics metadata.

The only intentional fallback is first-load/no-activity UI rendering before an `EmployeeActivity` record arrives.

## Terminal And Codex Details

Terminal session evidence includes:

- `runtime`: PTY or Codex app-server.
- `activeProfile`: shell or codex.
- `turnState`: shell, Codex starting, owner prompt ready, owner composing, prompt submitted, agent working, waiting approval, completed, failed.
- prompt and approval timestamps.

PTY fallback parsing handles:

- Codex prompt-ready output.
- terminal approval prompts.
- active work output such as `Working ... esc to interrupt`.
- owner draft echo, which must not become agent work.

Codex app-server sessions use structured events where possible. Structured app-server snapshots must not be overwritten by weaker PTY fallback state.

## Invariants And Tests

Backend invariant tests in `activity_contract.rs` enforce:

- Every `EmployeeActivityStatus` has exactly one contract rule.
- Duplicate status rules fail.
- Desk placement sits.
- Non-desk placement stands.
- Desk rules must be productive.
- Owner-office rules require owner attention and owner turn ownership.

Frontend tests enforce:

- Contract visual adapter exhaustiveness.
- Contract-first presentation and details.
- Contract-first floor routing.
- Rendered employee scene behavior.
- Character behavior for desk, done room, owner office, standby, and offline states.
- Live refresh paths for submit, terminal session updates, and employee activity updates.

## Adding Or Changing A State

When adding an employee state:

1. Add/update backend enum values in `activity.rs` if needed.
2. Add exactly one `STATUS_CONTRACT_RULES` entry in `activity_contract.rs`.
3. Update `contract_work`, attention, source, or evidence helpers if the new state needs custom behavior.
4. Update TypeScript unions in `src/types.ts`.
5. Update `src/lib/employeeActivityContractView.ts` exhaustively.
6. Update `employeeFloorViewModel.ts` if a new floor intent is needed.
7. Add Rust resolver tests and frontend adapter/floor/render tests.
8. Run `npm run check`.

Do not add frontend-only heuristics for activity routing. If a user-visible employee state is wrong, fix the backend evidence or contract resolver first.
