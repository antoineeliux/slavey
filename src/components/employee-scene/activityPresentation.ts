import type {
  Action,
  AgentKind,
  AgentRuntimeState,
  ApprovalRequest,
  Employee,
  EmployeeActivity,
  EmployeeBehaviorState,
  EmployeeAttentionReason,
  EmployeeTerminalActivityState,
  EmployeeTurnOwner,
  EmployeeWorkPhase,
  ManagedProcess,
  TerminalSessionRecord,
  WorktreeHandoffPreflight,
  WorktreeReview,
} from "../../types";
import {
  codexSessionHasActiveTurn,
  codexSessionIsWaitingForApproval,
  codexSessionIsWaitingForInstruction,
  terminalSessionEffectiveProfile,
} from "../../lib/codexPromptState";
import {
  resolveEmployeeActivityContractView,
  type EmployeeActivityContractView,
  type EmployeeVisualState,
} from "../../lib/employeeActivityContractView";

export type { EmployeeVisualState } from "../../lib/employeeActivityContractView";

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
  attentionRequired: boolean;
  attentionReason: EmployeeAttentionReason | null | undefined;
  behavior: EmployeeBehaviorState | null;
  workPhase: EmployeeWorkPhase | null;
  turnOwner: EmployeeTurnOwner | null;
  terminalState: EmployeeTerminalActivityState | null;
  activityReason: string | null;
  agentKind: AgentKind | null;
  agentState: AgentRuntimeState | null;
  contract: EmployeeActivity["contract"] | null;
  contractView: EmployeeActivityContractView | null;
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
  const fallbackHasReviewNeeded =
    (review?.changedFiles.length ?? review?.files.length ?? 0) > 0 ||
    review?.clean === false ||
    (review?.conflictedFiles.length ?? 0) > 0;
  const fallbackHasHandoffReady = handoff?.canApply === true;
  const contractView = activity ? resolveEmployeeActivityContractView(activity) : null;
  const hasReviewNeeded = contractView?.state === "review_needed" || fallbackHasReviewNeeded;
  const hasHandoffReady = contractView?.state === "handoff_ready" || fallbackHasHandoffReady;

  const state =
    contractView?.state ??
    fallbackVisualStateWithoutActivity({
      employee,
      activeSession,
      pendingApprovals: employeeApprovals.length + pendingActions.length,
      runningActions: runningActions.length,
      runningProcesses: runningProcesses.length,
      failedActions: failedActions.length,
      failedProcesses: failedProcesses.length,
      hasReviewNeeded: fallbackHasReviewNeeded,
      hasHandoffReady: fallbackHasHandoffReady,
      blockers: hardBlockers,
    });
  const label = contractView?.label ?? labelForFallbackState(state);
  const detail =
    contractView?.detail ??
    detailForFallbackState({
      employee,
      activeSession,
      pendingApprovals: employeeApprovals.length + pendingActions.length,
      runningActions: runningActions.length,
      runningProcesses: runningProcesses.length,
      changedFiles,
      hasHandoffReady: fallbackHasHandoffReady,
      blockers,
      state,
    });

  const fallbackAttentionReason = fallbackAttentionReasonForState(state);
  const attentionRequired = contractView?.attentionRequired ?? ownerAttentionState(state);
  const attentionReason = contractView?.attentionReason ?? fallbackAttentionReason;

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
    attentionRequired,
    attentionReason,
    behavior: activity?.behavior ?? null,
    workPhase: activity?.work?.phase ?? null,
    turnOwner: activity?.work?.turnOwner ?? null,
    terminalState: activity?.terminalState ?? null,
    activityReason: activity?.activityReason ?? null,
    agentKind: activity?.agent?.kind ?? null,
    agentState: activity?.agent?.state ?? null,
    contract: activity?.contract ?? null,
    contractView,
    blockers,
  };
}

function fallbackVisualStateWithoutActivity({
  employee,
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
  if (employee.status === "standby") {
    return "standby";
  }
  if (employee.status === "stopped") {
    return "stopped";
  }
  if (
    employee.status === "blocked" ||
    employee.status === "failed" ||
    failedActions > 0 ||
    failedProcesses > 0 ||
    blockers.length > 0
  ) {
    return "blocked";
  }
  if (employee.status === "done") {
    return "done_clean";
  }
  if (pendingApprovals > 0) {
    return "waiting_approval";
  }
  if (activeSession && codexSessionIsWaitingForApproval(activeSession)) {
    return "codex_waiting_approval";
  }
  if (runningActions > 0) {
    return "action_running";
  }
  if (
    activeSession &&
    terminalSessionEffectiveProfile(activeSession) === "codex" &&
    codexSessionIsWaitingForInstruction(activeSession)
  ) {
    return "codex_waiting_instruction";
  }
  if (
    activeSession &&
    terminalSessionEffectiveProfile(activeSession) === "codex" &&
    codexSessionHasActiveTurn(activeSession)
  ) {
    return "codex_running";
  }
  if (
    (activeSession &&
      terminalSessionEffectiveProfile(activeSession) === "codex" &&
      !activeSession.lastPromptSubmittedAt)
  ) {
    return "codex_starting";
  }
  if (activeSession?.profile === "shell") {
    return "shell_running";
  }
  if (runningProcesses > 0) {
    return "process_running";
  }
  if (hasHandoffReady) {
    return "handoff_ready";
  }
  if (hasReviewNeeded) {
    return "review_needed";
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

function labelForFallbackState(state: EmployeeVisualState): string {
  if (state === "codex_waiting_instruction") {
    return "Awaiting prompt";
  }
  if (state === "codex_starting") {
    return "Codex starting";
  }
  if (state === "codex_waiting_approval") {
    return "Terminal approval";
  }
  if (state === "standby") {
    return "On standby";
  }
  if (state === "done_clean") {
    return "Done";
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

function detailForFallbackState({
  employee,
  activeSession,
  pendingApprovals,
  runningActions,
  runningProcesses,
  changedFiles,
  hasHandoffReady,
  blockers,
  state,
}: {
  employee: Employee;
  activeSession: TerminalSessionRecord | null;
  pendingApprovals: number;
  runningActions: number;
  runningProcesses: number;
  changedFiles: number;
  hasHandoffReady: boolean;
  blockers: string[];
  state: EmployeeVisualState;
}): string {
  if (state === "codex_waiting_instruction") {
    return "Waiting for your next instruction";
  }
  if (state === "codex_starting") {
    return "Preparing session";
  }
  if (state === "codex_waiting_approval") {
    return "Approve or reject in terminal";
  }
  if (state === "standby") {
    return "Parked in the waiting room";
  }
  if (state === "done_clean") {
    return "Ready to report";
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
  return employee.currentCommand ?? shortPath(employee.cwd);
}

function ownerAttentionState(state: EmployeeVisualState): boolean {
  return (
    state === "codex_waiting_instruction" ||
    state === "codex_waiting_approval" ||
    state === "waiting_approval" ||
    state === "review_needed" ||
    state === "handoff_ready" ||
    state === "done_clean" ||
    state === "blocked"
  );
}

function fallbackAttentionReasonForState(
  state: EmployeeVisualState,
): EmployeeActivityPresentation["attentionReason"] {
  switch (state) {
    case "codex_waiting_instruction":
      return "needs_instruction";
    case "codex_waiting_approval":
      return "needs_terminal_approval";
    case "waiting_approval":
      return "needs_app_approval";
    case "review_needed":
      return "review_needed";
    case "handoff_ready":
      return "handoff_ready";
    case "done_clean":
      return "ready_to_report";
    case "blocked":
      return "blocked_needs_help";
    default:
      return null;
  }
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || path;
}
