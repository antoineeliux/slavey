import { describe, expect, it } from "vitest";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import {
  OFFICE_ROOM_OCCUPANT_SLOTS,
  OFFICE_VISUAL_CAPACITY,
} from "./layout";
import {
  anchorTargetsForViewModel,
  behaviorForViewModel,
} from "./characterBehavior";
import { walkAreaIdForPoint } from "./navigation";

describe("characterBehavior", () => {
  it("routes office states to the expected activity zones", () => {
    expect(behaviorForViewModel(viewModel({ officeState: "working_at_desk" }))).toMatchObject({
      posture: "sitting",
      location: "desk",
      activity: "typing",
      speed: "work",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "waiting_instruction" }))).toMatchObject({
      posture: "standing",
      location: "executive",
      activity: "waiting_instruction",
      speed: "work",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "waiting_approval" }))).toMatchObject({
      posture: "standing",
      location: "executive",
      activity: "approval",
      speed: "work",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "terminal_waiting_approval" }))).toMatchObject({
      posture: "standing",
      location: "executive",
      activity: "approval",
      speed: "work",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "handoff_ready" }))).toMatchObject({
      posture: "standing",
      location: "executive",
      activity: "handoff",
      speed: "work",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "idle_available" }))).toMatchObject({
      posture: "standing",
      location: "done_room",
      activity: "chilling",
      speed: "social",
    });
    expect(behaviorForViewModel(viewModel({ kind: "standby", officeState: "standby_available" }))).toMatchObject({
      posture: "standing",
      location: "standby",
      activity: "chilling",
      speed: "social",
    });
    expect(behaviorForViewModel(viewModel({ officeState: "on_standby" }))).toMatchObject({
      posture: "sitting",
      location: "standby",
      activity: "chilling",
      speed: "social",
    });
  });

  it("gives owner-attention employees unique executive queue slots", () => {
    for (const officeState of [
      "waiting_instruction",
      "terminal_waiting_approval",
      "waiting_approval",
      "reviewing_changes",
      "handoff_ready",
      "blocked",
    ] satisfies Array<EmployeeFloorViewModel["officeState"]>) {
      const points = Array.from({ length: OFFICE_VISUAL_CAPACITY }, (_, index) =>
        anchorTargetsForViewModel(viewModel({ deskIndex: index, officeState })).executive,
      );
      const spawnPoints = Array.from({ length: OFFICE_VISUAL_CAPACITY }, (_, index) =>
        anchorTargetsForViewModel(viewModel({ deskIndex: index, officeState })).spawn,
      );
      const uniquePoints = new Set(points.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`));

      expect(uniquePoints.size).toBe(OFFICE_VISUAL_CAPACITY);
      expect(points.every((point) => walkAreaIdForPoint(point) === "lounge")).toBe(true);
      expect(spawnPoints.every((point) => walkAreaIdForPoint(point) === "lounge")).toBe(true);
    }
  });

  it("keeps idle employees in the bottom-right room", () => {
    const points = Array.from({ length: 8 }, (_, index) =>
      anchorTargetsForViewModel(viewModel({ deskIndex: index, officeState: "idle_available" })).doneRoom,
    );
    const uniquePoints = new Set(points.map((point) => `${point.x.toFixed(2)}:${point.z.toFixed(2)}`));

    expect(uniquePoints.size).toBe(8);
    expect(points.every((point) => walkAreaIdForPoint(point) === "cafeteria")).toBe(true);
  });

  it("keeps standby characters out of the central workspace", () => {
    const standbyTargets = OFFICE_ROOM_OCCUPANT_SLOTS.map((slot, index) =>
      anchorTargetsForViewModel(
        viewModel({
          id: `standby:${slot.id}`,
          kind: "standby",
          deskIndex: index,
          officeState: "standby_available",
        }),
      ).standby,
    );

    expect(standbyTargets).toHaveLength(OFFICE_VISUAL_CAPACITY);
    expect(standbyTargets.some((point) => walkAreaIdForPoint(point) === "main")).toBe(false);
  });
});

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
