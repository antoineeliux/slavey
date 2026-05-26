# Slavey

MVP desktop app for managing AI coding-agent employees. The app uses Tauri 2, a Rust backend, React + TypeScript, xterm.js, CodeMirror 6, and a small Zustand store.

## Development

```sh
npm install
npm run dev
```

The Tauri app serves the Vite frontend at `http://localhost:1420` during development.

## Build

```sh
npm run typecheck
npm run build
```

## Workspace Safety

The backend restricts file reads and writes to the selected workspace root. In development, that root defaults to the project directory. You can override it with:

```sh
SLAVEY_WORKSPACE_ROOT=/path/to/workspace npm run dev
```

## Process Cleanup

On Unix/macOS, structured actions and managed background processes are spawned in a new session/process group, and cancellation attempts to terminate the full group. On Windows, process cleanup currently terminates the direct child process only; full process-tree cleanup should use Job Objects in a later phase.

## Future Milestones

1. Codex CLI launch per employee.
2. Git worktree per employee.
3. Approval gates before risky commands.
4. Diff and review UI.
5. Real animated character assets.
