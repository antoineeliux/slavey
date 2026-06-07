import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { EmployeeFloorViewModel } from "../../employeeFloorViewModel";
import type { EmployeeActor } from "../createCharacter";
import type { CharacterBehavior, CharacterLocation } from "../characterBehavior";
import type { ActorMap } from "../actorTypes";
import { targetForActor } from "../actorTargets";
import {
  pointIsFurnitureBlocked,
  walkAreaIdForPoint,
} from "../navigation";
import { assignCharacterActions } from "./actionScheduler";
import { applyActionVisual } from "./actionTargets";
import { OFFICE_ACTION_SCENES } from "./officeActionManifest";

describe("actionScheduler", () => {
  it("assigns unique ambient actions outside the central workspace", () => {
    const viewModels = Array.from({ length: 10 }, (_, index) =>
      viewModel({
        id: `standby-${index}`,
        kind: "standby",
        deskIndex: index,
        officeState: "standby_available",
      }),
    );
    const actors = actorMapFor(viewModels);

    assignCharacterActions(actors, viewModels, 0);

    const actions = Array.from(actors.values()).map((actor) => actor.visual.action);
    const slotIds = actions.map((action) => action?.slotId);
    expect(actions.every(Boolean)).toBe(true);
    expect(new Set(slotIds).size).toBe(slotIds.length);
    expect(new Set(actions.map((action) => action?.kind))).toEqual(
      new Set(["conversation", "cafeteria_stool", "meeting_presentation", "rest_phone"]),
    );
    actions.forEach((action) => {
      expect(action).not.toBeNull();
      if (!action) return;
      expect(walkAreaIdForPoint(action.target)).not.toBeNull();
      expect(walkAreaIdForPoint(action.target)).not.toBe("main");
      expect(walkAreaIdForPoint(action.target)).not.toBe("lounge");
      expect(pointIsFurnitureBlocked(action.target)).toBe(false);
    });
  });

  it("does not assign ambient actions to active desk workers", () => {
    const viewModels = [
      viewModel({ id: "worker", officeState: "working_at_desk", deskIndex: 0 }),
      viewModel({
        id: "standby",
        kind: "standby",
        officeState: "standby_available",
        deskIndex: 1,
      }),
    ];
    const actors = actorMapFor(viewModels);

    assignCharacterActions(actors, viewModels, 0);

    expect(actors.get("worker")?.visual.action).toBeNull();
    expect(actors.get("standby")?.visual.action?.kind).toBe("cafeteria_stool");
  });

  it("keeps assignments stable until their duration expires", () => {
    const viewModels = Array.from({ length: 3 }, (_, index) =>
      viewModel({
        id: `standby-${index}`,
        kind: "standby",
        deskIndex: index,
        officeState: "standby_available",
      }),
    );
    const actors = actorMapFor(viewModels);

    assignCharacterActions(actors, viewModels, 0);
    const firstAssignments = Array.from(actors.values()).map((actor) => actor.visual.action?.id);

    assignCharacterActions(actors, viewModels, 5);

    expect(Array.from(actors.values()).map((actor) => actor.visual.action?.id)).toEqual(
      firstAssignments,
    );
  });

  it("feeds assigned action targets and render state into movement", () => {
    const viewModels = [
      viewModel({
        id: "standby",
        kind: "standby",
        deskIndex: 0,
        officeState: "standby_available",
      }),
    ];
    const actors = actorMapFor(viewModels);
    const actor = actors.get("standby");
    if (!actor) throw new Error("missing actor");

    assignCharacterActions(actors, viewModels, 0);

    const action = actor.visual.action;
    expect(action).not.toBeNull();
    if (!action) return;
    expect(targetForActor(actor, behavior("standby"), 0).distanceTo(action.target)).toBeLessThan(0.01);

    applyActionVisual(actor);

    expect(actor.visual.location).toBe(action.location);
    expect(actor.visual.posture).toBe(action.posture);
    expect(actor.visual.activity).toBe(action.activity);
    expect(actor.visual.heldProp).toBe(action.heldProp);
  });

  it("keeps seated ambient action targets aligned with visible furniture", () => {
    const seatedTargets = OFFICE_ACTION_SCENES.flatMap((scene) =>
      scene.slots
        .filter((slot) => slot.posture === "sitting")
        .map((slot) => [slot.id, slot.target] as const),
    );
    const targetById = new Map(seatedTargets);

    expect(targetById.get("cafeteria-stool-a")?.distanceTo(new THREE.Vector3(5.35, 0, 6.18))).toBeLessThan(0.01);
    expect(targetById.get("cafeteria-stool-b")?.distanceTo(new THREE.Vector3(6.45, 0, 6.18))).toBeLessThan(0.01);
    expect(targetById.get("entertainment-phone-a")?.distanceTo(new THREE.Vector3(-15.55, 0, 2.04))).toBeLessThan(0.01);
    expect(targetById.get("entertainment-phone-b")?.distanceTo(new THREE.Vector3(-14.85, 0, 2.04))).toBeLessThan(0.01);
    for (const [, target] of seatedTargets) {
      expect(walkAreaIdForPoint(target)).not.toBeNull();
      expect(pointIsFurnitureBlocked(target)).toBe(false);
    }
  });
});

function actorMapFor(viewModels: EmployeeFloorViewModel[]): ActorMap {
  return new Map(viewModels.map((model) => [model.id, actorFor(model)]));
}

function actorFor(viewModel: EmployeeFloorViewModel): EmployeeActor {
  const root = new THREE.Group();
  return {
    id: viewModel.id,
    root,
    viewModel,
    visual: {
      action: null,
      activity: "none",
      heldProp: "none",
      location: "standby",
      posture: "standing",
    },
  } as unknown as EmployeeActor;
}

function behavior(location: CharacterLocation): CharacterBehavior {
  const social =
    location === "office" ||
    location === "cafeteria" ||
    location === "standby" ||
    location === "done_room";
  return {
    posture: location === "desk" ? "sitting" : "standing",
    location,
    activity: "chilling",
    speed: social ? "social" : "work",
    social,
  };
}

function viewModel(overrides: Partial<EmployeeFloorViewModel> = {}): EmployeeFloorViewModel {
  return {
    id: "emp-1",
    kind: "employee",
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
