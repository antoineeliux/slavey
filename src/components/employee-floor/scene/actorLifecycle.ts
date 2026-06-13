import * as THREE from "three";

import {
  isDeskOccupantFloorViewModel,
  isPetFloorViewModel,
  type EmployeeFloorViewModel,
} from "../employeeFloorViewModel";
import {
  applyCharacterView,
  createCharacter,
  disposeCharacter,
  type EmployeeActor,
} from "./createCharacter";
import { createDesk, disposeDesk, updateDeskState } from "./createDesk";
import type { FloorScene } from "./createScene";
import {
  anchorTargetsForViewModel,
  spawnPointForViewModel,
} from "./characterBehavior";
import type { ActorMap } from "./actorTypes";
import { EMPLOYEE_ENTRY_POINT } from "./layout";
import { followTargetForPet } from "./petCompanionBehavior";

export function syncActorLifecycle(
  floorScene: FloorScene,
  actors: ActorMap,
  viewModels: EmployeeFloorViewModel[],
  minimumDeskCount = 8,
): void {
  const activeIds = new Set(viewModels.map((viewModel) => viewModel.id));

  for (const [employeeId, actor] of actors) {
    if (!activeIds.has(employeeId)) {
      floorScene.actorGroup.remove(actor.root);
      floorScene.actorGroup.remove(actor.target);
      disposeCharacter(actor);
      actors.delete(employeeId);
    }
  }

  syncDesks(floorScene, viewModels, minimumDeskCount);

  const initialSceneMount = actors.size === 0;
  for (const viewModel of viewModels) {
    let actor = actors.get(viewModel.id);
    if (!actor) {
      actor = createCharacter(viewModel, floorScene.materials);
      installActorAnchors(actor, viewModel);
      actor.root.position.copy(
        spawnPointForActorMountWithParent(viewModel, actors, initialSceneMount),
      );
      actor.visual.lastPosition.copy(actor.root.position);
      actor.root.rotation.y = actor.homeRotationY;
      actor.target.position.set(actor.root.position.x, actor.height, actor.root.position.z);
      floorScene.actorGroup.add(actor.root, actor.target);
      actors.set(viewModel.id, actor);
    }
    installActorAnchors(actor, viewModel);
    applyCharacterView(actor, viewModel, floorScene.materials);
  }
}

export function updateDeskStates(
  floorScene: FloorScene,
  viewModels: EmployeeFloorViewModel[],
  elapsed: number,
  reducedMotion: boolean,
): void {
  const viewByDesk = new Map(
    viewModels
      .filter((viewModel) => isDeskOccupantFloorViewModel(viewModel) && viewModel.worksAtDesk)
      .map((viewModel) => [viewModel.deskIndex, viewModel]),
  );
  for (const desk of floorScene.desks.values()) {
    updateDeskState(desk, viewByDesk.get(desk.index) ?? null, elapsed, reducedMotion);
  }
}

export function disposeActors(actors: ActorMap): void {
  for (const actor of actors.values()) {
    actor.root.removeFromParent();
    actor.target.removeFromParent();
    disposeCharacter(actor);
  }
  actors.clear();
}

export function disposeDesks(floorScene: FloorScene): void {
  for (const desk of floorScene.desks.values()) {
    floorScene.deskGroup.remove(desk.root);
    disposeDesk(desk);
  }
  floorScene.desks.clear();
}

export function installActorAnchors(
  actor: EmployeeActor,
  viewModel: EmployeeFloorViewModel,
): void {
  const targets = anchorTargetsForViewModel(viewModel);
  actor.visual.desk.copy(targets.desk);
  actor.visual.cafeteria.copy(targets.cafeteria);
  actor.visual.standby.copy(targets.standby);
  actor.visual.executive.copy(targets.executive);
  actor.visual.doneRoom.copy(targets.doneRoom);
  actor.visual.officeA.copy(targets.officeA);
  actor.visual.officeB.copy(targets.officeB);
  if (actor.visual.officeTarget.lengthSq() === 0) actor.visual.officeTarget.copy(targets.officeA);
  if (actor.visual.cafeteriaTarget.lengthSq() === 0) actor.visual.cafeteriaTarget.copy(targets.cafeteria);
  if (actor.visual.standbyTarget.lengthSq() === 0) actor.visual.standbyTarget.copy(targets.standby);
  if (actor.visual.doneRoomTarget.lengthSq() === 0) actor.visual.doneRoomTarget.copy(actor.visual.doneRoom);
  actor.homeRotationY = targets.homeRotationY;
}

export function spawnPointForActorMount(
  viewModel: EmployeeFloorViewModel,
  initialSceneMount: boolean,
): THREE.Vector3 {
  if (isPetFloorViewModel(viewModel)) {
    return EMPLOYEE_ENTRY_POINT.clone();
  }
  if (initialSceneMount) {
    return spawnPointForViewModel(viewModel);
  }
  return EMPLOYEE_ENTRY_POINT.clone();
}

function spawnPointForActorMountWithParent(
  viewModel: EmployeeFloorViewModel,
  actors: ActorMap,
  initialSceneMount: boolean,
): THREE.Vector3 {
  if (isPetFloorViewModel(viewModel)) {
    const parent = viewModel.followTargetEmployeeId
      ? actors.get(viewModel.followTargetEmployeeId)
      : null;
    if (parent) {
      return followTargetForPet(parent, viewModel);
    }
  }
  return spawnPointForActorMount(viewModel, initialSceneMount);
}

function syncDesks(
  floorScene: FloorScene,
  viewModels: EmployeeFloorViewModel[],
  minimumDeskCount: number,
): void {
  const employeeViewModels = viewModels.filter(isDeskOccupantFloorViewModel);
  const activeDeskIndexes = new Set(employeeViewModels.map((viewModel) => viewModel.deskIndex));
  const deskCount = Math.max(minimumDeskCount, employeeViewModels.length);
  for (let index = 0; index < deskCount; index += 1) {
    activeDeskIndexes.add(index);
  }

  for (const deskIndex of activeDeskIndexes) {
    if (!floorScene.desks.has(deskIndex)) {
      const desk = createDesk(deskIndex, floorScene.materials);
      floorScene.deskGroup.add(desk.root);
      floorScene.desks.set(deskIndex, desk);
    }
  }

  for (const [deskIndex, desk] of floorScene.desks) {
    if (!activeDeskIndexes.has(deskIndex)) {
      floorScene.deskGroup.remove(desk.root);
      disposeDesk(desk);
      floorScene.desks.delete(deskIndex);
    }
  }
}
