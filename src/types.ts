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

export type TerminalSessionProfile = "shell" | "codex";

export type TerminalSessionStatus = "running" | "exited" | "failed" | "stopped";

export type TerminalSessionRecord = {
  sessionId: string;
  employeeId: string;
  profile: TerminalSessionProfile;
  cwd: string;
  status: TerminalSessionStatus;
  exitCode?: number | null;
  startedAt: number;
  endedAt?: number | null;
  message?: string | null;
};

export type TerminalSessionUpdatedPayload = {
  session: TerminalSessionRecord;
};

export type EmployeeUpdatedPayload = {
  employee: Employee;
};

export type EmployeeActivityStatus =
  | "idle"
  | "shell_running"
  | "codex_running"
  | "action_pending_approval"
  | "action_running"
  | "process_running"
  | "review_needed"
  | "handoff_ready"
  | "blocked"
  | "stopped";

export type EmployeeReviewCounts = {
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
};

export type EmployeeActivity = {
  employeeId: string;
  status: EmployeeActivityStatus;
  label: string;
  details?: string | null;
  lastActivityAt?: number | null;
  activeTerminalSessionId?: string | null;
  activeActionId?: string | null;
  activeProcessIds: string[];
  reviewCounts: EmployeeReviewCounts;
  blockers: string[];
};

export type EmployeeActivityUpdatedPayload = {
  employeeId?: string | null;
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
  terminalSessions?: TerminalSessionRecord[];
  actions?: Action[];
  approvals?: ApprovalRequest[];
  processes?: ManagedProcess[];
  processLogs?: ProcessLogSnapshot[];
  selectedEmployeeId?: string | null;
  activeTab?: AppTab | null;
  recentFiles: string[];
  recentWorkspaces?: string[];
  settings?: AppSettings;
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

export type FileMetadata = {
  path: string;
  size?: number | null;
  modified?: number | null;
  readonly: boolean;
  writable: boolean;
  isFile: boolean;
  isDir: boolean;
  isSymlink: boolean;
  insideWorkspace: boolean;
};

export type AppTab = "terminal" | "editor" | "settings";

export type AppSettings = {
  defaultTerminalProfile: TerminalSessionProfile;
  requireConfirmationDiscard: boolean;
  requireConfirmationDelete: boolean;
  requireConfirmationHandoffApply: boolean;
  maxTerminalBufferChars: number;
};

export type AppSettingsUpdate = Partial<AppSettings>;

export type WorkspaceInfo = {
  workspaceRoot: string;
  recentWorkspaces: string[];
  settings: AppSettings;
  repoHealth: RepoHealth;
  switchBlockers: string[];
};

export type RepoHealth = {
  isExistingDirectory: boolean;
  isGitRepo: boolean;
  repoRoot?: string | null;
  currentBranch?: string | null;
  dirty: boolean;
  gitUserNameConfigured: boolean;
  gitUserEmailConfigured: boolean;
  worktreeSupported: boolean;
  worktreeSupportMessage: string;
  worktreeBlockers: string[];
  handoffBlockers: string[];
  codexCliStatus: CodexCliStatus;
};

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

export type WorktreeCommit = {
  hash: string;
  shortHash: string;
  message: string;
  timestamp: number;
};

export type WorktreeHandoffPreview = {
  employeeId: string;
  currentBranch?: string | null;
  baseBranch?: string | null;
  upstreamBranch?: string | null;
  ahead?: number | null;
  behind?: number | null;
  head?: WorktreeCommit | null;
  message: string;
};

export type WorktreeHandoffOperationState = {
  inProgress: boolean;
  operation?: string | null;
  head?: string | null;
  canAbort: boolean;
  message?: string | null;
};

export type WorktreeHandoffPreflight = {
  employeeId: string;
  employeeBranch?: string | null;
  mainBranch?: string | null;
  ahead?: number | null;
  behind?: number | null;
  commitsToApply: WorktreeCommit[];
  employeeClean: boolean;
  mainClean: boolean;
  applyStrategy: "cherry_pick" | string;
  mainOperation: WorktreeHandoffOperationState;
  blockers: string[];
  canApply: boolean;
  message: string;
};

export type WorktreeHandoffApplyResult = {
  employeeId: string;
  applied: boolean;
  strategy: string;
  appliedCommits: WorktreeCommit[];
  conflict: boolean;
  error?: string | null;
  stdout: string;
  stderr: string;
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

export type ProcessLogSnapshot = {
  processId: string;
  baseOffset: number;
  nextOffset: number;
  contents: string;
};

export type ProcessUpdatedPayload = {
  process: ManagedProcess;
};

export type CodexCliStatus = {
  available: boolean;
  version?: string | null;
  message: string;
};
