import type { Employee } from "../../types";
import type {
  EmployeeActivityPresentation,
  EmployeeVisualState,
} from "../employee-scene/activityPresentation";
import {
  OFFICE_ROOM_OCCUPANT_SLOTS,
  OFFICE_VISUAL_CAPACITY,
  type OfficeRoomSlot,
} from "./scene/layout";

export type EmployeeFloorVisualState =
  | "social_idle"
  | "offline_stopped"
  | "desk_terminal"
  | "desk_working"
  | "desk_waiting_instruction"
  | "desk_waiting_approval"
  | "desk_review"
  | "social_handoff_ready"
  | "desk_blocked";

export type EmployeeFloorZone =
  | "desk"
  | "open_floor"
  | "executive_office"
  | "done_room"
  | "standby"
  | "offline";

export type EmployeeOfficeState =
  | "idle_available"
  | "on_standby"
  | "working_at_desk"
  | "running_terminal"
  | "waiting_instruction"
  | "terminal_waiting_approval"
  | "waiting_approval"
  | "reviewing_changes"
  | "blocked"
  | "handoff_ready"
  | "standby_available"
  | "offline";

export type EmployeeFloorViewModel = {
  id: string;
  kind: "employee" | "standby";
  name: string;
  role: Employee["role"];
  employeeStatus: Employee["status"];
  selected: boolean;
  deskIndex: number;
  standbySlotId: string | null;
  standbyRoom: OfficeRoomSlot["room"] | null;
  sourceState: EmployeeVisualState;
  officeState: EmployeeOfficeState;
  visualState: EmployeeFloorVisualState;
  zone: EmployeeFloorZone;
  label: string;
  detail: string;
  stationTitle: string;
  cwd: string;
  worktreePath: string | null;
  branchName: string | null;
  currentCommand: string | null;
  terminalSessionId: string | null;
  markerColor: string;
  muted: boolean;
  worksAtDesk: boolean;
  pendingApprovals: number;
  runningActions: number;
  runningProcesses: number;
  changedFiles: number;
  hasHandoffReady: boolean;
  hasReviewNeeded: boolean;
  attentionReason: EmployeeActivityPresentation["attentionReason"];
  behavior: EmployeeActivityPresentation["behavior"];
  workPhase: EmployeeActivityPresentation["workPhase"];
  turnOwner: EmployeeActivityPresentation["turnOwner"];
  terminalState: EmployeeActivityPresentation["terminalState"];
  activityReason: EmployeeActivityPresentation["activityReason"];
  blockers: string[];
};

export type EmployeeFloorViewModelInput = {
  employee: Employee;
  presentation: EmployeeActivityPresentation;
  selected: boolean;
  deskIndex: number;
};

type FloorStateConfig = {
  officeState: EmployeeOfficeState;
  visualState: EmployeeFloorVisualState;
  zone: EmployeeFloorZone;
  markerColor: string;
  muted?: boolean;
  worksAtDesk?: boolean;
};

const floorStateByPresentationState: Record<EmployeeVisualState, FloorStateConfig> = {
  idle: {
    officeState: "idle_available",
    visualState: "social_idle",
    zone: "done_room",
    markerColor: "#8fb9a8",
  },
  standby: {
    officeState: "on_standby",
    visualState: "social_idle",
    zone: "standby",
    markerColor: "#8ec5d8",
    muted: false,
  },
  shell_running: {
    officeState: "running_terminal",
    visualState: "desk_terminal",
    zone: "desk",
    markerColor: "#c8a96a",
    worksAtDesk: true,
  },
  codex_starting: {
    officeState: "running_terminal",
    visualState: "desk_terminal",
    zone: "desk",
    markerColor: "#c8a96a",
  },
  codex_running: {
    officeState: "working_at_desk",
    visualState: "desk_working",
    zone: "desk",
    markerColor: "#a7c080",
    worksAtDesk: true,
  },
  codex_waiting_instruction: {
    officeState: "waiting_instruction",
    visualState: "desk_waiting_instruction",
    zone: "executive_office",
    markerColor: "#8ec5d8",
  },
  codex_waiting_approval: {
    officeState: "terminal_waiting_approval",
    visualState: "desk_waiting_approval",
    zone: "executive_office",
    markerColor: "#d6b45f",
  },
  action_running: {
    officeState: "working_at_desk",
    visualState: "desk_working",
    zone: "desk",
    markerColor: "#9fb7d6",
    worksAtDesk: true,
  },
  process_running: {
    officeState: "running_terminal",
    visualState: "desk_terminal",
    zone: "desk",
    markerColor: "#c8a96a",
    worksAtDesk: true,
  },
  waiting_approval: {
    officeState: "waiting_approval",
    visualState: "desk_waiting_approval",
    zone: "executive_office",
    markerColor: "#d6b45f",
  },
  review_needed: {
    officeState: "reviewing_changes",
    visualState: "desk_review",
    zone: "executive_office",
    markerColor: "#d6b45f",
  },
  handoff_ready: {
    officeState: "handoff_ready",
    visualState: "social_handoff_ready",
    zone: "executive_office",
    markerColor: "#a7c080",
  },
  done_clean: {
    officeState: "handoff_ready",
    visualState: "social_handoff_ready",
    zone: "executive_office",
    markerColor: "#a7c080",
  },
  blocked: {
    officeState: "blocked",
    visualState: "desk_blocked",
    zone: "executive_office",
    markerColor: "#d98284",
  },
  stopped: {
    officeState: "offline",
    visualState: "offline_stopped",
    zone: "offline",
    markerColor: "#737d75",
    muted: true,
  },
};

export function floorVisualStateForPresentationState(
  state: EmployeeVisualState,
): EmployeeFloorVisualState {
  return floorStateByPresentationState[state].visualState;
}

export function createEmployeeFloorViewModel({
  employee,
  presentation,
  selected,
  deskIndex,
}: EmployeeFloorViewModelInput): EmployeeFloorViewModel {
  const config = floorStateConfigForPresentation(presentation);

  return {
    id: employee.id,
    kind: "employee",
    name: employee.name,
    role: employee.role,
    employeeStatus: employee.status,
    selected,
    deskIndex,
    standbySlotId: null,
    standbyRoom: null,
    sourceState: presentation.state,
    officeState: config.officeState,
    visualState: config.visualState,
    zone: config.zone,
    label: presentation.label,
    detail: presentation.detail,
    stationTitle: presentation.stationTitle,
    cwd: employee.cwd,
    worktreePath: employee.worktreePath ?? null,
    branchName: employee.branchName ?? null,
    currentCommand: employee.currentCommand ?? null,
    terminalSessionId: employee.terminalSessionId ?? null,
    markerColor: config.markerColor,
    muted: config.muted ?? false,
    worksAtDesk: config.worksAtDesk ?? false,
    pendingApprovals: presentation.pendingApprovals,
    runningActions: presentation.runningActions,
    runningProcesses: presentation.runningProcesses,
    changedFiles: presentation.changedFiles,
    hasHandoffReady: presentation.hasHandoffReady,
    hasReviewNeeded: presentation.hasReviewNeeded,
    attentionReason: presentation.attentionReason,
    behavior: presentation.behavior,
    workPhase: presentation.workPhase,
    turnOwner: presentation.turnOwner,
    terminalState: presentation.terminalState,
    activityReason: presentation.activityReason,
    blockers: presentation.blockers,
  };
}

function floorStateConfigForPresentation(
  presentation: EmployeeActivityPresentation,
): FloorStateConfig {
  switch (presentation.behavior) {
    case "coming_to_owner":
    case "waiting_at_owner":
      return ownerAttentionFloorStateConfig(presentation);
    case "on_standby":
      return floorStateByPresentationState.standby;
    case "offline":
      return floorStateByPresentationState.stopped;
    case "at_desk_working":
      return floorStateByPresentationState.codex_running;
    case "at_desk_terminal":
      return atDeskTerminalFloorStateConfig(presentation);
    case "at_desk_idle":
      return floorStateByPresentationState.idle;
    case null:
    default:
      return floorStateByPresentationState[presentation.state];
  }
}

function atDeskTerminalFloorStateConfig(
  presentation: EmployeeActivityPresentation,
): FloorStateConfig {
  switch (presentation.state) {
    case "action_running":
      return {
        officeState: "running_terminal",
        visualState: "desk_terminal",
        zone: "desk",
        markerColor: "#9fb7d6",
        worksAtDesk: true,
      };
    case "codex_running":
      return floorStateByPresentationState.codex_starting;
    default:
      return floorStateByPresentationState[presentation.state];
  }
}

function ownerAttentionFloorStateConfig(
  presentation: EmployeeActivityPresentation,
): FloorStateConfig {
  switch (presentation.attentionReason) {
    case "needs_terminal_approval":
      return floorStateByPresentationState.codex_waiting_approval;
    case "needs_app_approval":
    case "needs_approval":
      return floorStateByPresentationState.waiting_approval;
    case "needs_instruction":
      return floorStateByPresentationState.codex_waiting_instruction;
    case "review_needed":
      return floorStateByPresentationState.review_needed;
    case "handoff_ready":
    case "ready_to_report":
      return floorStateByPresentationState.handoff_ready;
    case "blocked_needs_help":
      return floorStateByPresentationState.blocked;
    default:
      return floorStateByPresentationState[presentation.state];
  }
}

export function createEmployeeFloorViewModels(
  inputs: Array<{
    employee: Employee;
    presentation: EmployeeActivityPresentation;
  }>,
  selectedEmployeeId: string | null,
  options: { includeStandby?: boolean } = {},
): EmployeeFloorViewModel[] {
  const employeeModels = inputs.map(({ employee, presentation }, index) =>
    createEmployeeFloorViewModel({
      employee,
      presentation,
      selected: employee.id === selectedEmployeeId,
      deskIndex: index,
    }),
  );

  if (!options.includeStandby) {
    return employeeModels;
  }

  const standbyCount = Math.max(0, OFFICE_VISUAL_CAPACITY - employeeModels.length);
  const standbyModels = OFFICE_ROOM_OCCUPANT_SLOTS.slice(0, standbyCount).map((slot, index) =>
    createStandbyFloorViewModel(slot, index),
  );
  return [...employeeModels, ...standbyModels];
}

export function createStandbyFloorViewModel(
  slot: OfficeRoomSlot,
  index: number,
): EmployeeFloorViewModel {
  return {
    id: `standby:${slot.id}`,
    kind: "standby",
    name: "",
    role: "general",
    employeeStatus: "idle",
    selected: false,
    deskIndex: index,
    standbySlotId: slot.id,
    standbyRoom: slot.room,
    sourceState: "idle",
    officeState: "standby_available",
    visualState: "social_idle",
    zone: "standby",
    label: "Available",
    detail: "Available employee slot",
    stationTitle: "Available employee slot",
    cwd: "",
    worktreePath: null,
    branchName: null,
    currentCommand: null,
    terminalSessionId: null,
    markerColor: "#7e8982",
    muted: false,
    worksAtDesk: false,
    pendingApprovals: 0,
    runningActions: 0,
    runningProcesses: 0,
    changedFiles: 0,
    hasHandoffReady: false,
    hasReviewNeeded: false,
    attentionReason: null,
    behavior: "on_standby",
    workPhase: "idle",
    turnOwner: "none",
    terminalState: "none",
    activityReason: "standby_slot",
    blockers: [],
  };
}
