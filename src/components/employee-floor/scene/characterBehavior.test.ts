import { describe, expect, it } from "vitest";

import type { Employee, EmployeeActivity } from "../../../types";
import { presentEmployeeActivity } from "../../employee-scene/activityPresentation";
import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import { createEmployeeFloorViewModel } from "../employeeFloorViewModel";
import {
  OFFICE_ROOM_OCCUPANT_SLOTS,
  OFFICE_VISUAL_CAPACITY,
  deskAnchorForIndex,
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

  it("turns desk Codex work contracts into sitting desk typing behavior", () => {
    const deskIndex = 3;
    const model = modelFromActivity({
      deskIndex,
      activity: employeeActivity("codex_running", {
        contract: activityContract({
          placement: "desk",
          renderActivity: "working",
          workKind: "codex",
          workPhase: "working",
          turnOwner: "agent",
          sourceRuntime: "codex_app_server",
          sourceConfidence: "structured",
        }),
      }),
    });
    const behavior = behaviorForViewModel(model);
    const targets = anchorTargetsForViewModel(model);
    const deskAnchor = deskAnchorForIndex(deskIndex);

    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
    expect(behavior).toMatchObject({
      posture: "sitting",
      location: "desk",
      activity: "typing",
      social: false,
    });
    expect(targets.desk.equals(deskAnchor.desk)).toBe(true);
    expect(targets.spawn.equals(deskAnchor.desk)).toBe(true);
  });

  it("turns done-room shell contracts into standing social done-room behavior", () => {
    const deskIndex = 4;
    const model = modelFromActivity({
      deskIndex,
      activity: employeeActivity("shell_running", {
        behavior: "at_desk_terminal",
        terminalState: "shell_running",
        contract: activityContract({
          placement: "done_room",
          renderActivity: "terminal",
          workKind: "shell",
          workPhase: "idle",
          turnOwner: "none",
        }),
      }),
    });
    const behavior = behaviorForViewModel(model);
    const targets = anchorTargetsForViewModel(model);
    const deskAnchor = deskAnchorForIndex(deskIndex);

    expect(model.zone).toBe("done_room");
    expect(model.worksAtDesk).toBe(false);
    expect(behavior).toMatchObject({
      posture: "standing",
      location: "done_room",
      social: true,
    });
    expect(behavior.posture).not.toBe("sitting");
    expect(behavior.location).not.toBe("desk");
    expect(targets.spawn.equals(targets.doneRoom)).toBe(true);
    expect(targets.spawn.equals(deskAnchor.desk)).toBe(false);
  });
});

function modelFromActivity({
  deskIndex,
  activity,
}: {
  deskIndex: number;
  activity: EmployeeActivity;
}): EmployeeFloorViewModel {
  const nextEmployee = employee({
    id: activity.employeeId,
    terminalSessionId: activity.activeTerminalSessionId ?? null,
  });
  const presentation = presentEmployeeActivity({
    employee: nextEmployee,
    activity,
    terminalSessions: [],
    approvals: [],
    actions: [],
    processes: [],
    review: null,
    handoff: null,
  });
  return createEmployeeFloorViewModel({
    employee: nextEmployee,
    presentation,
    selected: false,
    deskIndex,
  });
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    name: "Ada",
    role: "general",
    status: "running",
    cwd: "/workspace",
    worktreePath: null,
    branchName: null,
    terminalSessionId: null,
    currentCommand: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function employeeActivity(
  status: EmployeeActivity["status"],
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
  return {
    employeeId: "emp-1",
    status,
    contract: activityContract({
      placement: "done_room",
      renderActivity: "idle",
      workKind: "none",
      workPhase: "idle",
      turnOwner: "none",
    }),
    label: status.replaceAll("_", " "),
    details: null,
    lastActivityAt: 1,
    activeTerminalSessionId: null,
    activeActionId: null,
    activeProcessIds: [],
    reviewCounts: {
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
    },
    blockers: [],
    ...overrides,
  };
}

function activityContract({
  placement,
  renderActivity,
  workKind,
  workPhase,
  turnOwner,
  sourceRuntime = "pty",
  sourceConfidence = "structured",
}: {
  placement: EmployeeActivity["contract"]["render"]["placement"];
  renderActivity: EmployeeActivity["contract"]["render"]["activity"];
  workKind: EmployeeActivity["contract"]["work"]["kind"];
  workPhase: EmployeeActivity["contract"]["work"]["phase"];
  turnOwner: EmployeeActivity["contract"]["work"]["turnOwner"];
  sourceRuntime?: EmployeeActivity["contract"]["source"]["runtime"];
  sourceConfidence?: EmployeeActivity["contract"]["source"]["confidence"];
}): EmployeeActivity["contract"] {
  return {
    lifecycle: placement === "offline" ? "stopped" : "active",
    work: {
      kind: workKind,
      phase: workPhase,
      turnOwner,
    },
    render: {
      placement,
      posture: placement === "desk" ? "sitting" : "standing",
      activity: renderActivity,
    },
    attention: {
      required: false,
      reason: null,
      priority: "none",
    },
    source: {
      runtime: sourceRuntime,
      confidence: sourceConfidence,
    },
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
