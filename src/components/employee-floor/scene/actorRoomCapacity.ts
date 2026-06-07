import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import {
  behaviorForViewModel,
  type CharacterLocation,
} from "./characterBehavior";
import type { EmployeeActor } from "./createCharacter";
import {
  CAFETERIA_WANDER_POINTS,
  DONE_ROOM_POINTS,
  EXECUTIVE_QUEUE_POINTS,
  OFFICE_WANDER_POINTS,
  STANDBY_WANDER_POINTS,
} from "./layout";
import { clampToWalkable } from "./navigation";
import { pointAllowedForViewModel } from "./actorAccessRules";

export type ActorTargetAssignments = ReadonlyMap<string, THREE.Vector3>;

type CapacityLocation = Extract<
  CharacterLocation,
  "standby" | "done_room" | "executive"
>;

const CAPACITY_TARGETS: Record<CapacityLocation, THREE.Vector3[]> = {
  standby: STANDBY_WANDER_POINTS,
  done_room: DONE_ROOM_POINTS,
  executive: EXECUTIVE_QUEUE_POINTS,
};

export const ROOM_CAPACITY_LIMITS: Record<CapacityLocation, number> = {
  standby: CAPACITY_TARGETS.standby.length,
  done_room: CAPACITY_TARGETS.done_room.length,
  executive: CAPACITY_TARGETS.executive.length,
};

export function createRoomCapacityTargetAssignments(
  entries: Array<{ actor: EmployeeActor; viewModel: EmployeeFloorViewModel }>,
): Map<string, THREE.Vector3> {
  const assignments = new Map<string, THREE.Vector3>();
  const byLocation = new Map<CapacityLocation, Array<{ actor: EmployeeActor; viewModel: EmployeeFloorViewModel }>>();
  const reservedTargetKeys = new Set<string>();

  for (const entry of entries) {
    const actionTarget = entry.actor.visual.action?.target;
    if (actionTarget) {
      reservedTargetKeys.add(targetKey(clampToWalkable(actionTarget)));
    }
    const location = capacityLocationForViewModel(entry.viewModel);
    if (!location) continue;
    const locationEntries = byLocation.get(location) ?? [];
    locationEntries.push(entry);
    byLocation.set(location, locationEntries);
  }

  for (const [location, locationEntries] of byLocation) {
    const availableTargets = CAPACITY_TARGETS[location];
    const unassigned = locationEntries
      .filter((entry) => !entry.actor.visual.action)
      .sort((first, second) => first.viewModel.deskIndex - second.viewModel.deskIndex);

    for (let index = 0; index < unassigned.length; index += 1) {
      const entry = unassigned[index];
      const target =
        targetFromCapacityPool(entry.actor, availableTargets, reservedTargetKeys) ??
        overflowTargetForActor(entry.actor, reservedTargetKeys);
      if (target) {
        reservedTargetKeys.add(targetKey(target));
        assignments.set(entry.actor.id, target);
      }
    }
  }

  return assignments;
}

function capacityLocationForViewModel(
  viewModel: EmployeeFloorViewModel,
): CapacityLocation | null {
  const location = behaviorForViewModel(viewModel).location;
  return location === "standby" || location === "done_room" || location === "executive"
    ? location
    : null;
}

function targetFromCapacityPool(
  actor: EmployeeActor,
  targets: THREE.Vector3[],
  reservedTargetKeys: Set<string>,
): THREE.Vector3 | null {
  for (let offset = 0; offset < targets.length; offset += 1) {
    const target = clampToWalkable(
      targets[(actor.viewModel.deskIndex + offset) % targets.length],
    );
    if (
      !reservedTargetKeys.has(targetKey(target)) &&
      pointAllowedForViewModel(actor.viewModel, target)
    ) {
      return target;
    }
  }
  return null;
}

function overflowTargetForActor(
  actor: EmployeeActor,
  reservedTargetKeys: Set<string>,
): THREE.Vector3 | null {
  const overflowTargets = [
    ...STANDBY_WANDER_POINTS,
    ...OFFICE_WANDER_POINTS,
    ...CAFETERIA_WANDER_POINTS,
    ...DONE_ROOM_POINTS,
  ];
  for (let offset = 0; offset < overflowTargets.length; offset += 1) {
    const target = clampToWalkable(
      overflowTargets[(actor.viewModel.deskIndex + offset) % overflowTargets.length],
    );
    if (
      !reservedTargetKeys.has(targetKey(target)) &&
      pointAllowedForViewModel(actor.viewModel, target)
    ) {
      return target;
    }
  }

  const fallback = clampToWalkable(actor.visual.standby);
  return pointAllowedForViewModel(actor.viewModel, fallback) ? fallback : null;
}

function targetKey(target: THREE.Vector3): string {
  return `${target.x.toFixed(2)}:${target.z.toFixed(2)}`;
}
