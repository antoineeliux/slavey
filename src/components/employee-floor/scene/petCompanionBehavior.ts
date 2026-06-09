import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { EmployeeActor } from "./createCharacter";
import { deskAnchorForIndex, hashUnit } from "./layout";
import { clampToWalkable } from "./navigation";

const PET_FOLLOW_SPEED = 1.9;
const PET_ATTENTION_SPEED = 2.25;
const PET_SNAP_DISTANCE = 5.5;

export function followTargetForPet(
  parent: EmployeeActor,
  petViewModel: EmployeeFloorViewModel,
): THREE.Vector3 {
  if (parent.viewModel.worksAtDesk || parent.viewModel.zone === "desk") {
    return deskSideTargetForPet(parent, petViewModel);
  }

  const offset = followOffsetForPet(petViewModel);
  return clampToWalkable(
    new THREE.Vector3(
      parent.root.position.x + offset.x,
      0,
      parent.root.position.z + offset.z,
    ),
  );
}

export function followOffsetForPet(
  petViewModel: EmployeeFloorViewModel,
): THREE.Vector3 {
  const angle = hashUnit(petViewModel.id, 73) * Math.PI * 2;
  const radius = 1.15 + hashUnit(petViewModel.id, 89) * 0.5;
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

export function deskSideTargetForPet(
  parent: EmployeeActor,
  petViewModel: EmployeeFloorViewModel,
): THREE.Vector3 {
  const anchor = deskAnchorForIndex(parent.viewModel.deskIndex);
  const dir = anchor.row === 0 ? 1 : -1;
  const side = hashUnit(petViewModel.id, 131) > 0.5 ? 1 : -1;
  const sideSpacing = 2.02 + hashUnit(petViewModel.id, 149) * 0.34;
  const chairOffset = 0.18 + hashUnit(petViewModel.id, 157) * 0.36;
  return clampToWalkable(
    new THREE.Vector3(
      anchor.desk.x + side * sideSpacing,
      0,
      anchor.desk.z - dir * chairOffset,
    ),
  );
}

export function updatePetActorVisual({
  actor,
  viewModel,
  parent,
  delta,
  time,
  reducedMotion,
}: {
  actor: EmployeeActor;
  viewModel: EmployeeFloorViewModel;
  parent: EmployeeActor | null;
  delta: number;
  time: number;
  reducedMotion: boolean;
}): void {
  actor.visual.action = null;
  actor.visual.path = [];
  actor.visual.pathDestinationKey = null;
  actor.visual.heldProp = "none";
  actor.visual.location = "office";

  const needsAttention = petNeedsAttention(viewModel);
  const restingActivity = needsAttention ? "approval" : "chilling";

  if (!parent) {
    actor.visual.posture = "standing";
    actor.visual.activity = restingActivity;
    setRootRotationY(actor.root, Math.sin(time * 0.8 + actor.viewModel.deskIndex) * 0.3 + Math.PI);
    return;
  }

  const target = followTargetForPet(parent, viewModel);
  const shouldSitAtDesk = petShouldSitAtDesk(parent);
  const dx = target.x - actor.root.position.x;
  const dz = target.z - actor.root.position.z;
  const distance = Math.hypot(dx, dz);

  if (reducedMotion || distance > PET_SNAP_DISTANCE) {
    actor.root.position.x = target.x;
    actor.root.position.z = target.z;
    actor.visual.posture = shouldSitAtDesk ? "sitting" : "standing";
    actor.visual.activity = restingActivity;
    faceParent(actor, parent);
    return;
  }

  if (distance > 0.035) {
    const speed = needsAttention ? PET_ATTENTION_SPEED : PET_FOLLOW_SPEED;
    const step = Math.min(distance, speed * delta);
    actor.root.position.x += (dx / distance) * step;
    actor.root.position.z += (dz / distance) * step;
    setRootRotationY(actor.root, Math.atan2(-dx, -dz));
    actor.visual.posture = "walking";
    actor.visual.activity = needsAttention ? "approval" : "roaming";
    return;
  }

  actor.root.position.x = target.x;
  actor.root.position.z = target.z;
  actor.visual.posture = shouldSitAtDesk ? "sitting" : "standing";
  actor.visual.activity = restingActivity;
  faceParent(actor, parent);
}

export function petNeedsAttention(viewModel: EmployeeFloorViewModel): boolean {
  return Boolean(viewModel.attentionReason || viewModel.pendingApprovals > 0);
}

function faceParent(actor: EmployeeActor, parent: EmployeeActor): void {
  const dx = parent.root.position.x - actor.root.position.x;
  const dz = parent.root.position.z - actor.root.position.z;
  if (Math.hypot(dx, dz) < 0.001) {
    return;
  }
  setRootRotationY(actor.root, Math.atan2(-dx, -dz));
}

function petShouldSitAtDesk(
  parent: EmployeeActor,
): boolean {
  return Boolean(parent.viewModel.worksAtDesk || parent.viewModel.zone === "desk");
}

function setRootRotationY(root: THREE.Object3D, rotationY: number): void {
  if (!root.rotation) return;
  root.rotation.y = rotationY;
}
