import * as THREE from "three";

import type { EmployeeActor } from "./createCharacter";
import type { CharacterBehavior } from "./characterBehavior";
import type { ActorTargetAssignments } from "./actorRoomCapacity";
import {
  CAFETERIA_WANDER_POINTS,
  DONE_ROOM_POINTS,
  OFFICE_WANDER_POINTS,
  SOCIAL_CLUSTERS,
  STANDBY_WANDER_POINTS,
} from "./layout";
import { clampToWalkable } from "./navigation";
import { actionTargetForActor } from "./actions/actionTargets";
import { pointAllowedForViewModel } from "./actorAccessRules";

export function targetForActor(
  actor: EmployeeActor,
  behavior: CharacterBehavior,
  time: number,
  targetAssignments?: ActorTargetAssignments,
): THREE.Vector3 {
  const actionTarget = actionTargetForActor(actor);
  if (actionTarget) return actionTarget;

  const assignedTarget = targetAssignments?.get(actor.id);
  if (assignedTarget && pointAllowedForViewModel(actor.viewModel, assignedTarget)) {
    return assignedTarget;
  }

  if (behavior.location === "office") return socialTarget(actor, "office", time);
  if (behavior.location === "cafeteria") return socialTarget(actor, "cafeteria", time);
  if (behavior.location === "standby" && actor.viewModel.officeState === "on_standby") {
    return safeMutableTarget(actor.visual.standby);
  }
  if (behavior.location === "standby") return standbyTarget(actor, time);
  if (behavior.location === "done_room") return doneRoomTarget(actor, time);
  if (behavior.location === "executive") return safeMutableTarget(actor.visual.executive);
  return safeMutableTarget(actor.visual.desk);
}

export function standbyTarget(actor: EmployeeActor, time: number): THREE.Vector3 {
  return roomTarget(actor, {
    currentTarget: actor.visual.standbyTarget,
    points: STANDBY_WANDER_POINTS,
    dwellSeconds: 5.4,
    time,
    offset: 0,
  });
}

export function doneRoomTarget(actor: EmployeeActor, time: number): THREE.Vector3 {
  return roomTarget(actor, {
    currentTarget: actor.visual.doneRoomTarget,
    points: DONE_ROOM_POINTS,
    dwellSeconds: 6.8,
    time,
    offset: 2,
  });
}

export function socialTarget(
  actor: EmployeeActor,
  zone: "office" | "cafeteria",
  time: number,
): THREE.Vector3 {
  const targetKey = zone === "office" ? "officeTarget" : "cafeteriaTarget";
  const currentTarget = actor.visual[targetKey];
  currentTarget.copy(clampToWalkable(currentTarget));
  if (!pointAllowedForViewModel(actor.viewModel, currentTarget)) {
    currentTarget.copy(nextAllowedWanderPoint(zone, actor));
    actor.visual.talkUntil = 0;
    actor.visual.socialIntent = "roaming";
    actor.visual.socialLookAt = null;
  }
  const distanceToTarget = Math.hypot(
    currentTarget.x - actor.root.position.x,
    currentTarget.z - actor.root.position.z,
  );
  if (distanceToTarget > 0.12) return currentTarget;
  if (time < actor.visual.talkUntil) return actor.visual[targetKey];

  actor.visual.roamIndex += 1;
  const shouldTalk = actor.visual.roamIndex % 3 === 0;
  if (shouldTalk) {
    const cluster = pickAllowedCluster(zone, actor);
    if (cluster) {
      const slot = cluster.slots[actor.visual.roamIndex % cluster.slots.length];
      actor.visual[targetKey].copy(clampToWalkable(slot));
      actor.visual.talkUntil = time + 4.2 + (actor.visual.roamIndex % 2) * 1.2;
      actor.visual.socialIntent = "talking";
      actor.visual.socialLookAt = cluster.center;
    } else {
      actor.visual[targetKey].copy(nextAllowedWanderPoint(zone, actor));
      actor.visual.talkUntil = time + 0.2;
      actor.visual.socialIntent = "roaming";
      actor.visual.socialLookAt = null;
    }
  } else {
    actor.visual[targetKey].copy(nextAllowedWanderPoint(zone, actor));
    actor.visual.talkUntil = time + 0.2;
    actor.visual.socialIntent = "roaming";
    actor.visual.socialLookAt = null;
  }
  return actor.visual[targetKey];
}

function safeMutableTarget(target: THREE.Vector3): THREE.Vector3 {
  target.copy(clampToWalkable(target));
  return target;
}

function roomTarget(
  actor: EmployeeActor,
  {
    currentTarget,
    points,
    dwellSeconds,
    time,
    offset,
  }: {
    currentTarget: THREE.Vector3;
    points: THREE.Vector3[];
    dwellSeconds: number;
    time: number;
    offset: number;
  },
): THREE.Vector3 {
  currentTarget.copy(clampToWalkable(currentTarget));
  const distanceToTarget = Math.hypot(
    currentTarget.x - actor.root.position.x,
    currentTarget.z - actor.root.position.z,
  );
  if (distanceToTarget > 0.12) return currentTarget;
  if (time < actor.visual.talkUntil) return currentTarget;

  actor.visual.roamIndex += 1;
  const point = points[(actor.visual.roamIndex + actor.viewModel.deskIndex + offset) % points.length];
  currentTarget.copy(clampToWalkable(point));
  actor.visual.talkUntil = time + dwellSeconds;
  actor.visual.socialIntent = actor.visual.roamIndex % 3 === 0 ? "talking" : "roaming";
  actor.visual.socialLookAt = null;
  return currentTarget;
}

function pickAllowedCluster(zone: "office" | "cafeteria", actor: EmployeeActor) {
  const clusters = SOCIAL_CLUSTERS[zone].filter((cluster) =>
    cluster.slots.every((slot) => pointAllowedForViewModel(actor.viewModel, clampToWalkable(slot))),
  );
  return clusters[actor.viewModel.deskIndex % clusters.length] ?? null;
}

function nextAllowedWanderPoint(
  zone: "office" | "cafeteria",
  actor: EmployeeActor,
): THREE.Vector3 {
  const points = zone === "office" ? OFFICE_WANDER_POINTS : CAFETERIA_WANDER_POINTS;
  for (let offset = 0; offset < points.length; offset += 1) {
    const point = points[
      (actor.visual.roamIndex + actor.viewModel.deskIndex + offset) % points.length
    ];
    const target = clampToWalkable(point);
    if (pointAllowedForViewModel(actor.viewModel, target)) {
      return target;
    }
  }
  return safeMutableTarget(actor.visual.standby);
}
