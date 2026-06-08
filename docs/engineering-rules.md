# Engineering Rules

These rules keep Slavey changes reviewable, validated, and aligned with the app's safety boundaries.

## Required Checks

- Run `npm run check` before pushing.
- Run `npm run build` before release-like changes.
- Run `npm run test:e2e:run` when touching app-shell, tab loading, Tauri command plumbing, or browser-critical employee floor UI.
- `npm run check` runs the production bundle guard after Vite build to catch E2E fixture leakage into `dist/`.
- The existing Vite large chunk warning is acceptable until frontend splitting is handled separately.

## Local Hooks

- Install hooks with `npm run install-hooks`.
- The pre-commit hook is intentionally fast and runs formatting plus TypeScript validation.
- The pre-push hook runs full local validation with `npm run check`.
- Browser E2E smoke tests are not part of pre-push yet; add them only after they are proven extremely stable and fast.
- Playwright artifact folders (`test-results/`, `playwright-report/`, and `blob-report/`) are ignored and should not be committed.
- Use `--no-verify` only for clearly documented exceptions, such as an external outage or a deliberately staged infrastructure step.

## Git Workflow

- Start each phase with `git status --short --branch`.
- Commit after each complete phase.
- Push regularly to `origin/main`.
- Finish with a clean `git status --short --branch`.

## Backend Safety Principles

- `EmployeeActivity.contract` is the canonical backend-owned activity contract. Changes to employee visual routing or attention state should start in `activity.rs` and `activity_contract.rs`.
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
- Employee floor UI must use backend employee activity state as the source of truth.
- `EmployeeActivity.contract` is the canonical employee activity contract. Frontend presentation, floor routing, and actor behavior must consume the contract when an activity record exists.
- Legacy employee activity fields such as `status`, `behavior`, `terminalState`, `agent`, `label`, and `details` are compatibility and diagnostics data only; they must not override contract-backed visual routing or display state.
- The no-activity fallback path exists only for first-load safety before an `EmployeeActivity` record arrives.
- Frontend code must not parse raw terminal output to infer Codex turn state, prompt readiness, approval waits, active work, stale redraws, or effective profile. Use backend `TerminalSessionRecord` updates and `EmployeeActivity.contract`.
- Terminal output parsing is allowed only as bounded PTY fallback evidence in the terminal session/runtime modules. Prefer structured Codex app-server evidence whenever available, and cover parser changes with regression tests.
- Frontend raw Tauri `invoke` calls should live in the typed command layer, not directly in panels or store actions.
- Split large frontend panels before adding new behavior, and avoid mixing visual redesign with infrastructure refactors.
- Store growth should move into domain slices before adding new workflows; preserve the public `useAppStore` API unless a dedicated migration is planned.
- CSS should be split by UI domain before adding new visual systems or animated surfaces.
- Heavy editor, terminal, and employee floor dependencies should be lazy-loaded or isolated behind component/runtime boundaries.
- Do not add large visual/runtime dependencies to the initial shell bundle without review.
- Bundle chunk warnings should be fixed by splitting lazy paths or vendor chunks, not hidden by only raising warning limits.
- Employee floor rendering must stay a presentation layer over backend activity contract state.
- Employee floor and other heavy visual UI should live behind component/runtime boundaries and consume backend-owned state.
- Terminal metadata may be persisted, but raw terminal output must not be persisted unless explicitly bounded and sanitized.
- Terminal operations must validate employeeId and sessionId ownership at the backend boundary.
- Diagnostics and support bundles are opt-in, local-only, and redacted by default.
- Diagnostics must never include terminal output, environment variables, credentials, tokens, raw process logs, or file-write contents.
- Tauri capabilities should remain minimal; do not add shell, filesystem, HTTP, clipboard, or broader plugin permissions without a dedicated security review.
- The Tauri CSP should stay explicit. The current inline-style exception is for the existing webview UI/runtime style injection and should be revisited before adding a new visual system.
- Employee floor UI should be a presentation layer over backend state, not a second source of truth.

## Documentation Standards

- Keep `README.md` as the short entry point for product scope, setup, validation, safety, docs links, and limitations.
- Keep `docs/architecture.md` current when backend modules, frontend slices, command boundaries, event flows, persistence, diagnostics, or major runtime flows change.
- Keep `docs/activity-contract.md` current when `EmployeeActivity`, terminal runtime evidence, contract rules, floor routing, or actor behavior changes.
- Keep `docs/terminal-evidence-flow.md` current when terminal parsing, Codex app-server evidence, runtime snapshots, terminal events, or activity refresh semantics change.
- Keep `CONTRIBUTING.md` current when setup, checks, workflow, contribution expectations, or safety boundaries change.
- Update documentation in the same phase as the behavior change when a change alters contributor expectations or user-visible system behavior.
- Do not document aspirational behavior as current behavior. Clearly label limitations and future work.

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
- Terminal parser changes should add or update sanitized cases in the PTY fixture corpus and deterministic stress matrix in `src-tauri/src/terminal/session_fixture_tests.rs`.
- Frontend helper, store, and component tests should cover UI infrastructure before adding visual or game work.
- Frontend tests should mock Tauri APIs through the typed command boundary and shared test setup, not through scattered ad hoc mocks.
- Avoid brittle visual snapshot tests for now; prefer state-driven render and smoke tests.
- Employee floor UI should include render tests driven by backend `EmployeeActivity` state.
- Browser-level smoke/E2E coverage should be added in a dedicated phase once the web app can be tested without increasing local validation cost too much.
- Browser smoke/E2E runs with explicit browser-only `VITE_SLAVEY_E2E=true` mock Tauri data at the typed command boundary.
- Browser smoke/E2E is for blank screens, broken tab/lazy-loading paths, employee activity rendering, diagnostics actions, and app-shell regressions, not backend behavior validation.
- Production bundles must not include E2E fixture data; keep E2E mock imports guarded and centralized around `src/lib/tauriCommands.ts` and `src/lib/e2eTauriMock.ts`.
- Employee floor UI should add state-driven browser smoke coverage here, using backend-shaped `EmployeeActivity` mock data rather than animation timing or pixel-perfect assertions.
