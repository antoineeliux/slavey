import type {
  EmployeeActivity,
  EmployeeActivityContractRenderActivity,
  EmployeeAttentionReason,
} from "../types";

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

export type EmployeeActivityContractFloorIntent =
  | "desk_working"
  | "desk_terminal"
  | "done_room_idle"
  | "owner_waiting_instruction"
  | "owner_terminal_approval"
  | "owner_approval"
  | "owner_review"
  | "owner_handoff"
  | "owner_blocked"
  | "standby"
  | "offline";

export type EmployeeActivityContractView = {
  state: EmployeeVisualState;
  label: string;
  detail: string;
  attentionRequired: boolean;
  attentionReason: EmployeeAttentionReason | null | undefined;
  floorIntent: EmployeeActivityContractFloorIntent;
};

type ContractStateAndFloorIntent = {
  state: EmployeeVisualState;
  floorIntent: EmployeeActivityContractFloorIntent;
};

type EmployeeActivityWithContract = Pick<EmployeeActivity, "contract">;

export function resolveEmployeeActivityContractView(
  activity: EmployeeActivityWithContract,
): EmployeeActivityContractView {
  const { state, floorIntent } = stateAndFloorIntentForContract(activity);

  const contract = activity.contract;
  const attentionReason = contract.attention.reason ?? fallbackAttentionReasonForState(state);
  return {
    state,
    label: labelForState(state),
    detail: detailForState(state),
    attentionRequired: contract.attention.required || ownerAttentionState(state),
    attentionReason,
    floorIntent,
  };
}

function stateAndFloorIntentForContract(
  activity: EmployeeActivityWithContract,
): ContractStateAndFloorIntent {
  const contract = activity.contract;

  if (contract.lifecycle === "standby") {
    return { state: "standby", floorIntent: "standby" };
  }
  if (contract.lifecycle === "stopped") {
    return { state: "stopped", floorIntent: "offline" };
  }

  switch (contract.render.placement) {
    case "standby":
      return { state: "standby", floorIntent: "standby" };
    case "offline":
      return { state: "stopped", floorIntent: "offline" };
    case "desk":
      return {
        state: deskStateForContract(activity),
        floorIntent: deskFloorIntentForRenderActivity(contract.render.activity),
      };
    case "done_room":
      return {
        state: doneRoomStateForContract(activity),
        floorIntent: "done_room_idle",
      };
    case "owner_office":
      return ownerOfficeViewForContract(activity);
    default:
      return assertNever(contract.render.placement);
  }
}

function deskFloorIntentForRenderActivity(
  activity: EmployeeActivityContractRenderActivity,
): EmployeeActivityContractFloorIntent {
  switch (activity) {
    case "working":
      return "desk_working";
    case "terminal":
      return "desk_terminal";
    case "idle":
    case "waiting_instruction":
    case "approval":
    case "review":
    case "handoff":
    case "blocked":
      return "done_room_idle";
    default:
      return assertNever(activity);
  }
}

function deskStateForContract(
  activity: EmployeeActivityWithContract,
): EmployeeVisualState {
  const contract = activity.contract;
  switch (contract.work.kind) {
    case "codex":
      return "codex_running";
    case "action":
      return "action_running";
    case "process":
      return "process_running";
    case "shell":
      return "shell_running";
    case "none":
    case "review":
      return deskFallbackStateForRenderActivity(contract.render.activity);
    default:
      return assertNever(contract.work.kind);
  }
}

function deskFallbackStateForRenderActivity(
  activity: EmployeeActivityContractRenderActivity,
): EmployeeVisualState {
  switch (activity) {
    case "working":
      return "codex_running";
    case "terminal":
      return "process_running";
    case "idle":
    case "waiting_instruction":
    case "approval":
    case "review":
    case "handoff":
    case "blocked":
      return "idle";
    default:
      return assertNever(activity);
  }
}

function doneRoomStateForContract(
  activity: EmployeeActivityWithContract,
): EmployeeVisualState {
  const contract = activity.contract;
  switch (contract.work.kind) {
    case "shell":
      return "shell_running";
    case "codex":
      return contract.work.phase === "starting" ? "codex_starting" : "idle";
    case "none":
    case "action":
    case "process":
    case "review":
      return "idle";
    default:
      return assertNever(contract.work.kind);
  }
}

function ownerOfficeViewForContract(
  activity: EmployeeActivityWithContract,
): { state: EmployeeVisualState; floorIntent: EmployeeActivityContractFloorIntent } {
  const contract = activity.contract;
  switch (contract.render.activity) {
    case "waiting_instruction":
      return {
        state: "codex_waiting_instruction",
        floorIntent: "owner_waiting_instruction",
      };
    case "approval":
      return contract.attention.reason === "needs_terminal_approval"
        ? {
            state: "codex_waiting_approval",
            floorIntent: "owner_terminal_approval",
          }
        : {
            state: "waiting_approval",
            floorIntent: "owner_approval",
          };
    case "review":
      return {
        state: "review_needed",
        floorIntent: "owner_review",
      };
    case "handoff":
      return {
        state: contract.attention.reason === "ready_to_report" ? "done_clean" : "handoff_ready",
        floorIntent: "owner_handoff",
      };
    case "blocked":
      return {
        state: "blocked",
        floorIntent: "owner_blocked",
      };
    case "idle":
    case "working":
    case "terminal":
      return {
        state: "waiting_approval",
        floorIntent: "owner_approval",
      };
    default:
      return assertNever(contract.render.activity);
  }
}

function labelForState(state: EmployeeVisualState): string {
  switch (state) {
    case "codex_waiting_instruction":
      return "Awaiting prompt";
    case "codex_starting":
      return "Codex starting";
    case "codex_waiting_approval":
      return "Terminal approval";
    case "standby":
      return "On standby";
    case "done_clean":
      return "Done";
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
      return "Idle";
    default:
      return assertNever(state);
  }
}

function detailForState(state: EmployeeVisualState): string {
  switch (state) {
    case "codex_waiting_instruction":
      return "Waiting for your next instruction";
    case "codex_starting":
      return "Preparing session";
    case "codex_waiting_approval":
      return "Approve or reject in terminal";
    case "standby":
      return "Parked in the waiting room";
    case "done_clean":
      return "Ready to report";
    case "shell_running":
      return "Shell open";
    case "codex_running":
      return "Working on task";
    case "waiting_approval":
      return "Waiting for approval";
    case "action_running":
      return "Running action";
    case "process_running":
      return "Running process";
    case "review_needed":
      return "Review needed";
    case "handoff_ready":
      return "Ready to hand off";
    case "blocked":
      return "Needs help";
    case "stopped":
      return "Offline";
    case "idle":
      return "Available";
    default:
      return assertNever(state);
  }
}

function ownerAttentionState(state: EmployeeVisualState): boolean {
  switch (state) {
    case "codex_waiting_instruction":
    case "codex_waiting_approval":
    case "waiting_approval":
    case "review_needed":
    case "handoff_ready":
    case "done_clean":
    case "blocked":
      return true;
    case "idle":
    case "shell_running":
    case "codex_starting":
    case "codex_running":
    case "standby":
    case "action_running":
    case "process_running":
    case "stopped":
      return false;
    default:
      return assertNever(state);
  }
}

function fallbackAttentionReasonForState(
  state: EmployeeVisualState,
): EmployeeAttentionReason | null {
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
    case "idle":
    case "shell_running":
    case "codex_starting":
    case "codex_running":
    case "standby":
    case "action_running":
    case "process_running":
    case "stopped":
      return null;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled employee activity contract value: ${String(value)}`);
}
