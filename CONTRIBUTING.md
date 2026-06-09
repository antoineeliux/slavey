# Contributing

Thanks for working on Slavey. This project is a local desktop app with a Rust backend and a React/TypeScript frontend, so changes should preserve both user safety and local validation reliability.

## Setup

Install dependencies:

```sh
npm install
```

Install Git hooks:

```sh
npm run install-hooks
```

Run the app:

```sh
npm run dev
```

Run the web frontend only:

```sh
npm run dev:web
```

## Required Local Checks

Before pushing:

```sh
npm run check
```

For browser smoke coverage:

```sh
npm run test:e2e:run
```

Use targeted checks while developing:

```sh
npm run typecheck
npm run test:web:run
cd src-tauri && cargo test
```

The pre-commit hook runs Rust formatting checks and TypeScript typecheck. The pre-push hook runs `npm run check`.

## CI Gate

GitHub Actions runs the same non-browser validation gate on pull requests and pushes to `main`.

CI installs dependencies with `npm ci`, uses Node.js 22 LTS and stable Rust, then runs:

- `npm run check:web`
- `npm run check:rust`

Browser smoke tests remain a separate local check for now and are not part of the CI gate.

## Git Workflow

- Start with `git status --short --branch`.
- Keep commits reviewable and grouped by behavior.
- Commit complete phases, not half-finished changes.
- Do not mix broad refactors with feature behavior.
- Finish with a clean `git status --short --branch`.

## Code Boundaries

### Backend

- Add Tauri commands in Rust modules and register them in `src-tauri/src/lib.rs`.
- Validate filesystem paths in the backend.
- Keep shell/process commands timeout-bounded and output-capped.
- Do not persist secrets, credentials, raw terminal output, environment variables, raw process logs, or file-write contents.
- Emit domain events when frontend state needs live refresh.

### Frontend

- Do not call raw Tauri `invoke` outside `src/lib/tauriCommands.ts`.
- Add shared payload types in `src/types.ts`.
- Put state updates in the relevant Zustand slice in `src/store/slices`.
- Keep E2E mocks behind `src/lib/e2eTauriMock.ts`.
- Keep UI decisions driven by backend data and explicit disabled reasons.
- Do not parse raw terminal output in frontend code to infer Codex turn state, prompt readiness, approval waits, active work, stale redraws, or effective profile.

### Employee Activity

`EmployeeActivity.contract` is canonical. If employee visuals, attention state, or floor routing are wrong, fix backend evidence or the activity contract resolver first.

Do not add frontend heuristics that override contract-backed employee state when an activity record exists.

See [Employee Activity Contract](docs/activity-contract.md).

## Testing Expectations

Add tests at the boundary you change:

- Rust tests for backend state, parser, process, filesystem, Git, diagnostics, persistence, activity contract, and terminal runtime changes.
- Vitest tests for frontend adapters, store slices, panels, floor view models, and rendered scene behavior.
- Playwright smoke tests for app-shell regressions, blank screens, lazy-loading, diagnostics actions, and critical browser-only flows.

Prefer focused behavioral tests over broad snapshots.

## Documentation Expectations

Update docs when changing:

- public setup or validation commands.
- backend/frontend architecture.
- Tauri command payloads and domain boundaries.
- employee activity contract semantics.
- safety, persistence, or diagnostics behavior.
- known limitations.

The primary docs are:

- `README.md`
- `docs/architecture.md`
- `docs/activity-contract.md`
- `docs/terminal-evidence-flow.md`
- `docs/engineering-rules.md`

## Security And Safety

Slavey runs local commands and edits local files. Treat safety regressions as high priority.

- Keep destructive actions explicit.
- Keep diagnostics redacted.
- Keep Tauri permissions minimal.
- Keep file operations workspace-scoped.
- Do not add network, shell, filesystem, clipboard, or broader plugin permissions without a dedicated security review.

## Pull Request Checklist

Before opening a PR or asking for review:

- [ ] The change is scoped and grouped coherently.
- [ ] New behavior has tests.
- [ ] `npm run check` passes.
- [ ] Documentation is updated when behavior or architecture changes.
- [ ] No raw secrets, terminal output, process logs, or E2E fixtures are added to production paths.
