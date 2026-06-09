import {
  isPetFloorViewModel,
  type EmployeeFloorViewModel,
} from "../../employeeFloorViewModel";
import { pointAllowedForViewModel } from "../actorAccessRules";
import { behaviorForViewModel } from "../characterBehavior";
import type { ActorMap } from "../actorTypes";
import type { EmployeeActor } from "../createCharacter";
import type { CharacterActionAssignment } from "./characterActionTypes";
import {
  OFFICE_ACTION_SCENES,
  type OfficeActionScene,
  type OfficeActionSlot,
} from "./officeActionManifest";

export function assignCharacterActions(
  actors: ActorMap,
  viewModels: EmployeeFloorViewModel[],
  time: number,
): void {
  const viewModelById = new Map(viewModels.map((viewModel) => [viewModel.id, viewModel]));
  const eligibleActors = viewModels
    .map((viewModel) => {
      const actor = actors.get(viewModel.id) ?? null;
      return actor && isEligibleForAmbientAction(viewModel) ? actor : null;
    })
    .filter((actor): actor is EmployeeActor => actor !== null)
    .sort((first, second) => first.viewModel.deskIndex - second.viewModel.deskIndex);

  const eligibleIds = new Set(eligibleActors.map((actor) => actor.id));
  for (const actor of actors.values()) {
    const viewModel = viewModelById.get(actor.id);
    if (!viewModel || !eligibleIds.has(actor.id) || isActionExpired(actor, time)) {
      actor.visual.action = null;
    }
  }

  const reservedSlotIds = new Set(
    eligibleActors
      .map((actor) => actor.visual.action?.slotId ?? null)
      .filter((slotId): slotId is string => slotId !== null),
  );
  const unassigned = eligibleActors.filter((actor) => !actor.visual.action);

  for (const scene of orderedScenes(time)) {
    const availableSlots = scene.slots.filter((slot) => !reservedSlotIds.has(slot.id));
    const assignments = proposedAssignments(scene, availableSlots, unassigned);
    if (assignments.length < scene.minActors) {
      continue;
    }

    const assignedIds = new Set(assignments.map(({ actor }) => actor.id));
    for (let index = unassigned.length - 1; index >= 0; index -= 1) {
      if (assignedIds.has(unassigned[index].id)) {
        unassigned.splice(index, 1);
      }
    }
    assignments.forEach(({ actor, slot }) => {
      reservedSlotIds.add(slot.id);
      actor.visual.action = createAssignment(scene, slot, actor, time);
    });
  }
}

export function isEligibleForAmbientAction(viewModel: EmployeeFloorViewModel): boolean {
  if (isPetFloorViewModel(viewModel)) {
    return false;
  }
  const behavior = behaviorForViewModel(viewModel);
  return behavior.social && viewModel.officeState !== "offline";
}

function isActionExpired(actor: EmployeeActor, time: number): boolean {
  const action = actor.visual.action;
  return Boolean(action && time >= action.endsAt);
}

function orderedScenes(time: number): readonly OfficeActionScene[] {
  const cycle = Math.floor(time / 45) % OFFICE_ACTION_SCENES.length;
  return [
    ...OFFICE_ACTION_SCENES.slice(cycle),
    ...OFFICE_ACTION_SCENES.slice(0, cycle),
  ];
}

function proposedAssignments(
  scene: OfficeActionScene,
  availableSlots: OfficeActionSlot[],
  unassigned: EmployeeActor[],
): Array<{ actor: EmployeeActor; slot: OfficeActionSlot }> {
  const assignments: Array<{ actor: EmployeeActor; slot: OfficeActionSlot }> = [];
  const assignedSlotIds = new Set<string>();
  for (const actor of unassigned) {
    const slot = availableSlots.find(
      (candidate) =>
        !assignedSlotIds.has(candidate.id) &&
        pointAllowedForViewModel(actor.viewModel, candidate.target),
    );
    if (!slot) {
      continue;
    }
    assignedSlotIds.add(slot.id);
    assignments.push({ actor, slot });
    if (assignments.length >= scene.maxActors) {
      break;
    }
  }
  return assignments;
}

function createAssignment(
  scene: OfficeActionScene,
  slot: OfficeActionSlot,
  actor: EmployeeActor,
  time: number,
): CharacterActionAssignment {
  const duration = scene.durationSeconds + (actor.viewModel.deskIndex % 3) * 2;
  return {
    id: `${scene.id}:${slot.id}`,
    kind: scene.kind,
    slotId: slot.id,
    target: slot.target.clone(),
    location: slot.location,
    posture: slot.posture,
    activity: slot.activity,
    lookAt: slot.lookAt?.clone() ?? null,
    facing: slot.facing ?? null,
    heldProp: slot.heldProp ?? "none",
    startsAt: time,
    endsAt: time + duration,
  };
}
