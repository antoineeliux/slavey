import * as THREE from "three";

import {
  isPetFloorViewModel,
  type EmployeeFloorViewModel,
} from "../employeeFloorViewModel";
import {
  DONE_ROOM_POINTS,
  EMPLOYEE_ENTRY_POINT,
  EXECUTIVE_QUEUE_POINTS,
  deskAnchorForIndex,
  standbyAnchorForIndex,
} from "./layout";

export type CharacterPosture = "standing" | "sitting" | "walking";

export type CharacterLocation =
  | "desk"
  | "office"
  | "cafeteria"
  | "standby"
  | "meeting"
  | "lounge"
  | "cocktail_bar"
  | "executive"
  | "done_room"
  | "offline";

export type CharacterActivity =
  | "none"
  | "typing"
  | "terminal"
  | "waiting_instruction"
  | "approval"
  | "reviewing"
  | "blocked"
  | "thinking"
  | "handoff"
  | "chilling"
  | "drinking"
  | "meeting"
  | "phone"
  | "presenting"
  | "talking"
  | "roaming"
  | "returning";

export type CharacterBehavior = {
  posture: CharacterPosture;
  location: CharacterLocation;
  activity: CharacterActivity;
  speed: "work" | "social";
  social: boolean;
};

export type CharacterAnchorTargets = {
  spawn: THREE.Vector3;
  desk: THREE.Vector3;
  cafeteria: THREE.Vector3;
  standby: THREE.Vector3;
  executive: THREE.Vector3;
  doneRoom: THREE.Vector3;
  officeA: THREE.Vector3;
  officeB: THREE.Vector3;
  homeRotationY: number;
};

export function behaviorForViewModel(viewModel: EmployeeFloorViewModel): CharacterBehavior {
  if (isPetFloorViewModel(viewModel)) {
    return behavior(
      "standing",
      "office",
      viewModel.attentionReason || viewModel.pendingApprovals > 0 ? "approval" : "chilling",
      "social",
    );
  }

  switch (viewModel.officeState) {
    case "on_standby":
      return behavior("sitting", "standby", "chilling", "social");
    case "standby_available":
      return behavior("standing", "standby", "chilling", "social");
    case "idle_available":
      return behavior("standing", "done_room", "chilling", "social");
    case "handoff_ready":
      return behavior("standing", "executive", "handoff", "work");
    case "running_terminal":
      return behavior("sitting", "desk", "terminal", "work");
    case "waiting_instruction":
      return behavior("standing", "executive", "waiting_instruction", "work");
    case "terminal_waiting_approval":
    case "waiting_approval":
      return behavior("standing", "executive", "approval", "work");
    case "reviewing_changes":
      return behavior("standing", "executive", "reviewing", "work");
    case "blocked":
      return behavior("standing", "executive", "blocked", "work");
    case "offline":
      return behavior("standing", "standby", "chilling", "social");
    case "working_at_desk":
    default:
      return behavior("sitting", "desk", "typing", "work");
  }
}

export function anchorTargetsForViewModel(
  viewModel: EmployeeFloorViewModel,
): CharacterAnchorTargets {
  const deskAnchor = deskAnchorForIndex(viewModel.deskIndex);
  const standbySlot = standbyAnchorForIndex(viewModel.deskIndex);
  const executive = executiveQueuePointForIndex(viewModel.deskIndex);
  const doneRoom = doneRoomPointForIndex(viewModel.deskIndex);

  return {
    spawn: spawnPointForViewModel(viewModel),
    desk: deskAnchor.desk.clone(),
    cafeteria: deskAnchor.cafeteria.clone(),
    standby: standbySlot.position.clone(),
    executive,
    doneRoom,
    officeA: deskAnchor.officeA.clone(),
    officeB: deskAnchor.officeB.clone(),
    homeRotationY: Math.PI + (deskAnchor.row === 0 ? -0.05 : 0.06),
  };
}

export function spawnPointForViewModel(viewModel: EmployeeFloorViewModel): THREE.Vector3 {
  if (isPetFloorViewModel(viewModel)) {
    return EMPLOYEE_ENTRY_POINT.clone();
  }
  if (viewModel.kind === "standby") {
    return standbyAnchorForIndex(viewModel.deskIndex).position.clone();
  }
  if (viewModel.officeState === "on_standby") {
    return standbyAnchorForIndex(viewModel.deskIndex).position.clone();
  }
  if (viewModel.officeState === "idle_available") {
    return doneRoomPointForIndex(viewModel.deskIndex);
  }
  if (officeStateUsesExecutiveQueue(viewModel.officeState)) {
    return executiveQueuePointForIndex(viewModel.deskIndex);
  }
  return deskAnchorForIndex(viewModel.deskIndex).desk.clone();
}

export function executiveQueuePointForIndex(index: number): THREE.Vector3 {
  return EXECUTIVE_QUEUE_POINTS[index % EXECUTIVE_QUEUE_POINTS.length].clone();
}

export function doneRoomPointForIndex(index: number): THREE.Vector3 {
  return DONE_ROOM_POINTS[index % DONE_ROOM_POINTS.length].clone();
}

export function isSocialLocation(location: CharacterLocation): boolean {
  return (
    location === "office" ||
    location === "cafeteria" ||
    location === "standby" ||
    location === "meeting" ||
    location === "lounge" ||
    location === "cocktail_bar" ||
    location === "done_room"
  );
}

function behavior(
  posture: CharacterPosture,
  location: CharacterLocation,
  activity: CharacterActivity,
  speed: "work" | "social",
): CharacterBehavior {
  return {
    posture,
    location,
    activity,
    speed,
    social: isSocialLocation(location),
  };
}

function officeStateUsesExecutiveQueue(
  officeState: EmployeeFloorViewModel["officeState"],
): boolean {
  return (
    officeState === "waiting_instruction" ||
    officeState === "terminal_waiting_approval" ||
    officeState === "waiting_approval" ||
    officeState === "reviewing_changes" ||
    officeState === "handoff_ready" ||
    officeState === "blocked"
  );
}
