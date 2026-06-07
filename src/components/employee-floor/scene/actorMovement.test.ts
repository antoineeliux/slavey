import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { EmployeeActor } from "./createCharacter";
import type { CharacterBehavior, CharacterLocation, CharacterPosture } from "./characterBehavior";
import { spawnPointForActorMount } from "./actorLifecycle";
import { recoverStuckActor } from "./actorMovement";
import {
  createRoomCapacityTargetAssignments,
  ROOM_CAPACITY_LIMITS,
} from "./actorRoomCapacity";
import { targetForActor } from "./actorTargets";
import {
  DONE_ROOM_POINTS,
  EMPLOYEE_ENTRY_POINT,
  OFFICE_WANDER_POINTS,
  STANDBY_WANDER_POINTS,
  deskAnchorForIndex,
} from "./layout";
import {
  pointIsFurnitureBlocked,
  walkAreaIdForPoint,
} from "./navigation";

describe("actor movement helpers", () => {
  it("stuck recovery clears the path and nudges to a walkable position", () => {
    const source = new THREE.Vector3(-8.25, 0, 5.55);
    const destination = new THREE.Vector3(-5.2, 0, 8);
    const actor = actorAt({ deskIndex: 2, position: source });
    actor.visual.path = [destination.clone()];
    actor.visual.pathDestinationKey = "executive:-5.20:8.00";

    recoverStuckActor(actor, destination, 12);

    expect(actor.visual.path).toEqual([]);
    expect(actor.visual.pathDestinationKey).toBeNull();
    expect(actor.visual.lastMovedAt).toBe(12);
    expect(actor.visual.lastPosition.distanceTo(actor.root.position)).toBeLessThan(0.001);
    expect(walkAreaIdForPoint(actor.root.position)).not.toBeNull();
    expect(pointIsFurnitureBlocked(actor.root.position)).toBe(false);
  });

  it("keeps standby, done-room, and social targets in their expected zones", () => {
    const standby = actorAt({
      deskIndex: 0,
      position: STANDBY_WANDER_POINTS[0].clone(),
      standbyTarget: STANDBY_WANDER_POINTS[0].clone(),
    });
    const doneRoom = actorAt({
      deskIndex: 0,
      position: DONE_ROOM_POINTS[0].clone(),
      doneRoomTarget: DONE_ROOM_POINTS[0].clone(),
    });
    const office = actorAt({
      deskIndex: 0,
      position: OFFICE_WANDER_POINTS[0].clone(),
      officeTarget: OFFICE_WANDER_POINTS[0].clone(),
    });

    const standbyArea = walkAreaIdForPoint(targetForActor(standby, behavior("standby"), 10));
    expect(Boolean(standbyArea && standbyAreas().has(standbyArea))).toBe(true);
    expect(walkAreaIdForPoint(targetForActor(doneRoom, behavior("done_room"), 10))).toBe(
      "cafeteria",
    );
    const officeArea = walkAreaIdForPoint(targetForActor(office, behavior("office"), 10));
    expect(Boolean(officeArea && officeAreas().has(officeArea))).toBe(true);
  });

  it("spawns newly mounted actors at the entry point so they walk to their destination", () => {
    const model = viewModelForDesk(0, { officeState: "working_at_desk" });

    expect(spawnPointForActorMount(model, true).distanceTo(deskAnchorForIndex(0).desk)).toBeLessThan(0.001);
    expect(spawnPointForActorMount(model, false).distanceTo(EMPLOYEE_ENTRY_POINT)).toBeLessThan(0.001);
    expect(walkAreaIdForPoint(spawnPointForActorMount(model, false))).toBe("front_hall");
  });

  it("caps done-room occupancy and redirects overflow actors outside the main workspace", () => {
    const actors = Array.from({ length: ROOM_CAPACITY_LIMITS.done_room + 2 }, (_, deskIndex) =>
      actorAt({
        deskIndex,
        position: DONE_ROOM_POINTS[0].clone(),
        location: "done_room",
      }),
    );
    const assignments = createRoomCapacityTargetAssignments(
      actors.map((actor) => ({
        actor,
        viewModel: viewModelForDesk(actor.viewModel.deskIndex, {
          officeState: "idle_available",
        }),
      })),
    );

    expect(assignments.size).toBe(actors.length);
    expect(new Set([...assignments.values()].map((target) => `${target.x}:${target.z}`)).size).toBe(
      actors.length,
    );
    for (const actor of actors) {
      const target = assignments.get(actor.id);
      expect(target).toBeDefined();
      expect(walkAreaIdForPoint(target ?? new THREE.Vector3())).not.toBe("main");
      expect(walkAreaIdForPoint(target ?? new THREE.Vector3())).not.toBe("lounge");
      expect(pointIsFurnitureBlocked(target ?? new THREE.Vector3())).toBe(false);
    }
  });
});

function actorAt({
  deskIndex,
  position,
  posture = "standing",
  location = "office",
  officeTarget = new THREE.Vector3(),
  standbyTarget = new THREE.Vector3(),
  doneRoomTarget = new THREE.Vector3(),
}: {
  deskIndex: number;
  position: THREE.Vector3;
  posture?: CharacterPosture;
  location?: CharacterLocation;
  officeTarget?: THREE.Vector3;
  standbyTarget?: THREE.Vector3;
  doneRoomTarget?: THREE.Vector3;
}): EmployeeActor {
  const root = new THREE.Group();
  root.position.copy(position);
  return {
    id: `actor-${deskIndex}`,
    root,
    viewModel: {
      id: `actor-${deskIndex}`,
      deskIndex,
      officeState: location === "desk" ? "working_at_desk" : "standby_available",
      worksAtDesk: location === "desk",
    } as EmployeeFloorViewModel,
    homeRotationY: Math.PI,
    visual: {
      posture,
      location,
      activity: "none",
      desk: deskAnchorForIndex(deskIndex).desk,
      cafeteria: new THREE.Vector3(),
      standby: STANDBY_WANDER_POINTS[deskIndex % STANDBY_WANDER_POINTS.length].clone(),
      executive: new THREE.Vector3(-5.2, 0, 8),
      doneRoom: DONE_ROOM_POINTS[deskIndex % DONE_ROOM_POINTS.length].clone(),
      officeA: OFFICE_WANDER_POINTS[deskIndex % OFFICE_WANDER_POINTS.length].clone(),
      officeB: OFFICE_WANDER_POINTS[(deskIndex + 3) % OFFICE_WANDER_POINTS.length].clone(),
      officeTarget,
      cafeteriaTarget: new THREE.Vector3(),
      standbyTarget,
      doneRoomTarget,
      roamIndex: 0,
      talkUntil: 0,
      socialIntent: "roaming",
      socialLookAt: null,
      path: [],
      pathDestinationKey: null,
      lastPosition: position.clone(),
      lastMovedAt: 0,
      repathAt: 0,
      stuckCount: 0,
    },
  } as unknown as EmployeeActor;
}

function viewModelForDesk(
  deskIndex: number,
  overrides: Partial<EmployeeFloorViewModel> = {},
): EmployeeFloorViewModel {
  return {
    id: `actor-${deskIndex}`,
    kind: "employee",
    name: `Actor ${deskIndex}`,
    role: "general",
    employeeStatus: "idle",
    selected: false,
    deskIndex,
    standbySlotId: null,
    standbyRoom: null,
    sourceState: "idle",
    officeState: "idle_available",
    visualState: "social_idle",
    zone: "done_room",
    label: "Idle",
    detail: "Idle",
    stationTitle: "Idle",
    cwd: "/workspace",
    worktreePath: null,
    branchName: null,
    currentCommand: null,
    terminalSessionId: null,
    markerColor: "#8fb9a8",
    muted: false,
    worksAtDesk: false,
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

function behavior(location: CharacterLocation): CharacterBehavior {
  const social =
    location === "office" ||
    location === "cafeteria" ||
    location === "standby" ||
    location === "done_room";
  return {
    posture: location === "desk" ? "sitting" : "standing",
    location,
    activity: location === "done_room" ? "handoff" : "chilling",
    speed: social ? "social" : "work",
    social,
  };
}

function standbyAreas(): Set<NonNullable<ReturnType<typeof walkAreaIdForPoint>>> {
  return new Set(
    STANDBY_WANDER_POINTS.map((point) => walkAreaIdForPoint(point)).filter(
      (areaId): areaId is NonNullable<ReturnType<typeof walkAreaIdForPoint>> =>
        areaId !== null,
    ),
  );
}

function officeAreas(): Set<NonNullable<ReturnType<typeof walkAreaIdForPoint>>> {
  return new Set(
    OFFICE_WANDER_POINTS.map((point) => walkAreaIdForPoint(point)).filter(
      (areaId): areaId is NonNullable<ReturnType<typeof walkAreaIdForPoint>> =>
        areaId !== null,
    ),
  );
}
