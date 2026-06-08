import type {
  Action,
  ActionKind,
  AppSettings,
  AppStateSnapshot,
  ApprovalRequest,
  CodexCliStatus,
  CodexTaskSubmitInput,
  DiagnosticsEmployeeActivityMetadata,
  DiagnosticsExportBundle,
  DiagnosticsSummary,
  DiagnosticsTerminalSessionMetadata,
  Employee,
  EmployeeActivity,
  EmployeeRole,
  FileMetadata,
  FilePayload,
  FsEntry,
  FsSearchResult,
  GitPathChanges,
  ManagedProcess,
  ProcessLogs,
  RolePolicy,
  TerminalSessionRecord,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
  WorktreeStatus,
  WorkspaceInfo,
} from "../types";
import type {
  CreateActionInput,
  CreateApprovalInput,
  CreateEmployeeInput,
  SetEmployeeWorkingFolderInput,
} from "./tauriCommands";

type InvokeArgs = Record<string, unknown>;

const now = 1_713_555_600_000;
const workspaceRoot = "/workspace";
const frontendCwd = `${workspaceRoot}/.slavey/worktrees/frontend-smoke`;

const settings: AppSettings = {
  defaultTerminalProfile: "shell",
  requireConfirmationDiscard: true,
  requireConfirmationDelete: true,
  requireConfirmationHandoffApply: true,
  maxTerminalBufferChars: 250_000,
};

const codexCliStatus: CodexCliStatus = {
  available: false,
  version: null,
  message: "Codex CLI unavailable in browser smoke mock mode.",
};

const employees: Employee[] = [
  {
    id: "emp-frontend",
    name: "Mira Frontend",
    role: "frontend",
    status: "running",
    cwd: frontendCwd,
    worktreePath: frontendCwd,
    branchName: "slavey/mira-frontend",
    terminalSessionId: "term-frontend",
    currentCommand: "npm run test:web:run",
    createdAt: now - 3_600_000,
    updatedAt: now - 45_000,
  },
  {
    id: "emp-reviewer",
    name: "Noah Reviewer",
    role: "reviewer",
    status: "idle",
    cwd: workspaceRoot,
    worktreePath: null,
    branchName: null,
    terminalSessionId: null,
    currentCommand: null,
    createdAt: now - 2_400_000,
    updatedAt: now - 120_000,
  },
];

const employeeActivities: EmployeeActivity[] = [
  {
    employeeId: "emp-frontend",
    status: "review_needed",
    contract: mockActivityContract("review_needed"),
    label: "Review needed",
    details: "Applying layout smoke fixtures",
    lastActivityAt: now - 45_000,
    activeTerminalSessionId: "term-frontend",
    activeActionId: "action-1",
    activeProcessIds: ["proc-1"],
    reviewCounts: {
      changedFiles: 2,
      stagedFiles: 1,
      untrackedFiles: 1,
    },
    blockers: [],
  },
  {
    employeeId: "emp-reviewer",
    status: "idle",
    contract: mockActivityContract("idle"),
    label: "Idle",
    details: "Ready for review assignment",
    lastActivityAt: now - 120_000,
    activeTerminalSessionId: null,
    activeActionId: null,
    activeProcessIds: [],
    reviewCounts: {
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
    },
    blockers: [],
  },
];

const terminalSessions: TerminalSessionRecord[] = [
  {
    sessionId: "term-frontend",
    employeeId: "emp-frontend",
    profile: "shell",
    runtime: "pty",
    cwd: frontendCwd,
    currentCwd: `${frontendCwd}/src`,
    status: "running",
    startedAt: now - 1_200_000,
    label: "Mock shell",
    lastOutputAt: now - 30_000,
    turnState: "shell",
    message: "Browser smoke session seeded by VITE_SLAVEY_E2E.",
  },
  {
    sessionId: "term-review",
    employeeId: "emp-reviewer",
    profile: "codex",
    runtime: "pty",
    cwd: workspaceRoot,
    currentCwd: workspaceRoot,
    status: "stopped",
    exitCode: 0,
    startedAt: now - 2_000_000,
    endedAt: now - 1_900_000,
    stoppedAt: now - 1_900_000,
    stopReason: "user_stopped",
    label: "Completed review check",
    turnState: "completed",
    message: "Stopped cleanly.",
  },
];

const approvals: ApprovalRequest[] = [
  {
    id: "approval-1",
    employeeId: "emp-frontend",
    actionId: "action-1",
    kind: "shell_command",
    title: "Run workspace smoke command",
    description: "Approval fixture for browser smoke coverage.",
    command: "npm run test:web:run",
    cwd: frontendCwd,
    status: "pending",
    createdAt: now - 90_000,
  },
];

const actions: Action[] = [
  {
    id: "action-1",
    employeeId: "emp-frontend",
    kind: "shell_command",
    title: "Run workspace smoke command",
    description: "Mock action waiting on approval.",
    cwd: frontendCwd,
    command: "npm run test:web:run",
    source: "employee",
    timeoutSecs: 120,
    outputCapBytes: 64_000,
    approvalId: "approval-1",
    status: "pending_approval",
    output: "",
    createdAt: now - 90_000,
    updatedAt: now - 90_000,
  },
  {
    id: "action-2",
    employeeId: "emp-reviewer",
    kind: "git_operation",
    title: "Inspect review status",
    description: "Mock completed review action.",
    cwd: workspaceRoot,
    source: "system",
    timeoutSecs: 120,
    outputCapBytes: 64_000,
    status: "succeeded",
    output: "Review fixture loaded.",
    createdAt: now - 300_000,
    updatedAt: now - 240_000,
    startedAt: now - 280_000,
    finishedAt: now - 240_000,
  },
];

const processes: ManagedProcess[] = [
  {
    id: "proc-1",
    employeeId: "emp-frontend",
    title: "Mock watcher",
    command: "npm run dev:web",
    cwd: frontendCwd,
    status: "running",
    createdAt: now - 600_000,
    updatedAt: now - 20_000,
  },
];

const rolePolicies: RolePolicy[] = [
  {
    role: "general",
    defaultActionKinds: ["shell_command"],
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true,
    canReview: false,
  },
  {
    role: "frontend",
    defaultActionKinds: ["shell_command", "file_write"],
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true,
    canReview: true,
  },
  {
    role: "backend",
    defaultActionKinds: ["shell_command", "git_operation"],
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true,
    canReview: true,
  },
  {
    role: "reviewer",
    defaultActionKinds: ["git_operation"],
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true,
    canReview: true,
  },
  {
    role: "tester",
    defaultActionKinds: ["shell_command"],
    requiresApprovalForShell: true,
    requiresApprovalForFileWrite: true,
    canReview: false,
  },
];

const repoHealth = {
  isExistingDirectory: true,
  isGitRepo: true,
  repoRoot: workspaceRoot,
  currentBranch: "main",
  dirty: false,
  gitUserNameConfigured: true,
  gitUserEmailConfigured: true,
  worktreeSupported: true,
  worktreeSupportMessage: "available",
  worktreeBlockers: [],
  handoffBlockers: [],
  codexCliStatus,
};

const workspaceInfo: WorkspaceInfo = {
  workspaceRoot,
  recentWorkspaces: [workspaceRoot, "/workspace-archive"],
  settings,
  repoHealth,
  switchBlockers: [],
};

const snapshot: AppStateSnapshot = {
  workspaceRoot,
  employees,
  terminalSessions,
  actions,
  approvals,
  processes,
  processLogs: [],
  selectedEmployeeId: "emp-frontend",
  activeTab: "office",
  recentFiles: [`${workspaceRoot}/src/App.tsx`],
  recentWorkspaces: workspaceInfo.recentWorkspaces,
  settings,
  updatedAt: now,
};

const diagnosticsSummary: DiagnosticsSummary = {
  appVersion: "0.1.0",
  os: "browser-smoke",
  arch: "x64",
  workspaceSelected: true,
  workspacePath: workspaceRoot,
  workspaceExists: true,
  workspaceIsGitRepo: true,
  gitUserNameConfigured: true,
  gitUserEmailConfigured: true,
  codexCliAvailable: codexCliStatus.available,
  codexCliVersion: codexCliStatus.version,
  codexCliMessage: codexCliStatus.message,
  counts: {
    employees: employees.length,
    activeTerminalSessions: 1,
    recentTerminalSessions: terminalSessions.length,
    actionsByStatus: {
      pending_approval: 1,
      succeeded: 1,
    },
    approvalsByStatus: {
      pending: 1,
    },
    managedProcessesByStatus: {
      running: 1,
    },
    recentFiles: snapshot.recentFiles.length,
  },
  healthFlags: ["e2e mock data"],
  blockers: [],
};

const commits: WorktreeCommit[] = [
  {
    hash: "abc1234def5678",
    shortHash: "abc1234",
    message: "Seed browser smoke review state",
    timestamp: now - 900_000,
  },
];

const handoff: WorktreeHandoffPreflight = {
  employeeId: "emp-frontend",
  employeeBranch: "slavey/mira-frontend",
  mainBranch: "main",
  ahead: 1,
  behind: 0,
  commitsToApply: commits,
  employeeClean: false,
  mainClean: true,
  mainConflictedFiles: [],
  applyStrategy: "cherry_pick",
  mainOperation: {
    inProgress: false,
    operation: null,
    head: null,
    canAbort: false,
    message: "ready",
  },
  blockers: ["Commit or discard employee changes before handoff."],
  canApply: false,
  message: "Commit employee changes before handoff.",
};

const worktreeStatus: WorktreeStatus = {
  employeeId: "emp-frontend",
  hasWorktree: true,
  worktreePath: frontendCwd,
  branchName: "slavey/mira-frontend",
  isRepo: true,
  dirty: true,
  changes: ["M src/components/EmployeeDashboard.tsx", "?? docs/smoke-note.md"],
};

const worktreeReview: WorktreeReview = {
  employeeId: "emp-frontend",
  worktreePath: frontendCwd,
  branchName: "slavey/mira-frontend",
  baseBranch: "main",
  upstreamBranch: "origin/main",
  remote: {
    remoteName: "origin",
    remoteUrl: "git@example.invalid:slavey/slavey.git",
    upstreamBranch: "origin/main",
    upstreamExists: true,
    ahead: 1,
    behind: 0,
    pushDisabledReason: "read-only in browser smoke mock",
    pullRequestDisabledReason: "not available in browser smoke mock",
  },
  ahead: 1,
  behind: 0,
  upstreamAhead: 1,
  upstreamBehind: 0,
  clean: false,
  status: ["M src/components/EmployeeDashboard.tsx", "M src/styles/employees.css"],
  changedFiles: [
    "src/components/EmployeeDashboard.tsx",
    "src/styles/employees.css",
    "docs/smoke-note.md",
  ],
  files: [
    {
      path: "src/components/EmployeeDashboard.tsx",
      status: "M",
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false,
      deleted: false,
      renamed: false,
    },
    {
      path: "src/styles/employees.css",
      status: "M",
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      deleted: false,
      renamed: false,
    },
    {
      path: "docs/smoke-note.md",
      status: "??",
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false,
      deleted: false,
      renamed: false,
    },
  ],
  stagedFiles: ["src/components/EmployeeDashboard.tsx"],
  unstagedFiles: ["src/styles/employees.css"],
  unstagedDiff: "diff --git a/src/styles/employees.css b/src/styles/employees.css\n",
  stagedDiff: "diff --git a/src/components/EmployeeDashboard.tsx b/src/components/EmployeeDashboard.tsx\n",
  untrackedFiles: ["docs/smoke-note.md"],
  conflictedFiles: [],
  recentCommits: commits,
  handoff,
  operation: {
    inProgress: false,
    operation: null,
    head: null,
    canAbort: false,
    message: "ready",
  },
  blockers: [],
  disabledReasons: {
    commit: null,
    discard: null,
    deleteUntracked: null,
    handoffApply: "Commit employee changes before handoff.",
    push: "read-only in browser smoke mock",
    pullRequest: "not available in browser smoke mock",
  },
};

const gitPathChanges: GitPathChanges = {
  root: frontendCwd,
  repoRoot: frontendCwd,
  isRepo: true,
  clean: false,
  status: worktreeReview.status,
  changedFiles: worktreeReview.changedFiles,
  files: worktreeReview.files,
};

const files: FsEntry[] = [
  {
    name: "src",
    path: `${workspaceRoot}/src`,
    isDir: true,
    size: null,
    modified: now - 600_000,
  },
  {
    name: "App.tsx",
    path: `${workspaceRoot}/src/App.tsx`,
    isDir: false,
    size: 760,
    modified: now - 600_000,
  },
  {
    name: "smoke-fixture.ts",
    path: `${workspaceRoot}/src/smoke-fixture.ts`,
    isDir: false,
    size: 128,
    modified: now - 120_000,
  },
];

const fileContents: Record<string, string> = {
  [`${workspaceRoot}/src/App.tsx`]: "export default function App() {\n  return null;\n}\n",
  [`${workspaceRoot}/src/smoke-fixture.ts`]: "export const smokeFixture = true;\n",
};

export async function invokeE2eTauriCommand<T>(
  command: string,
  args: InvokeArgs = {},
): Promise<T> {
  switch (command) {
    case "app_state_load":
      return clone(snapshot);
    case "app_state_save":
      return undefined as T;
    case "workspace_info":
    case "workspace_set_root":
      return clone(workspaceInfo);
    case "workspace_recent_clear":
      return clone([]);
    case "settings_update":
      return clone({ ...settings, ...(payload<AppSettings>(args) ?? {}) });
    case "employee_role_policies":
      return clone(rolePolicies);
    case "employee_activity_list":
      return clone(employeeActivities);
    case "employee_activity_get":
      return clone(
        employeeActivities.find((activity) => activity.employeeId === stringArg(args, "employeeId")) ??
          employeeActivities[0],
      );
    case "employee_create":
      return clone(createMockEmployee(payload<CreateEmployeeInput>(args)));
    case "employee_set_working_folder":
      return clone(withWorkingFolder(payload<SetEmployeeWorkingFolderInput>(args)));
    case "employee_remove":
      return undefined as T;
    case "employee_set_standby":
      return clone(withStatus(stringArg(args, "employeeId"), "standby"));
    case "employee_resume_from_standby":
      return clone(withStatus(stringArg(args, "employeeId"), "running"));
    case "employee_start_terminal":
      return clone(withTerminal(stringArg(args, "employeeId")));
    case "codex_task_submit":
      return clone(createMockCodexSession(payload<CodexTaskSubmitInput>(args)));
    case "employee_stop_terminal":
      return clone(withoutTerminal(stringArg(args, "employeeId")));
    case "terminal_session_list": {
      const employeeId = nullableStringArg(args, "employeeId");
      return clone(
        employeeId
          ? terminalSessions.filter((session) => session.employeeId === employeeId)
          : terminalSessions,
      );
    }
    case "terminal_session_stop":
      return clone(stopSession(stringArg(args, "sessionId")));
    case "terminal_session_rename":
      return clone(renameSession(stringArg(args, "sessionId"), stringArg(args, "label")));
    case "terminal_session_output":
      return clone(terminalOutput(stringArg(args, "sessionId")));
    case "terminal_image_upload":
    case "terminal_image_upload_path":
      return clone({
        path: "/workspace/.slavey/terminal-images/mock-image.png",
        fileName: "mock-image.png",
        bytes: 128,
        mimeType: "image/png",
      });
    case "terminal_write":
    case "terminal_resize":
      return undefined as T;
    case "codex_cli_status":
      return clone(codexCliStatus);
    case "codex_app_server_status":
      return clone({
        available: true,
        userAgent: "mock codex app-server",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "mock",
        message: "Mock Codex app-server is available",
      });
    case "diagnostics_summary":
      return clone(diagnosticsSummary);
    case "diagnostics_export_bundle":
      return clone(diagnosticsExportBundle());
    case "approval_list":
      return clone(approvals);
    case "approval_create":
      return clone(createMockApproval(payload<CreateApprovalInput>(args)));
    case "approval_approve":
      return clone(resolveApproval(stringArg(args, "approvalId"), "approved"));
    case "approval_reject":
      return clone(resolveApproval(stringArg(args, "approvalId"), "rejected"));
    case "action_list":
      return clone(actions);
    case "action_create":
      return clone(createMockAction(payload<CreateActionInput>(args)));
    case "action_request_approval":
      return clone(updateActionStatus(stringArg(args, "actionId"), "pending_approval"));
    case "action_approve":
      return clone(updateActionStatus(stringArg(args, "actionId"), "approved"));
    case "action_reject":
      return clone(updateActionStatus(stringArg(args, "actionId"), "rejected"));
    case "action_run":
      return clone(updateActionStatus(stringArg(args, "actionId"), "succeeded"));
    case "action_cancel":
      return clone(updateActionStatus(stringArg(args, "actionId"), "cancelled"));
    case "process_list":
      return clone(processes);
    case "process_spawn":
      return clone(createMockProcess(payload<{ employeeId?: string | null; command: string; cwd: string; title?: string | null }>(args)));
    case "process_kill":
      return clone(killProcess(stringArg(args, "processId")));
    case "process_logs":
      return clone(processLogs(stringArg(args, "processId")));
    case "git_changes_for_path":
      return clone({
        ...gitPathChanges,
        root: stringArg(args, "root"),
        repoRoot: stringArg(args, "root"),
      });
    case "git_file_diff_for_path":
      return clone(fileDiff(stringArg(args, "path")));
    case "git_worktree_create_for_employee":
      return clone(withWorktree(stringArg(args, "employeeId")));
    case "git_worktree_remove_for_employee":
      return clone(withoutWorktree(stringArg(args, "employeeId")));
    case "git_worktree_status_for_employee":
      return clone(worktreeStatus);
    case "git_worktree_diff_for_employee":
      return clone(worktreeReview.unstagedDiff);
    case "git_worktree_review_for_employee":
      return clone(worktreeReview);
    case "git_worktree_log_for_employee":
      return clone(commits);
    case "git_worktree_handoff_preflight_for_employee":
      return clone(handoff);
    case "git_worktree_changed_files_for_employee":
      return clone(worktreeReview.changedFiles);
    case "git_worktree_file_diff_for_employee":
      return clone(fileDiff(stringArg(args, "path")));
    case "git_worktree_stage_file":
    case "git_worktree_unstage_file":
    case "git_worktree_discard_file_for_employee":
    case "git_worktree_delete_untracked_file_for_employee":
      return clone(worktreeReview);
    case "git_worktree_commit_for_employee":
      return clone(commits[0]);
    case "git_worktree_apply_handoff_for_employee":
      return clone(handoffApplyResult());
    case "git_worktree_abort_handoff_for_employee":
      return clone({
        employeeId: stringArg(args, "employeeId"),
        aborted: false,
        operation: null,
        stdout: "",
        stderr: "",
        message: "No handoff operation is in progress.",
      });
    case "fs_search":
    case "fs_grep":
    case "fs_glob":
      return clone(searchResults());
    case "fs_create_file":
      return clone(filePayload(stringArg(args, "path"), stringArg(args, "contents")));
    case "fs_create_dir":
    case "fs_rename":
      return clone(files[0]);
    case "fs_delete":
    case "fs_write_file":
      return undefined as T;
    case "fs_list_dir":
      return clone(files);
    case "fs_read_file":
      return clone(filePayload(stringArg(args, "path")));
    case "fs_file_metadata":
      return clone(fileMetadata(stringArg(args, "path")));
    default:
      throw new Error(`Unhandled E2E Tauri mock command: ${command}`);
  }
}

function clone<T>(value: unknown): T {
  return structuredClone(value) as T;
}

function payload<T>(args: InvokeArgs): T | null {
  return (args.payload as T | undefined) ?? null;
}

function stringArg(args: InvokeArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function nullableStringArg(args: InvokeArgs, key: string): string | null {
  const value = args[key];
  return typeof value === "string" ? value : null;
}

function employeeById(employeeId: string): Employee {
  return employees.find((employee) => employee.id === employeeId) ?? employees[0];
}

function withTerminal(employeeId: string): Employee {
  const employee = employeeById(employeeId);
  return { ...employee, terminalSessionId: employee.terminalSessionId ?? "term-frontend" };
}

function createMockCodexSession(input: CodexTaskSubmitInput | null): TerminalSessionRecord {
  const employeeId = input?.employeeId ?? "emp-frontend";
  const sessionId = input?.sessionId ?? `codex-app-${employeeId}`;
  return {
    sessionId,
    employeeId,
    profile: "codex",
    runtime: "codex_app_server",
    activeProfile: "codex",
    cwd: employeeById(employeeId).cwd,
    currentCwd: employeeById(employeeId).cwd,
    status: "running",
    startedAt: now,
    label: "Codex app-server session",
    lastPromptSubmittedAt: now,
    turnState: "prompt_submitted",
    message: input?.prompt ?? "Mock Codex task",
  };
}

function withoutTerminal(employeeId: string): Employee {
  return { ...employeeById(employeeId), terminalSessionId: null, status: "stopped" };
}

function withStatus(employeeId: string, status: Employee["status"]): Employee {
  return { ...employeeById(employeeId), status };
}

function withWorkingFolder(input: SetEmployeeWorkingFolderInput | null): Employee {
  const employee = employeeById(input?.employeeId ?? "");
  return { ...employee, cwd: input?.path ?? employee.cwd };
}

function withWorktree(employeeId: string): Employee {
  const employee = employeeById(employeeId);
  return {
    ...employee,
    cwd: frontendCwd,
    worktreePath: frontendCwd,
    branchName: `slavey/${employee.name.toLowerCase().replaceAll(" ", "-")}`,
  };
}

function withoutWorktree(employeeId: string): Employee {
  const employee = employeeById(employeeId);
  return {
    ...employee,
    cwd: workspaceRoot,
    worktreePath: null,
    branchName: null,
  };
}

function stopSession(sessionId: string): TerminalSessionRecord {
  const session = terminalSessions.find((item) => item.sessionId === sessionId) ?? terminalSessions[0];
  return {
    ...session,
    status: "stopped",
    stoppedAt: now,
    stopReason: "user_stopped",
  };
}

function renameSession(sessionId: string, label: string): TerminalSessionRecord {
  const session = terminalSessions.find((item) => item.sessionId === sessionId) ?? terminalSessions[0];
  return { ...session, label };
}

function terminalOutput(sessionId: string): string {
  if (sessionId.startsWith("codex-app-")) {
    return "› Mock Codex task\r\n[Codex] Working...\r\nMock Codex response.\r\n› ";
  }
  if (sessionId === "term-frontend") {
    return [
      "$ npm run test:web:run",
      "",
      "> slavey@0.1.0 test:web:run",
      "> vitest run",
      "",
      "✓ src/components/__tests__/EmployeeScene.test.tsx",
      "✓ src/components/__tests__/AppShell.test.tsx",
      "",
      "Test Files  7 passed (7)",
      "Tests       24 passed (24)",
      "",
    ].join("\r\n");
  }
  return "";
}

function createMockEmployee(input: CreateEmployeeInput | null): Employee {
  const role: EmployeeRole = input?.role ?? "general";
  return {
    id: "emp-created",
    name: input?.name ?? "Created Employee",
    role,
    status: "idle",
    cwd: input?.cwd ?? workspaceRoot,
    worktreePath: null,
    branchName: null,
    terminalSessionId: null,
    currentCommand: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createMockApproval(input: CreateApprovalInput | null): ApprovalRequest {
  return {
    id: "approval-created",
    employeeId: input?.employeeId ?? "emp-frontend",
    actionId: input?.actionId ?? null,
    kind: input?.kind ?? "shell_command",
    title: input?.title ?? "Created approval",
    description: input?.description ?? "Created in browser smoke mock.",
    command: input?.command ?? null,
    path: input?.path ?? null,
    cwd: input?.cwd ?? workspaceRoot,
    status: "pending",
    createdAt: now,
  };
}

function resolveApproval(
  approvalId: string,
  status: ApprovalRequest["status"],
): ApprovalRequest {
  const approval = approvals.find((item) => item.id === approvalId) ?? approvals[0];
  return { ...approval, status, resolvedAt: now };
}

function createMockAction(input: CreateActionInput | null): Action {
  const kind: ActionKind = input?.kind ?? "shell_command";
  return {
    id: "action-created",
    employeeId: input?.employeeId ?? "emp-frontend",
    kind,
    title: input?.title ?? "Created action",
    description: input?.description ?? "Created in browser smoke mock.",
    cwd: input?.cwd ?? workspaceRoot,
    command: input?.command ?? null,
    path: input?.path ?? null,
    contents: input?.contents ?? null,
    source: "user",
    timeoutSecs: input?.timeoutSecs ?? 120,
    outputCapBytes: 64_000,
    status: "draft",
    output: "",
    createdAt: now,
    updatedAt: now,
  };
}

function updateActionStatus(actionId: string, status: Action["status"]): Action {
  const action = actions.find((item) => item.id === actionId) ?? actions[0];
  return { ...action, status, updatedAt: now };
}

function createMockProcess(
  input: { employeeId?: string | null; command: string; cwd: string; title?: string | null } | null,
): ManagedProcess {
  return {
    id: "proc-created",
    employeeId: input?.employeeId ?? "emp-frontend",
    title: input?.title ?? "Created process",
    command: input?.command ?? "echo smoke",
    cwd: input?.cwd ?? workspaceRoot,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
}

function killProcess(processId: string): ManagedProcess {
  const process = processes.find((item) => item.id === processId) ?? processes[0];
  return { ...process, status: "killed", updatedAt: now };
}

function processLogs(processId: string): ProcessLogs {
  return {
    processId,
    baseOffset: 0,
    nextOffset: 28,
    contents: "Mock process output is ready.\n",
    truncated: false,
  };
}

function fileDiff(path: string): string {
  return `diff --git a/${path} b/${path}\n+browser smoke fixture\n`;
}

function handoffApplyResult(): WorktreeHandoffApplyResult {
  return {
    employeeId: "emp-frontend",
    applied: false,
    strategy: "cherry_pick",
    appliedCommits: [],
    conflict: false,
    error: "Commit employee changes before handoff.",
    stdout: "",
    stderr: "",
  };
}

function searchResults(): FsSearchResult[] {
  return [
    {
      path: `${workspaceRoot}/src/App.tsx`,
      lineNumber: 1,
      line: "export default function App() {",
    },
  ];
}

function filePayload(path: string, contents?: string): FilePayload {
  const resolvedPath = path || `${workspaceRoot}/src/App.tsx`;
  return {
    path: resolvedPath,
    contents: contents ?? fileContents[resolvedPath] ?? "Mock file contents.\n",
  };
}

function fileMetadata(path: string): FileMetadata {
  const resolvedPath = path || `${workspaceRoot}/src/App.tsx`;
  return {
    path: resolvedPath,
    size: fileContents[resolvedPath]?.length ?? 128,
    modified: now - 60_000,
    readonly: false,
    writable: true,
    isFile: true,
    isDir: false,
    isSymlink: false,
    insideWorkspace: true,
  };
}

function diagnosticsExportBundle(): DiagnosticsExportBundle {
  return {
    generatedAt: now,
    summary: diagnosticsSummary,
    settings,
    workspace: {
      workspacePath: workspaceRoot,
      workspaceExists: true,
      isGitRepo: true,
      repoRoot: workspaceRoot,
      currentBranch: "main",
      dirty: false,
      gitUserNameConfigured: true,
      gitUserEmailConfigured: true,
      worktreeSupported: true,
      worktreeBlockers: [],
      handoffBlockers: [],
      switchBlockers: [],
      codexCliStatus,
    },
    employeeActivities: employeeActivities.map(diagnosticsEmployeeActivity),
    actions,
    approvals,
    terminalSessions: terminalSessions.map(diagnosticsTerminalSession),
    processes,
    notes: [
      "Browser smoke mock excludes secrets, terminal output, environment variables, raw logs, and file-write contents.",
    ],
  };
}

function mockActivityContract(status: EmployeeActivity["status"]): EmployeeActivity["contract"] {
  switch (status) {
    case "review_needed":
      return {
        lifecycle: "active",
        work: { kind: "review", phase: "ready", turnOwner: "owner" },
        render: { placement: "owner_office", posture: "standing", activity: "review" },
        attention: { required: true, reason: "review_needed", priority: "normal" },
        source: { runtime: "none", confidence: "none" },
      };
    case "handoff_ready":
    case "done_clean":
      return {
        lifecycle: "active",
        work: { kind: "review", phase: "ready", turnOwner: "owner" },
        render: { placement: "owner_office", posture: "standing", activity: "handoff" },
        attention: {
          required: true,
          reason: status === "done_clean" ? "ready_to_report" : "handoff_ready",
          priority: "normal",
        },
        source: { runtime: "none", confidence: "none" },
      };
    case "codex_running":
      return {
        lifecycle: "active",
        work: { kind: "codex", phase: "working", turnOwner: "agent" },
        render: { placement: "desk", posture: "sitting", activity: "working" },
        attention: { required: false, reason: null, priority: "none" },
        source: { runtime: "codex_app_server", confidence: "structured" },
      };
    case "shell_running":
      return {
        lifecycle: "active",
        work: { kind: "shell", phase: "idle", turnOwner: "none" },
        render: { placement: "done_room", posture: "standing", activity: "terminal" },
        attention: { required: false, reason: null, priority: "none" },
        source: { runtime: "pty", confidence: "fallback" },
      };
    case "stopped":
      return {
        lifecycle: "stopped",
        work: { kind: "none", phase: "idle", turnOwner: "none" },
        render: { placement: "offline", posture: "standing", activity: "idle" },
        attention: { required: false, reason: null, priority: "none" },
        source: { runtime: "none", confidence: "none" },
      };
    default:
      return {
        lifecycle: status === "standby" ? "standby" : "active",
        work: { kind: "none", phase: "idle", turnOwner: "none" },
        render: {
          placement: status === "standby" ? "standby" : "done_room",
          posture: "standing",
          activity: "idle",
        },
        attention: { required: false, reason: null, priority: "none" },
        source: { runtime: "none", confidence: "none" },
      };
  }
}

function diagnosticsEmployeeActivity(
  activity: EmployeeActivity,
): DiagnosticsEmployeeActivityMetadata {
  const lifecycle = activity.lifecycle ?? "active";
  const reviewNeeded = activity.status === "review_needed";
  const attention =
    activity.attention ??
    ({
      required: reviewNeeded,
      reason: reviewNeeded ? "review_needed" : null,
      priority: reviewNeeded ? "normal" : "none",
    } as const);
  const work =
    activity.work ??
    ({
      phase: reviewNeeded ? "ready_to_report" : "idle",
      turnOwner: reviewNeeded ? "owner" : "none",
    } as const);

  return {
    employeeId: activity.employeeId,
    status: activity.status,
    lifecycle,
    behavior: activity.behavior ?? (reviewNeeded ? "waiting_at_owner" : "at_desk_idle"),
    terminalState: activity.terminalState ?? "none",
    activityReason: activity.activityReason ?? activity.status,
    session: activity.session ?? { kind: "none", state: "closed" },
    agent:
      activity.agent ??
      ({
        kind: "none",
        state: "not_active",
        source: "none",
        confidence: "none",
        turnOwner: "none",
      } as const),
    work,
    attention,
    contract: activity.contract,
    activeTerminalSessionId: activity.activeTerminalSessionId ?? null,
    activeActionId: activity.activeActionId ?? null,
    activeProcessIds: activity.activeProcessIds,
    reviewCounts: activity.reviewCounts,
    blockers: activity.blockers,
    lastActivityAt: activity.lastActivityAt ?? null,
  };
}

function diagnosticsTerminalSession(
  session: TerminalSessionRecord,
): DiagnosticsTerminalSessionMetadata {
  return {
    ...session,
    runtime: session.runtime,
    activeProfile: session.activeProfile ?? session.profile,
    currentCwd: session.currentCwd ?? null,
    exitCode: session.exitCode ?? null,
    endedAt: session.endedAt ?? null,
    stoppedAt: session.stoppedAt ?? null,
    stopReason: session.stopReason ?? null,
    lastOutputAt: session.lastOutputAt ?? null,
    lastPromptSubmittedAt: session.lastPromptSubmittedAt ?? null,
    lastPromptReadyAt: session.lastPromptReadyAt ?? null,
    lastApprovalPromptAt: session.lastApprovalPromptAt ?? null,
    turnState: session.turnState,
    message: session.message ?? null,
  };
}
