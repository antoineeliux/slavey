import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { EmployeeActor } from "./createCharacter";
import {
  followOffsetForPet,
  followTargetForPet,
  updatePetActorVisual,
} from "./petCompanionBehavior";

describe("petCompanionBehavior", () => {
  it("keeps a natural follow gap around a moving parent", () => {
    const petModel = viewModel({
      id: "pet-1",
      visualKind: "pet",
      companionOfEmployeeId: "owner-1",
      followTargetEmployeeId: "owner-1",
      petVariant: "cat",
      occupiesDesk: false,
      zone: "open_floor",
      worksAtDesk: false,
    });

    const followDistance = followOffsetForPet(petModel).length();

    expect(followDistance).toBeGreaterThanOrEqual(1.15);
  });

  it("moves pets toward a parent-relative follow target", () => {
    const parent = actorFor(viewModel({ id: "owner-1" }), new THREE.Vector3(2, 0, 3));
    const petModel = viewModel({
      id: "pet-1",
      visualKind: "pet",
      companionOfEmployeeId: "owner-1",
      followTargetEmployeeId: "owner-1",
      petVariant: "dog",
      occupiesDesk: false,
      zone: "open_floor",
      worksAtDesk: false,
      pendingApprovals: 1,
      attentionReason: "needs_terminal_approval",
    });
    const petStart = new THREE.Vector3(-2, 0, -1);
    const pet = actorFor(petModel, petStart);
    const target = followTargetForPet(parent, petModel);
    const startingDistance = distanceXZ(pet.root.position, target);

    updatePetActorVisual({
      actor: pet,
      viewModel: petModel,
      parent,
      delta: 0.25,
      time: 10,
      reducedMotion: false,
    });

    expect(distanceXZ(pet.root.position, target)).toBeLessThan(startingDistance);
    expect(distanceXZ(pet.root.position, petStart)).toBeGreaterThan(0);
    expect(pet.visual.location).toBe("office");
    expect(pet.visual.activity).toBe("approval");
    expect(pet.visual.path).toEqual([]);
    expect(pet.visual.pathDestinationKey).toBeNull();
  });

  it("does not route a pet independently when the parent is missing", () => {
    const petModel = viewModel({
      id: "pet-1",
      visualKind: "pet",
      companionOfEmployeeId: "missing-owner",
      followTargetEmployeeId: "missing-owner",
      petVariant: "cat",
      occupiesDesk: false,
      officeState: "waiting_approval",
      zone: "open_floor",
      worksAtDesk: false,
    });
    const petStart = new THREE.Vector3(-2, 0, -1);
    const pet = actorFor(petModel, petStart);

    updatePetActorVisual({
      actor: pet,
      viewModel: petModel,
      parent: null,
      delta: 1,
      time: 10,
      reducedMotion: false,
    });

    expect(pet.root.position.x).toBe(petStart.x);
    expect(pet.root.position.z).toBe(petStart.z);
    expect(pet.visual.location).toBe("office");
    expect(pet.visual.activity).toBe("chilling");
  });

  it("parks a calm pet beside the owner's desk in a sitting posture", () => {
    const parent = actorFor(
      viewModel({
        id: "owner-1",
        deskIndex: 0,
        zone: "desk",
        worksAtDesk: true,
      }),
      new THREE.Vector3(0, 0, 0),
    );
    const petModel = viewModel({
      id: "pet-1",
      visualKind: "pet",
      companionOfEmployeeId: "owner-1",
      followTargetEmployeeId: "owner-1",
      petVariant: "dog",
      occupiesDesk: false,
      zone: "open_floor",
      worksAtDesk: false,
    });
    const target = followTargetForPet(parent, petModel);
    const pet = actorFor(petModel, target.clone());

    updatePetActorVisual({
      actor: pet,
      viewModel: petModel,
      parent,
      delta: 0.25,
      time: 12,
      reducedMotion: false,
    });

    expect(pet.visual.posture).toBe("sitting");
    expect(pet.visual.activity).toBe("chilling");
    expect(distanceXZ(target, parent.root.position)).toBeGreaterThan(1.8);
  });

  it("keeps an approval-needing pet seated beside a desk instead of jumping", () => {
    const parent = actorFor(
      viewModel({
        id: "owner-1",
        deskIndex: 0,
        zone: "desk",
        worksAtDesk: true,
      }),
      new THREE.Vector3(0, 0, 0),
    );
    const petModel = viewModel({
      id: "pet-approval",
      visualKind: "pet",
      companionOfEmployeeId: "owner-1",
      followTargetEmployeeId: "owner-1",
      petVariant: "dog",
      occupiesDesk: false,
      zone: "open_floor",
      worksAtDesk: false,
      pendingApprovals: 1,
      attentionReason: "needs_terminal_approval",
    });
    const target = followTargetForPet(parent, petModel);
    const pet = actorFor(petModel, target.clone());

    updatePetActorVisual({
      actor: pet,
      viewModel: petModel,
      parent,
      delta: 0.25,
      time: 12,
      reducedMotion: false,
    });

    expect(pet.visual.posture).toBe("sitting");
    expect(pet.visual.activity).toBe("approval");
  });
});

function actorFor(
  viewModel: EmployeeFloorViewModel,
  position: THREE.Vector3,
): EmployeeActor {
  const root = new THREE.Group();
  root.position.copy(position);
  return {
    id: viewModel.id,
    root,
    viewModel,
    visual: {
      action: null,
      activity: "none",
      heldProp: "none",
      location: "office",
      path: [new THREE.Vector3(100, 0, 100)],
      pathDestinationKey: "desk:100.00:100.00",
      posture: "standing",
    },
  } as unknown as EmployeeActor;
}

function viewModel(overrides: Partial<EmployeeFloorViewModel> = {}): EmployeeFloorViewModel {
  return {
    id: "emp-1",
    kind: "employee",
    visualKind: "person",
    companionOfEmployeeId: null,
    petVariant: null,
    occupiesDesk: true,
    followTargetEmployeeId: null,
    name: "Employee",
    role: "general",
    employeeStatus: "running",
    selected: false,
    deskIndex: 0,
    standbySlotId: null,
    standbyRoom: null,
    sourceState: "codex_running",
    officeState: "working_at_desk",
    visualState: "desk_working",
    zone: "desk",
    label: "Working",
    detail: "Working",
    stationTitle: "Employee",
    cwd: "/workspace",
    worktreePath: null,
    branchName: null,
    currentCommand: null,
    terminalSessionId: null,
    markerColor: "#a7c080",
    muted: false,
    worksAtDesk: true,
    pendingApprovals: 0,
    runningActions: 0,
    runningProcesses: 0,
    changedFiles: 0,
    hasHandoffReady: false,
    hasReviewNeeded: false,
    attentionReason: null,
    behavior: null,
    workPhase: null,
    turnOwner: null,
    terminalState: null,
    activityReason: null,
    blockers: [],
    ...overrides,
  };
}

function distanceXZ(first: THREE.Vector3, second: THREE.Vector3): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}
