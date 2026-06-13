import { updatePose, type EmployeeActor } from "./createCharacter";
import {
  isPetFloorViewModel,
  type EmployeeFloorViewModel,
} from "../employeeFloorViewModel";
import type { FloorScene } from "./createScene";
import { behaviorForViewModel } from "./characterBehavior";
import {
  disposeActors as disposeActorLifecycle,
  disposeDesks as disposeDeskLifecycle,
  syncActorLifecycle,
  updateDeskStates,
} from "./actorLifecycle";
import { applyActorRestingVisual, updateActorVisual } from "./actorMovement";
import { createRoomCapacityTargetAssignments } from "./actorRoomCapacity";
import { targetForActor } from "./actorTargets";
import type { ActorMap, ActorUpdateOptions } from "./actorTypes";
import { assignCharacterActions } from "./actions/actionScheduler";
import { updateNameplateScale } from "./characterNameplate";
import { updatePetActorVisual } from "./petCompanionBehavior";

export type { ActorMap, ActorUpdateOptions };

export function syncActors(
  floorScene: FloorScene,
  actors: ActorMap,
  viewModels: EmployeeFloorViewModel[],
  minimumDeskCount = 8,
  nameplateScale = 1,
): void {
  syncActorLifecycle(floorScene, actors, viewModels, minimumDeskCount);
  actors.forEach((actor) => updateNameplateScale(actor, nameplateScale));
}

export function updateActors(
  floorScene: FloorScene,
  actors: ActorMap,
  viewModels: EmployeeFloorViewModel[],
  options: ActorUpdateOptions,
): void {
  updateDeskStates(floorScene, viewModels, options.elapsed, options.reducedMotion);
  assignCharacterActions(actors, viewModels, options.elapsed);

  const activeActors: Array<{ actor: EmployeeActor; viewModel: EmployeeFloorViewModel; index: number }> = [];

  viewModels.forEach((viewModel, index) => {
    const actor = actors.get(viewModel.id);
    if (!actor) return;
    activeActors.push({ actor, viewModel, index });
  });

  const targetAssignments = createRoomCapacityTargetAssignments(activeActors);

  const personActors = activeActors.filter(({ viewModel }) => !isPetFloorViewModel(viewModel));
  const petActors = activeActors.filter(({ viewModel }) => isPetFloorViewModel(viewModel));

  personActors.forEach(({ actor, viewModel }) => {
    if (options.reducedMotion) {
      const behavior = behaviorForViewModel(viewModel);
      const target = targetForActor(actor, behavior, options.elapsed, targetAssignments);
      actor.root.position.x = target.x;
      actor.root.position.z = target.z;
      applyActorRestingVisual(actor, behavior, options.elapsed);
    } else {
      updateActorVisual(actor, viewModel, options.delta, options.elapsed, targetAssignments);
    }
  });

  petActors.forEach(({ actor, viewModel }) => {
    const parent = viewModel.followTargetEmployeeId
      ? actors.get(viewModel.followTargetEmployeeId) ?? null
      : null;
    updatePetActorVisual({
      actor,
      viewModel,
      parent,
      delta: options.delta,
      time: options.elapsed,
      reducedMotion: options.reducedMotion,
    });
  });

  activeActors.forEach(({ actor, index }) => {
    updatePose(actor, options.elapsed, index);
    actor.target.position.x = actor.root.position.x;
    actor.target.position.y = actor.height;
    actor.target.position.z = actor.root.position.z;
    actor.statusRing.scale.setScalar(1 + Math.sin(options.elapsed * 3 + index) * 0.035);
    actor.marker.position.y = 2.62 * actor.height + Math.sin(options.elapsed * 2.2 + index) * 0.035;
    actor.marker.rotation.y = options.elapsed * 1.8;
    actor.selectionRing.scale.setScalar(1 + Math.sin(options.elapsed * 4) * 0.035);
    actor.selectionRing.rotation.z = options.elapsed * 1.3;
  });
}

export function disposeActors(actors: ActorMap): void {
  disposeActorLifecycle(actors);
}

export function disposeDesks(floorScene: FloorScene): void {
  disposeDeskLifecycle(floorScene);
}
