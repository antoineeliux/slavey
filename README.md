# Slavey

Release-candidate MVP desktop app for managing local AI coding-agent employees. Slavey uses Tauri 2, a Rust backend, React + TypeScript, Vite, xterm.js, CodeMirror 6, and a Zustand store.

## Current MVP

- Open and switch local workspaces with visible repo health, Codex CLI availability, Git identity blockers, diagnostics, and recent workspaces.
- Create, select, and remove employees, optionally backed by Git worktrees.
- Start shell sessions per employee with structured session history, ownership checks, and automatic Codex CLI detection when `codex` runs inside the shell.
- Use the file tree, recent files, search, and editor with dirty-state and save-conflict messaging.
- Review employee worktree changes grouped by conflicted, staged, unstaged, and untracked files.
- Commit employee worktree changes and run explicit handoff preflight/apply/abort flows without push or PR automation.
- Track actions, approvals, managed processes, logs, and diagnostics without persisting raw terminal output or secrets.
- See the animated employee command floor driven by backend-shaped `EmployeeActivity` plus structured actions, approvals, terminal sessions, reviews, handoffs, and processes.

## Development

```sh
npm install
npm run install-hooks
npm run test:web:run
npm run test:e2e:run
npm run check
npm run dev
npm run build
```

The Tauri app serves the Vite frontend at `http://localhost:1420` during development.

Use these commands for release-candidate validation:

```sh
npm run check
npm run test:e2e:run
npm run build
```

Browser smoke/E2E tests run with Playwright against the Vite app and explicit mock Tauri data:

```sh
npm run test:e2e:run
```

For the interactive runner:

```sh
npm run test:e2e
```

If Chromium is not installed locally, install it with:

```sh
npx playwright install chromium
```

The E2E harness sets `VITE_SLAVEY_E2E=true` through Playwright's web server environment, which keeps browser tests on mock workspace, diagnostics, employee, activity, terminal, action, approval, and review data. These tests are app-shell regression smoke tests, not backend validation. Playwright output folders are ignored by Git, and `npm run check` includes a production bundle guard that fails if E2E fixture strings leak into `dist/`.

See [Engineering Rules](docs/engineering-rules.md) for validation, Git workflow, and safety standards.

## Workspace Safety

The backend restricts file reads and writes to the selected workspace root. In development, that root defaults to the project directory. You can override it with:

```sh
SLAVEY_WORKSPACE_ROOT=/path/to/workspace npm run dev
```

## Process Cleanup

On Unix/macOS, structured actions and managed background processes are spawned in a new session/process group, and cancellation attempts to terminate the full group. On Windows, process cleanup currently terminates the direct child process only; full process-tree cleanup should use Job Objects in a later phase.

## Remaining Limitations

- No push, pull request, or remote hosting automation.
- Handoff conflicts are surfaced for manual resolution; Slavey does not auto-resolve conflicts.
- The employee visualization is a lightweight CSS command-floor layer, not full character art.
- Windows managed-process cleanup does not yet terminate full process trees.
