# Engineering Rules

These rules keep Slavey changes reviewable, validated, and aligned with the app's safety boundaries.

## Required Checks

- Run `npm run check` before pushing.
- Run `npm run build` before release-like changes.
- The existing Vite large chunk warning is acceptable until frontend splitting is handled separately.

## Local Hooks

- Install hooks with `npm run install-hooks`.
- The pre-commit hook is intentionally fast and runs formatting plus TypeScript validation.
- The pre-push hook runs full local validation with `npm run check`.
- Use `--no-verify` only for clearly documented exceptions, such as an external outage or a deliberately staged infrastructure step.

## Git Workflow

- Start each phase with `git status --short --branch`.
- Commit after each complete phase.
- Push regularly to `origin/main`.
- Finish with a clean `git status --short --branch`.

## Backend Safety Principles

- Do not persist credentials or tokens in JSON state, logs, action records, terminal session metadata, or process logs.
- Filesystem operations must go through backend validation.
- Employee worktrees are the preferred execution boundary.
- Structured process, git, and shell commands must be non-interactive, timeout-bounded, and output-capped.
- Destructive operations require explicit user confirmation or approval.
- Restored running processes, actions, and terminal sessions after app restart must become stopped or failed, never silently resumed.

## Frontend Safety Principles

- The frontend must not trust raw filesystem paths without backend validation.
- Render backend-provided blockers and disabled reasons instead of guessing.
- Editor state must treat backend filesystem validation and metadata as canonical.
- Destructive file operations require visible errors and confirmation where configured.
- Unsaved editor changes must be guarded before workspace switches, file switches, or editor close.
- Terminal buffers and process logs must stay bounded.
- Actions and approvals are the audit layer for structured risky operations.
- Invalid action or approval UI controls should be driven by backend state and disabled reasons.
- Persisted action history must stay bounded and must not contain secrets or raw file-write contents.
- Worktree review state must be backend-owned and structured; frontend review UI should not infer git safety from raw text.
- Handoff apply and abort must require explicit user confirmation, and conflicts must be surfaced rather than auto-resolved.
- Remote status is read-only until a dedicated push/PR phase; do not auto-push or call hosting APIs from review code.
- Employee and game UI must use backend employee activity state as the source of truth.
- Terminal output must not be parsed for status unless a future explicit structured protocol is added.
- Frontend raw Tauri `invoke` calls should live in the typed command layer, not directly in panels or store actions.
- Split large frontend panels before adding new behavior, and avoid mixing visual redesign with infrastructure refactors.
- Store growth should move into domain slices before adding new workflows; preserve the public `useAppStore` API unless a dedicated migration is planned.
- CSS should be split by UI domain before adding new visual systems or animated surfaces.
- Future animated employee UI must stay a presentation layer over backend activity/status state.
- Future animated/game UI should live behind component boundaries and consume backend activity state.
- Terminal metadata may be persisted, but raw terminal output must not be persisted unless explicitly bounded and sanitized.
- Terminal operations must validate employeeId and sessionId ownership at the backend boundary.
- Diagnostics and support bundles are opt-in, local-only, and redacted by default.
- Diagnostics must never include terminal output, environment variables, credentials, tokens, raw process logs, or file-write contents.
- Tauri capabilities should remain minimal; do not add shell, filesystem, HTTP, clipboard, or broader plugin permissions without a dedicated security review.
- The Tauri CSP should stay explicit. The current inline-style exception is for the existing webview UI/runtime style injection and should be revisited before adding a new visual system.
- Future employee and game UI should be a presentation layer over backend state, not a second source of truth.

## Module-Size Rules

- Large Rust files are acceptable temporarily when tests are included and logic is cohesive.
- New growth should split modules once a file is around 700-900 lines or has multiple responsibilities.
- Prefer splitting by domain boundary: git runner/parsing/review/handoff, terminal session store/Codex status/PTY handling, filesystem path safety/file operations/search, and actions state/execution/approval transitions.
- For large Rust command modules, keep public Tauri commands and command payloads at the module boundary, and extract cohesive private submodules for helpers, parsers, runners, stores, or state transitions.
- Refactor-only backend phases should move tests with the logic they cover where practical and avoid behavior or response-shape changes.
- For frontend state, keep Zustand domain slices aligned with workspace, employees/activity, terminal, actions/approvals, review/git, editor/files, and process/log domains.
- Do not mix large refactors with feature phases.

## Testing Expectations

- Rust tests should cover path safety, process lifecycle, action transitions, git parsing, persistence restore behavior, approval gates, and terminal ownership/session behavior.
- Frontend helper, store, and component tests should cover UI infrastructure before adding visual or game work.
- Frontend tests should mock Tauri APIs through the typed command boundary and shared test setup, not through scattered ad hoc mocks.
- Avoid brittle visual snapshot tests for now; prefer state-driven render and smoke tests.
- Future animated employee UI should include render tests driven by backend `EmployeeActivity` state.
- Browser-level smoke/E2E coverage should be added in a dedicated phase once the web app can be tested without increasing local validation cost too much.
