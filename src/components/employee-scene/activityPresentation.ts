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
  codexSessionIsWaitingForApproval,
  codexSessionIsWaitingForInstruction,
  terminalSessionEffectiveProfile,
} from "../../lib/codexPromptState";

export type EmployeeVisualState =
  | "idle"
  | "shell_running"
  | "codex_starting"
  | "codex_running"
  | "codex_waiting_instruction"
  | "codex_waiting_approval"
  | "standby"
  | "waiting_approval"
  | "action_running"
  | "process_running"
  | "review_needed"
  | "handoff_ready"
  | "done_clean"
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
  attentionRequired: boolean;
  attentionReason: EmployeeAttentionReason | null | undefined;
  behavior: EmployeeBehaviorState | null;
  workPhase: EmployeeWorkPhase | null;
  turnOwner: EmployeeTurnOwner | null;
  terminalState: EmployeeTerminalActivityState | null;
  activityReason: string | null;
  agentKind: AgentKind | null;
  agentState: AgentRuntimeState | null;
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
  const hasHandoffReady =
    activity?.status === "handoff_ready" ||
    activity?.attention?.reason === "handoff_ready" ||
    handoff?.canApply === true;

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
    state,
  });

  const fallbackAttentionReason = fallbackAttentionReasonForState(state);
  const backendAttentionRequired = activity?.attention?.required ?? false;

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
    attentionRequired: backendAttentionRequired || ownerAttentionState(state),
    attentionReason: backendAttentionRequired
      ? activity?.attention?.reason ?? fallbackAttentionReason
      : fallbackAttentionReason,
    behavior: activity?.behavior ?? null,
    workPhase: activity?.work?.phase ?? null,
    turnOwner: activity?.work?.turnOwner ?? null,
    terminalState: activity?.terminalState ?? null,
    activityReason: activity?.activityReason ?? null,
    agentKind: activity?.agent?.kind ?? null,
    agentState: activity?.agent?.state ?? null,
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
  const structuredState = structuredVisualStateForActivity(employee, activity);
  if (structuredState) {
    return structuredState;
  }

  if (employee.status === "standby" || activity?.status === "standby") {
    return "standby";
  }
  if (employee.status === "stopped" || activity?.status === "stopped") {
    return "stopped";
  }
  if (activity?.attention?.required && activity.attention.reason === "blocked_needs_help") {
    return "blocked";
  }
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
  if (activity?.status === "codex_waiting_approval") {
    return "codex_waiting_approval";
  }
  if (activity?.status === "review_needed") {
    return "review_needed";
  }
  if (activity?.status === "handoff_ready") {
    return "handoff_ready";
  }
  if (employee.status === "done" || activity?.status === "done_clean") {
    return "done_clean";
  }
  if (activity?.attention?.required) {
    switch (activity.attention.reason) {
      case "needs_instruction":
        return "codex_waiting_instruction";
      case "needs_terminal_approval":
        return "codex_waiting_approval";
      case "needs_app_approval":
      case "needs_approval":
        return "waiting_approval";
      case "review_needed":
        return "review_needed";
      case "handoff_ready":
        return "handoff_ready";
      case "ready_to_report":
        return "done_clean";
      default:
        break;
    }
  }
  if (pendingApprovals > 0 || activity?.status === "action_pending_approval") {
    return "waiting_approval";
  }
  if (
    activity?.agent?.state === "waiting_approval" ||
    (activeSession && codexSessionIsWaitingForApproval(activeSession))
  ) {
    return "codex_waiting_approval";
  }
  if (runningActions > 0 || activity?.status === "action_running") {
    return "action_running";
  }
  if (
    activity?.agent?.state === "waiting_prompt" ||
    activity?.status === "codex_waiting_instruction" ||
    activeSession &&
    terminalSessionEffectiveProfile(activeSession) === "codex" &&
    codexSessionIsWaitingForInstruction(activeSession)
  ) {
    return "codex_waiting_instruction";
  }
  if (
    activity?.agent?.state === "starting" ||
    activity?.status === "codex_starting" ||
    (activeSession &&
      terminalSessionEffectiveProfile(activeSession) === "codex" &&
      !activeSession.lastPromptSubmittedAt)
  ) {
    return "codex_starting";
  }
  if (
    (activity?.agent?.state === "thinking" && activity?.agent?.kind === "codex") ||
    activity?.status === "codex_running" ||
    (activeSession &&
      terminalSessionEffectiveProfile(activeSession) === "codex" &&
      Boolean(activeSession.lastPromptSubmittedAt))
  ) {
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
  return "idle";
}

function structuredVisualStateForActivity(
  employee: Employee,
  activity: EmployeeActivity | null | undefined,
): EmployeeVisualState | null {
  if (!activity || !activityHasStructuredContract(activity)) {
    return null;
  }
  if (
    employee.status === "standby" ||
    activity.lifecycle === "standby" ||
    activity.behavior === "on_standby" ||
    activity.status === "standby"
  ) {
    return "standby";
  }
  if (
    employee.status === "stopped" ||
    activity.lifecycle === "stopped" ||
    activity.behavior === "offline" ||
    activity.status === "stopped"
  ) {
    return "stopped";
  }

  const attentionReason = activity.attention?.required ? activity.attention.reason : null;
  switch (attentionReason) {
    case "blocked_needs_help":
      return "blocked";
    case "needs_instruction":
      return "codex_waiting_instruction";
    case "needs_terminal_approval":
      return "codex_waiting_approval";
    case "needs_app_approval":
      return "waiting_approval";
    case "needs_approval":
      return activity.terminalState === "codex_waiting_approval" ||
        activity.status === "codex_waiting_approval"
        ? "codex_waiting_approval"
        : "waiting_approval";
    case "review_needed":
      return "review_needed";
    case "handoff_ready":
      return "handoff_ready";
    case "ready_to_report":
      return "done_clean";
    default:
      break;
  }

  switch (activity.status) {
    case "action_pending_approval":
      return "waiting_approval";
    case "action_running":
      return "action_running";
    case "process_running":
      return "process_running";
    case "review_needed":
      return "review_needed";
    case "handoff_ready":
      return "handoff_ready";
    case "done_clean":
      return "done_clean";
    case "blocked":
      return "blocked";
    default:
      break;
  }

  switch (activity.terminalState) {
    case "codex_waiting_approval":
      return "codex_waiting_approval";
    case "codex_waiting_instruction":
      return "codex_waiting_instruction";
    case "codex_starting":
      return "codex_starting";
    case "codex_running":
      return "codex_running";
    case "shell_running":
      return "shell_running";
    case "failed":
      return "blocked";
    case "completed":
      return "done_clean";
    case "none":
    default:
      break;
  }

  return visualStateFromLegacyStatus(activity.status);
}

function activityHasStructuredContract(activity: EmployeeActivity): boolean {
  return Boolean(
    activity.behavior ||
      activity.terminalState ||
      activity.lifecycle ||
      activity.work ||
      activity.attention,
  );
}

function visualStateFromLegacyStatus(status: EmployeeActivity["status"]): EmployeeVisualState {
  switch (status) {
    case "action_pending_approval":
      return "waiting_approval";
    default:
      return status;
  }
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
  state,
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
