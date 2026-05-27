import type {
  Action,
  ApprovalRequest,
  Employee,
  EmployeeActivity,
  ManagedProcess,
  TerminalSessionRecord,
  WorktreeHandoffPreflight,
  WorktreeReview,
} from "../../types";

export type EmployeeVisualState =
  | "idle"
  | "shell_running"
  | "codex_running"
  | "waiting_approval"
  | "action_running"
  | "process_running"
  | "review_needed"
  | "handoff_ready"
  | "blocked"
  | "stopped";

export type EmployeeActivityPresentation = {
  state: EmployeeVisualState;
  label: string;
  detail: string;
  stationTitle: string;
  pendingApprovals: number;
  runningActions: number;
  runningProcesses: number;
  changedFiles: number;
  hasHandoffReady: boolean;
  hasReviewNeeded: boolean;
  blockers: string[];
};

export type EmployeePresentationInput = {
  employee: Employee;
  activity?: EmployeeActivity | null;
  terminalSessions: TerminalSessionRecord[];
  approvals: ApprovalRequest[];
  actions: Action[];
  processes: ManagedProcess[];
  review?: WorktreeReview | null;
  handoff?: WorktreeHandoffPreflight | null;
};

export function presentEmployeeActivity({
  employee,
  activity,
  terminalSessions,
  approvals,
  actions,
  processes,
  review,
  handoff,
}: EmployeePresentationInput): EmployeeActivityPresentation {
  const employeeApprovals = approvals.filter(
    (approval) => approval.employeeId === employee.id && approval.status === "pending",
  );
  const employeeActions = actions.filter((action) => action.employeeId === employee.id);
  const runningActions = employeeActions.filter((action) => action.status === "running");
  const pendingActions = employeeActions.filter((action) => action.status === "pending_approval");
  const failedActions = employeeActions.filter((action) => action.status === "failed");
  const employeeProcesses = processes.filter(
    (process) => process.employeeId === employee.id || (!process.employeeId && process.cwd === employee.cwd),
  );
  const runningProcesses = employeeProcesses.filter((process) => process.status === "running");
  const failedProcesses = employeeProcesses.filter((process) => process.status === "failed");
  const activeSession = activeTerminalSession(employee, activity, terminalSessions);
  const changedFiles =
    activity?.reviewCounts.changedFiles ??
    review?.changedFiles.length ??
    review?.files.length ??
    0;
  const blockers = [
    ...(activity?.blockers ?? []),
    ...(review?.blockers ?? []),
    ...(handoff?.blockers ?? []),
  ];
  const hardBlockers = [
    ...(activity?.blockers ?? []),
    ...(review?.blockers ?? []),
    ...((review?.conflictedFiles.length ?? 0) > 0 ? ["Worktree has conflicted files"] : []),
  ];
  const hasReviewNeeded =
    activity?.status === "review_needed" ||
    changedFiles > 0 ||
    review?.clean === false ||
    (review?.conflictedFiles.length ?? 0) > 0;
  const hasHandoffReady = activity?.status === "handoff_ready" || handoff?.canApply === true;

  const state = visualStateFor({
    employee,
    activity,
    activeSession,
    pendingApprovals: employeeApprovals.length + pendingActions.length,
    runningActions: runningActions.length,
    runningProcesses: runningProcesses.length,
    failedActions: failedActions.length,
    failedProcesses: failedProcesses.length,
    hasReviewNeeded,
    hasHandoffReady,
    blockers: hardBlockers,
  });
  const label = labelFor(state, activity);
  const detail = detailFor({
    employee,
    activity,
    activeSession,
    pendingApprovals: employeeApprovals.length + pendingActions.length,
    runningActions: runningActions.length,
    runningProcesses: runningProcesses.length,
    changedFiles,
    hasHandoffReady,
    blockers,
  });

  return {
    state,
    label,
    detail,
    stationTitle: `${employee.name}: ${label}. ${detail}`,
    pendingApprovals: employeeApprovals.length + pendingActions.length,
    runningActions: runningActions.length,
    runningProcesses: runningProcesses.length,
    changedFiles,
    hasHandoffReady,
    hasReviewNeeded,
    blockers,
  };
}

function visualStateFor({
  employee,
  activity,
  activeSession,
  pendingApprovals,
  runningActions,
  runningProcesses,
  failedActions,
  failedProcesses,
  hasReviewNeeded,
  hasHandoffReady,
  blockers,
}: {
  employee: Employee;
  activity?: EmployeeActivity | null;
  activeSession: TerminalSessionRecord | null;
  pendingApprovals: number;
  runningActions: number;
  runningProcesses: number;
  failedActions: number;
  failedProcesses: number;
  hasReviewNeeded: boolean;
  hasHandoffReady: boolean;
  blockers: string[];
}): EmployeeVisualState {
  if (
    employee.status === "blocked" ||
    employee.status === "failed" ||
    activity?.status === "blocked" ||
    failedActions > 0 ||
    failedProcesses > 0 ||
    blockers.length > 0
  ) {
    return "blocked";
  }
  if (pendingApprovals > 0 || activity?.status === "action_pending_approval") {
    return "waiting_approval";
  }
  if (runningActions > 0 || activity?.status === "action_running") {
    return "action_running";
  }
  if (activity?.status === "codex_running" || activeSession?.profile === "codex") {
    return "codex_running";
  }
  if (activity?.status === "shell_running" || activeSession?.profile === "shell") {
    return "shell_running";
  }
  if (runningProcesses > 0 || activity?.status === "process_running") {
    return "process_running";
  }
  if (hasHandoffReady) {
    return "handoff_ready";
  }
  if (hasReviewNeeded) {
    return "review_needed";
  }
  if (employee.status === "stopped" || activity?.status === "stopped") {
    return "stopped";
  }
  return "idle";
}

function activeTerminalSession(
  employee: Employee,
  activity: EmployeeActivity | null | undefined,
  terminalSessions: TerminalSessionRecord[],
): TerminalSessionRecord | null {
  const sessionId = activity?.activeTerminalSessionId ?? employee.terminalSessionId;
  if (!sessionId) {
    return null;
  }
  return (
    terminalSessions.find(
      (session) => session.sessionId === sessionId && session.status === "running",
    ) ?? null
  );
}

function labelFor(
  state: EmployeeVisualState,
  activity: EmployeeActivity | null | undefined,
): string {
  if (activity?.label && activity.status !== "idle") {
    return activity.label;
  }
  switch (state) {
    case "shell_running":
      return "Shell running";
    case "codex_running":
      return "Codex running";
    case "waiting_approval":
      return "Waiting approval";
    case "action_running":
      return "Action running";
    case "process_running":
      return "Process running";
    case "review_needed":
      return "Review needed";
    case "handoff_ready":
      return "Handoff ready";
    case "blocked":
      return "Blocked";
    case "stopped":
      return "Stopped";
    case "idle":
    default:
      return "Idle";
  }
}

function detailFor({
  employee,
  activity,
  activeSession,
  pendingApprovals,
  runningActions,
  runningProcesses,
  changedFiles,
  hasHandoffReady,
  blockers,
}: {
  employee: Employee;
  activity?: EmployeeActivity | null;
  activeSession: TerminalSessionRecord | null;
  pendingApprovals: number;
  runningActions: number;
  runningProcesses: number;
  changedFiles: number;
  hasHandoffReady: boolean;
  blockers: string[];
}): string {
  if (activity?.details && activity.status !== "blocked") {
    return activity.details;
  }
  if (blockers.length > 0) {
    return blockers[0];
  }
  if (pendingApprovals > 0) {
    return `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} pending`;
  }
  if (runningActions > 0) {
    return `${runningActions} action${runningActions === 1 ? "" : "s"} running`;
  }
  if (activeSession) {
    return `${activeSession.label} in ${shortPath(activeSession.cwd)}`;
  }
  if (runningProcesses > 0) {
    return `${runningProcesses} process${runningProcesses === 1 ? "" : "es"} running`;
  }
  if (hasHandoffReady) {
    return "Ready to hand off";
  }
  if (changedFiles > 0) {
    return `${changedFiles} changed file${changedFiles === 1 ? "" : "s"}`;
  }
  return activity?.details ?? employee.currentCommand ?? shortPath(employee.cwd);
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || path;
}
