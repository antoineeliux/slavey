export type EmployeeStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "done"
  | "failed"
  | "stopped";

export type EmployeeRole =
  | "frontend"
  | "backend"
  | "reviewer"
  | "tester"
  | "general";

export type Employee = {
  id: string;
  name: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  cwd: string;
  worktreePath?: string | null;
  branchName?: string | null;
  terminalSessionId?: string | null;
  currentCommand?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TerminalDataPayload = {
  employeeId: string;
  sessionId: string;
  data: string;
};

export type EmployeeUpdatedPayload = {
  employee: Employee;
};

export type LogLevel = "info" | "warn" | "error";

export type AppLog = {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
};

export type AppStateSnapshot = {
  workspaceRoot: string;
  employees: Employee[];
  actions?: Action[];
  approvals?: ApprovalRequest[];
  selectedEmployeeId?: string | null;
  activeTab?: AppTab | null;
  recentFiles: string[];
  updatedAt: number;
};

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number | null;
  modified?: number | null;
};

export type FsSearchResult = {
  path: string;
  lineNumber?: number | null;
  line?: string | null;
};

export type FilePayload = {
  path: string;
  contents: string;
};

export type AppTab = "terminal" | "editor";

export type WorktreeStatus = {
  employeeId: string;
  hasWorktree: boolean;
  worktreePath?: string | null;
  branchName?: string | null;
  isRepo: boolean;
  dirty: boolean;
  changes: string[];
};

export type WorktreeReview = {
  employeeId: string;
  worktreePath: string;
  branchName?: string | null;
  status: string[];
  unstagedDiff: string;
  stagedDiff: string;
  untrackedFiles: string[];
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalKind = "shell_command" | "file_write" | "git_operation";

export type ApprovalRequest = {
  id: string;
  employeeId: string;
  actionId?: string | null;
  kind: ApprovalKind;
  title: string;
  description: string;
  command?: string | null;
  path?: string | null;
  cwd?: string | null;
  status: ApprovalStatus;
  createdAt: number;
  resolvedAt?: number | null;
};

export type ApprovalUpdatedPayload = {
  approval: ApprovalRequest;
};

export type ActionKind = "shell_command" | "file_write" | "git_operation";

export type RolePolicy = {
  role: EmployeeRole;
  defaultActionKinds: ActionKind[];
  requiresApprovalForShell: boolean;
  requiresApprovalForFileWrite: boolean;
  canReview: boolean;
};

export type ActionStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled";

export type Action = {
  id: string;
  employeeId: string;
  kind: ActionKind;
  title: string;
  description: string;
  cwd?: string | null;
  command?: string | null;
  path?: string | null;
  contents?: string | null;
  timeoutSecs: number;
  approvalId?: string | null;
  status: ActionStatus;
  output: string;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type ActionUpdatedPayload = {
  action: Action;
};

export type ManagedProcessStatus = "running" | "exited" | "failed" | "killed";

export type ManagedProcess = {
  id: string;
  employeeId?: string | null;
  title: string;
  command: string;
  cwd: string;
  status: ManagedProcessStatus;
  exitCode?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ProcessLogs = {
  processId: string;
  baseOffset: number;
  nextOffset: number;
  contents: string;
  truncated: boolean;
};

export type ProcessUpdatedPayload = {
  process: ManagedProcess;
};
