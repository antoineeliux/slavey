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
- Terminal buffers and process logs must stay bounded.
- Future employee and game UI should be a presentation layer over backend state, not a second source of truth.

## Module-Size Rules

- Large Rust files are acceptable temporarily when tests are included and logic is cohesive.
- New growth should split modules once a file is around 700-900 lines or has multiple responsibilities.
- Prefer splitting by domain boundary: git runner/parsing/review/handoff, terminal session store/Codex status/PTY handling, filesystem path safety/file operations/search, and actions state/execution/approval transitions.
- For large Rust command modules, keep Tauri commands at the module boundary and extract cohesive private submodules for pure helpers or runners.
- Do not mix large refactors with feature phases.

## Testing Expectations

- Rust tests should cover path safety, process lifecycle, action transitions, git parsing, persistence restore behavior, approval gates, and terminal ownership/session behavior.
- Frontend code must at least pass TypeScript validation until a frontend test framework is introduced.
