export type EmployeeStatus =
  | "idle"
  | "starting"
  | "running"
  | "standby"
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

export type TerminalSessionRuntime = "pty" | "codex_app_server";

export type TerminalSessionStatus = "running" | "exited" | "failed" | "stopped";

export type TerminalStopReason =
  | "user_stopped"
  | "exited"
  | "failed_to_start"
  | "app_restarted";

export type TerminalTurnState =
  | "unknown"
  | "shell"
  | "codex_starting"
  | "owner_prompt_ready"
  | "owner_composing"
  | "prompt_submitted"
  | "agent_working"
  | "waiting_approval"
  | "completed"
  | "failed";

export type TerminalTurnTransitionReason =
  | "shell_output"
  | "codex_approval_prompt"
  | "codex_active_work"
  | "codex_prompt_ready"
  | "codex_prompt_ready_at_end_stale_work_redraw"
  | "owner_prompt_echo_ignored"
  | "owner_input_submitted"
  | "owner_composing"
  | "no_activity_relevant_change"
  | "active_profile_reset_to_shell"
  | "active_profile_changed_to_codex"
  | "session_finished_completed"
  | "session_finished_failed"
  | "app_server_starting"
  | "app_server_thinking"
  | "app_server_waiting_prompt"
  | "app_server_waiting_approval"
  | "app_server_completed"
  | "app_server_failed";

export type TerminalSessionRecord = {
  sessionId: string;
  employeeId: string;
  profile: TerminalSessionProfile;
  runtime: TerminalSessionRuntime;
  activeProfile?: TerminalSessionProfile | null;
  cwd: string;
  currentCwd?: string | null;
  status: TerminalSessionStatus;
  exitCode?: number | null;
  startedAt: number;
  endedAt?: number | null;
  stoppedAt?: number | null;
  stopReason?: TerminalStopReason | null;
  label: string;
  lastOutputAt?: number | null;
  lastPromptSubmittedAt?: number | null;
  lastPromptReadyAt?: number | null;
  lastApprovalPromptAt?: number | null;
  turnState: TerminalTurnState;
  lastTransitionReason?: TerminalTurnTransitionReason | null;
  message?: string | null;
};

export type TerminalImageUploadInput = {
  fileName: string;
  mimeType?: string | null;
  dataBase64: string;
};

export type TerminalImageUploadPathInput = {
  path: string;
};

export type TerminalImageUploadResult = {
  path: string;
  fileName: string;
  bytes: number;
  mimeType: string;
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
  | "codex_starting"
  | "codex_running"
  | "codex_waiting_instruction"
  | "codex_waiting_approval"
  | "standby"
  | "action_pending_approval"
  | "action_running"
  | "process_running"
  | "review_needed"
  | "handoff_ready"
  | "done_clean"
  | "blocked"
  | "stopped";

export type EmployeeLifecycleState = "active" | "standby" | "stopped" | "failed";

export type EmployeeBehaviorState =
  | "at_desk_idle"
  | "at_desk_terminal"
  | "at_desk_working"
  | "coming_to_owner"
  | "waiting_at_owner"
  | "on_standby"
  | "offline";

export type EmployeeSessionKind = "none" | "shell" | "codex" | "claude";

export type EmployeeRuntimeSessionState = "closed" | "starting" | "open" | "exited";

export type EmployeeRuntimeSession = {
  kind: EmployeeSessionKind;
  state: EmployeeRuntimeSessionState;
};

export type AgentKind = "none" | "codex" | "claude";

export type AgentRuntimeState =
  | "not_active"
  | "starting"
  | "thinking"
  | "waiting_prompt"
  | "waiting_approval"
  | "completed"
  | "failed";

export type AgentRuntimeSnapshot = {
  kind: AgentKind;
  state: AgentRuntimeState;
  lastStateChangedAt?: number | null;
  source?: "none" | "terminal_fallback" | "codex_app_server";
  confidence?: "none" | "terminal_fallback" | "structured";
  turnOwner?: EmployeeTurnOwner;
};

export type EmployeeWorkPhase =
  | "idle"
  | "shell_open"
  | "agent_starting"
  | "agent_working"
  | "tool_running"
  | "waiting_for_owner"
  | "ready_to_report"
  | "blocked";

export type EmployeeTurnOwner = "none" | "owner" | "agent" | "tool";

export type EmployeeAttentionReason =
  | "needs_instruction"
  | "needs_approval"
  | "needs_app_approval"
  | "needs_terminal_approval"
  | "ready_to_report"
  | "review_needed"
  | "handoff_ready"
  | "blocked_needs_help";

export type EmployeeAttentionPriority = "none" | "normal" | "urgent";

export type EmployeeWorkState = {
  phase: EmployeeWorkPhase;
  turnOwner: EmployeeTurnOwner;
};

export type EmployeeTerminalActivityState =
  | "none"
  | "shell_running"
  | "codex_starting"
  | "codex_running"
  | "codex_waiting_instruction"
  | "codex_waiting_approval"
  | "completed"
  | "failed";

export type EmployeeAttention = {
  required: boolean;
  reason?: EmployeeAttentionReason | null;
  priority: EmployeeAttentionPriority;
};

export type EmployeeReviewCounts = {
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
};

export type EmployeeActivityContractWorkKind =
  | "none"
  | "shell"
  | "codex"
  | "action"
  | "process"
  | "review";

export type EmployeeActivityContractWorkPhase =
  | "idle"
  | "starting"
  | "working"
  | "waiting_owner"
  | "waiting_approval"
  | "ready"
  | "blocked";

export type EmployeeActivityContractWork = {
  kind: EmployeeActivityContractWorkKind;
  phase: EmployeeActivityContractWorkPhase;
  turnOwner: EmployeeTurnOwner;
};

export type EmployeeActivityContractRenderPlacement =
  | "desk"
  | "owner_office"
  | "standby"
  | "done_room"
  | "offline";

export type EmployeeActivityContractRenderPosture = "sitting" | "standing";

export type EmployeeActivityContractRenderActivity =
  | "idle"
  | "working"
  | "terminal"
  | "waiting_instruction"
  | "approval"
  | "review"
  | "handoff"
  | "blocked";

export type EmployeeActivityContractRender = {
  placement: EmployeeActivityContractRenderPlacement;
  posture: EmployeeActivityContractRenderPosture;
  activity: EmployeeActivityContractRenderActivity;
};

export type EmployeeActivityContractSourceRuntime = "none" | "pty" | "codex_app_server";

export type EmployeeActivityContractSourceConfidence = "none" | "fallback" | "structured";

export type EmployeeActivityContractSource = {
  runtime: EmployeeActivityContractSourceRuntime;
  confidence: EmployeeActivityContractSourceConfidence;
};

export type EmployeeActivityContract = {
  lifecycle: EmployeeLifecycleState;
  work: EmployeeActivityContractWork;
  render: EmployeeActivityContractRender;
  attention: EmployeeAttention;
  source: EmployeeActivityContractSource;
};

export type EmployeeActivity = {
  employeeId: string;
  status: EmployeeActivityStatus;
  lifecycle?: EmployeeLifecycleState;
  behavior?: EmployeeBehaviorState;
  session?: EmployeeRuntimeSession;
  agent?: AgentRuntimeSnapshot;
  work?: EmployeeWorkState;
  attention?: EmployeeAttention;
  contract: EmployeeActivityContract;
  terminalState?: EmployeeTerminalActivityState;
  activityReason?: string | null;
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

export type AppTab = "office" | "terminal" | "editor" | "settings";

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

export type DiagnosticsCounts = {
  employees: number;
  activeTerminalSessions: number;
  recentTerminalSessions: number;
  actionsByStatus: Record<string, number>;
  approvalsByStatus: Record<string, number>;
  managedProcessesByStatus: Record<string, number>;
  recentFiles: number;
};

export type DiagnosticsSummary = {
  appVersion: string;
  os: string;
  arch: string;
  workspaceSelected: boolean;
  workspacePath?: string | null;
  workspaceExists: boolean;
  workspaceIsGitRepo: boolean;
  gitUserNameConfigured: boolean;
  gitUserEmailConfigured: boolean;
  codexCliAvailable: boolean;
  codexCliVersion?: string | null;
  codexCliMessage: string;
  counts: DiagnosticsCounts;
  healthFlags: string[];
  blockers: string[];
};

export type DiagnosticsWorkspaceInfo = {
  workspacePath?: string | null;
  workspaceExists: boolean;
  isGitRepo: boolean;
  repoRoot?: string | null;
  currentBranch?: string | null;
  dirty: boolean;
  gitUserNameConfigured: boolean;
  gitUserEmailConfigured: boolean;
  worktreeSupported: boolean;
  worktreeBlockers: string[];
  handoffBlockers: string[];
  switchBlockers: string[];
  codexCliStatus: CodexCliStatus;
};

export type DiagnosticsActionMetadata = {
  id: string;
  employeeId: string;
  kind: ActionKind;
  title: string;
  description: string;
  cwd?: string | null;
  path?: string | null;
  source: ActionSource;
  timeoutSecs: number;
  outputCapBytes: number;
  approvalId?: string | null;
  status: ActionStatus;
  error?: string | null;
  failureReason?: ActionFailureReason | null;
  cancellationReason?: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type DiagnosticsApprovalMetadata = {
  id: string;
  employeeId: string;
  actionId?: string | null;
  kind: ApprovalKind;
  title: string;
  description: string;
  path?: string | null;
  cwd?: string | null;
  status: ApprovalStatus;
  createdAt: number;
  resolvedAt?: number | null;
};

export type DiagnosticsEmployeeActivityMetadata = {
  employeeId: string;
  status: EmployeeActivityStatus;
  lifecycle: EmployeeLifecycleState;
  behavior: EmployeeBehaviorState;
  terminalState: EmployeeTerminalActivityState;
  activityReason: string;
  session: EmployeeRuntimeSession;
  agent: AgentRuntimeSnapshot;
  work: EmployeeWorkState;
  attention: EmployeeAttention;
  contract: EmployeeActivityContract;
  activeTerminalSessionId?: string | null;
  activeActionId?: string | null;
  activeProcessIds: string[];
  reviewCounts: EmployeeReviewCounts;
  blockers: string[];
  lastActivityAt?: number | null;
  trace: DiagnosticsEmployeeActivityTrace;
};

export type DiagnosticsEmployeeActivityTrace = {
  employeeId: string;
  legacy: DiagnosticsLegacyActivityTrace;
  activeTerminalSessionId?: string | null;
  terminal?: DiagnosticsTerminalEvidenceTrace | null;
  agentRuntime: AgentRuntimeSnapshot;
  contract: EmployeeActivityContract;
  activeActionId?: string | null;
  activeProcessIds: string[];
  activeProcessCount: number;
  reviewCounts: EmployeeReviewCounts;
  blockers: string[];
  lastActivityAt?: number | null;
};

export type DiagnosticsLegacyActivityTrace = {
  status: EmployeeActivityStatus;
  lifecycle: EmployeeLifecycleState;
  behavior: EmployeeBehaviorState;
  terminalState: EmployeeTerminalActivityState;
  reason: string;
};

export type DiagnosticsTerminalEvidenceTrace = {
  sessionId: string;
  employeeId: string;
  status: TerminalSessionStatus;
  runtime: TerminalSessionRuntime;
  profile: TerminalSessionProfile;
  activeProfile?: TerminalSessionProfile | null;
  turnState: TerminalTurnState;
  lastPromptSubmittedAt?: number | null;
  lastPromptReadyAt?: number | null;
  lastApprovalPromptAt?: number | null;
  lastTransitionReason?: TerminalTurnTransitionReason | null;
};

export type DiagnosticsTerminalSessionMetadata = {
  sessionId: string;
  employeeId: string;
  profile: TerminalSessionProfile;
  runtime: TerminalSessionRuntime;
  activeProfile?: TerminalSessionProfile | null;
  cwd: string;
  currentCwd?: string | null;
  status: TerminalSessionStatus;
  exitCode?: number | null;
  startedAt: number;
  endedAt?: number | null;
  stoppedAt?: number | null;
  stopReason?: TerminalStopReason | null;
  label: string;
  lastOutputAt?: number | null;
  lastPromptSubmittedAt?: number | null;
  lastPromptReadyAt?: number | null;
  lastApprovalPromptAt?: number | null;
  turnState: TerminalTurnState;
  lastTransitionReason?: TerminalTurnTransitionReason | null;
  message?: string | null;
};

export type DiagnosticsProcessMetadata = {
  id: string;
  employeeId?: string | null;
  title: string;
  cwd: string;
  status: ManagedProcessStatus;
  exitCode?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type DiagnosticsExportBundle = {
  generatedAt: number;
  summary: DiagnosticsSummary;
  settings: AppSettings;
  workspace: DiagnosticsWorkspaceInfo;
  employeeActivities: DiagnosticsEmployeeActivityMetadata[];
  actions: DiagnosticsActionMetadata[];
  approvals: DiagnosticsApprovalMetadata[];
  terminalSessions: DiagnosticsTerminalSessionMetadata[];
  processes: DiagnosticsProcessMetadata[];
  notes: string[];
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

export type GitPathChanges = {
  root: string;
  repoRoot?: string | null;
  isRepo: boolean;
  clean: boolean;
  status: string[];
  changedFiles: string[];
  files: WorktreeReviewFile[];
};

export type WorktreeReview = {
  employeeId: string;
  worktreePath: string;
  branchName?: string | null;
  baseBranch?: string | null;
  upstreamBranch?: string | null;
  remote: WorktreeRemoteInfo;
  ahead?: number | null;
  behind?: number | null;
  upstreamAhead?: number | null;
  upstreamBehind?: number | null;
  clean: boolean;
  status: string[];
  changedFiles: string[];
  files: WorktreeReviewFile[];
  stagedFiles: string[];
  unstagedFiles: string[];
  unstagedDiff: string;
  stagedDiff: string;
  untrackedFiles: string[];
  conflictedFiles: string[];
  recentCommits: WorktreeCommit[];
  handoff?: WorktreeHandoffPreflight | null;
  operation: WorktreeHandoffOperationState;
  blockers: string[];
  disabledReasons: WorktreeReviewDisabledReasons;
};

export type WorktreeReviewFile = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  deleted: boolean;
  renamed: boolean;
};

export type WorktreeRemoteInfo = {
  remoteName?: string | null;
  remoteUrl?: string | null;
  upstreamBranch?: string | null;
  upstreamExists: boolean;
  ahead?: number | null;
  behind?: number | null;
  pushDisabledReason?: string | null;
  pullRequestDisabledReason?: string | null;
};

export type WorktreeReviewDisabledReasons = {
  commit?: string | null;
  discard?: string | null;
  deleteUntracked?: string | null;
  handoffApply?: string | null;
  push?: string | null;
  pullRequest?: string | null;
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
  mainConflictedFiles: string[];
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

export type ActionSource = "user" | "employee" | "system";

export type ActionFailureReason =
  | "command_failed"
  | "timed_out"
  | "output_limit_exceeded"
  | "failed_to_start"
  | "validation_failed"
  | "unsupported"
  | "app_restarted"
  | "cancelled";

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
  source: ActionSource;
  timeoutSecs: number;
  outputCapBytes: number;
  approvalId?: string | null;
  status: ActionStatus;
  output: string;
  error?: string | null;
  failureReason?: ActionFailureReason | null;
  cancellationReason?: string | null;
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

export type CodexAppServerStatus = {
  available: boolean;
  userAgent?: string | null;
  codexHome?: string | null;
  platformFamily?: string | null;
  platformOs?: string | null;
  message: string;
};

export type CodexTaskSubmitInput = {
  employeeId: string;
  sessionId?: string | null;
  prompt: string;
};
