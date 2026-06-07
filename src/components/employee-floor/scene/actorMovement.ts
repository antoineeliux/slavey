import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { EmployeeActor } from "./createCharacter";
import {
  behaviorForViewModel,
  type CharacterBehavior,
  type CharacterLocation,
} from "./characterBehavior";
import {
  createNavigationPath,
  clampToWalkable,
  nudgeWithinWalkable,
  pointIsFurnitureBlocked,
} from "./navigation";
import { targetForActor } from "./actorTargets";
import type { ActorTargetAssignments } from "./actorRoomCapacity";
import { applyActionVisual } from "./actions/actionTargets";
import { pointAllowedForViewModel } from "./actorAccessRules";

export const WALK_SPEED = {
  work: 1.55,
  social: 0.62,
} as const;

export const STUCK_SECONDS = 1.8;

export function updateActorVisual(
  actor: EmployeeActor,
  viewModel: EmployeeFloorViewModel,
  delta: number,
  time: number,
  targetAssignments?: ActorTargetAssignments,
): void {
  const behavior = behaviorForViewModel(viewModel);
  const destination = targetForActor(actor, behavior, time, targetAssignments);
  const location = actor.visual.action?.location ?? behavior.location;
  const target = nextNavigationTarget(actor, destination, location, time);
  const root = actor.root;
  const dx = target.x - root.position.x;
  const dz = target.z - root.position.z;
  const distance = Math.hypot(dx, dz);

  if (distance > 0.035) {
    const step = Math.min(distance, WALK_SPEED[behavior.speed] * delta);
    root.position.x += (dx / distance) * step;
    root.position.z += (dz / distance) * step;
    setRootRotationY(root, Math.atan2(-dx, -dz));
    actor.visual.posture = "walking";
    actor.visual.activity = behavior.social ? "roaming" : behavior.activity === "waiting_instruction" ? "waiting_instruction" : "returning";
    actor.visual.location = location;
    actor.visual.heldProp = "none";
    recordActorProgress(actor, destination, target, time);
    return;
  }

  root.position.x = target.x;
  root.position.z = target.z;
  advanceNavigationPath(actor);
  applyActorRestingVisual(actor, behavior, time);
  recordActorProgress(actor, destination, target, time);
}

export function applyActorRestingVisual(
  actor: EmployeeActor,
  behavior: CharacterBehavior,
  time: number,
): void {
  if (applyActionVisual(actor)) {
    return;
  }

  actor.visual.heldProp = "none";
  actor.visual.location = behavior.location;

  if (behavior.social) {
    if (actor.visual.socialLookAt) {
      setRootRotationY(
        actor.root,
        Math.atan2(
          actor.root.position.x - actor.visual.socialLookAt.x,
          actor.root.position.z - actor.visual.socialLookAt.z,
        ),
      );
    } else {
      setRootRotationY(actor.root, Math.sin(time * 0.7) * 0.2 + Math.PI * 0.76);
    }
    actor.visual.posture = behavior.posture;
    actor.visual.activity =
      actor.visual.socialIntent === "talking"
        ? "talking"
        : behavior.activity === "handoff"
          ? "handoff"
          : "chilling";
  } else if (behavior.location === "executive") {
    setRootRotationY(actor.root, Math.PI * 0.52);
    actor.visual.posture = behavior.posture;
    actor.visual.activity = behavior.activity;
  } else {
    setRootRotationY(actor.root, actor.homeRotationY);
    actor.visual.posture = behavior.posture;
    actor.visual.activity = behavior.activity;
  }
}

export function recoverStuckActor(
  actor: EmployeeActor,
  destination: THREE.Vector3,
  time: number,
): void {
  actor.visual.stuckCount += 1;
  actor.visual.repathAt = time + 0.75;
  const nudged = recoveryPointForActor(actor, destination);
  actor.root.position.x = nudged.x;
  actor.root.position.z = nudged.z;
  actor.visual.path = [];
  actor.visual.pathDestinationKey = null;
  actor.visual.lastMovedAt = time;
  actor.visual.lastPosition.copy(actor.root.position);
}

function recoveryPointForActor(
  actor: EmployeeActor,
  destination: THREE.Vector3,
): THREE.Vector3 {
  const source = actor.root.position;
  const dx = destination.x - source.x;
  const dz = destination.z - source.z;
  const length = Math.hypot(dx, dz) || 1;
  const forwardX = dx / length;
  const forwardZ = dz / length;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const seed = actor.viewModel.deskIndex + actor.visual.stuckCount;
  const side = seed % 2 === 0 ? 1 : -1;
  const candidates: THREE.Vector3[] = [];

  for (const distance of [0.52, 0.78, 1.04]) {
    candidates.push(
      new THREE.Vector3(
        source.x + rightX * side * distance + forwardX * 0.16,
        0,
        source.z + rightZ * side * distance + forwardZ * 0.16,
      ),
      new THREE.Vector3(
        source.x - rightX * side * distance + forwardX * 0.16,
        0,
        source.z - rightZ * side * distance + forwardZ * 0.16,
      ),
    );
  }

  const allowed = candidates
    .map((candidate) => clampToWalkable(candidate))
    .filter((candidate) => candidateAllowedForActor(actor, candidate))
    .filter((candidate) => Math.hypot(candidate.x - source.x, candidate.z - source.z) > 0.06)
    .sort((first, second) => first.distanceTo(destination) - second.distanceTo(destination));

  if (allowed[0]) {
    return allowed[0];
  }

  const fallback = nudgeWithinWalkable(source, destination, seed);
  if (candidateAllowedForActor(actor, fallback)) {
    return fallback;
  }

  return clampToWalkable(source);
}

function candidateAllowedForActor(actor: EmployeeActor, candidate: THREE.Vector3): boolean {
  return pointAllowedForViewModel(actor.viewModel, candidate) && !pointIsFurnitureBlocked(candidate);
}

function nextNavigationTarget(
  actor: EmployeeActor,
  destination: THREE.Vector3,
  location: CharacterLocation,
  time: number,
): THREE.Vector3 {
  const key = `${location}:${destination.x.toFixed(2)}:${destination.z.toFixed(2)}`;
  if (actor.visual.pathDestinationKey !== key) {
    actor.visual.pathDestinationKey = key;
    actor.visual.path = createNavigationPath(actor.root.position, destination);
    actor.visual.lastMovedAt = time;
    actor.visual.lastPosition.copy(actor.root.position);
    actor.visual.stuckCount = 0;
  }
  advanceNavigationPath(actor);
  return actor.visual.path[0] ?? destination;
}

function recordActorProgress(
  actor: EmployeeActor,
  destination: THREE.Vector3,
  pathTarget: THREE.Vector3,
  time: number,
): void {
  const moved = Math.hypot(
    actor.root.position.x - actor.visual.lastPosition.x,
    actor.root.position.z - actor.visual.lastPosition.z,
  );
  if (moved > 0.035) {
    actor.visual.lastMovedAt = time;
    actor.visual.lastPosition.copy(actor.root.position);
    return;
  }

  const distanceToDestination = Math.hypot(
    destination.x - actor.root.position.x,
    destination.z - actor.root.position.z,
  );
  const distanceToPathTarget = Math.hypot(
    pathTarget.x - actor.root.position.x,
    pathTarget.z - actor.root.position.z,
  );

  if (
    distanceToDestination > 0.45 &&
    distanceToPathTarget > 0.16 &&
    time - actor.visual.lastMovedAt > STUCK_SECONDS &&
    time >= actor.visual.repathAt
  ) {
    recoverStuckActor(actor, destination, time);
  }
}

function advanceNavigationPath(actor: EmployeeActor): void {
  while (actor.visual.path.length > 1) {
    const target = actor.visual.path[0];
    if (Math.hypot(target.x - actor.root.position.x, target.z - actor.root.position.z) > 0.12) {
      return;
    }
    actor.visual.path.shift();
  }
}

function setRootRotationY(root: THREE.Object3D, rotationY: number): void {
  if (!root.rotation) return;
  root.rotation.y = rotationY;
}
