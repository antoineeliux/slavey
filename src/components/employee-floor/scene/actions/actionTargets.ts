import * as THREE from "three";

import { pointAllowedForViewModel } from "../actorAccessRules";
import type { EmployeeActor } from "../createCharacter";
import { clampToWalkable } from "../navigation";

export function actionTargetForActor(actor: EmployeeActor): THREE.Vector3 | null {
  const action = actor.visual.action ?? null;
  if (!action) {
    return null;
  }

  const target = clampToWalkable(action.target);
  if (!pointAllowedForViewModel(actor.viewModel, target)) {
    actor.visual.action = null;
    return null;
  }
  return target;
}

export function applyActionVisual(actor: EmployeeActor): boolean {
  const action = actor.visual.action ?? null;
  if (!action) {
    actor.visual.heldProp = "none";
    return false;
  }

  actor.visual.location = action.location;
  actor.visual.posture = action.posture;
  actor.visual.activity = action.activity;
  actor.visual.heldProp = action.heldProp;

  if (action.lookAt) {
    setRootRotationY(
      actor.root,
      Math.atan2(
        actor.root.position.x - action.lookAt.x,
        actor.root.position.z - action.lookAt.z,
      ),
    );
  } else if (action.facing !== null) {
    setRootRotationY(actor.root, action.facing);
  }

  return true;
}

function setRootRotationY(root: THREE.Object3D, rotationY: number): void {
  if (!root.rotation) return;
  root.rotation.y = rotationY;
}
