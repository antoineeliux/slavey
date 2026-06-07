import { describe, expect, it } from "vitest";

import type { Employee } from "../../types";
import type {
  EmployeeActivityPresentation,
  EmployeeVisualState,
} from "../employee-scene/activityPresentation";
import {
  createEmployeeFloorViewModel,
  createEmployeeFloorViewModels,
  floorVisualStateForPresentationState,
  type EmployeeFloorVisualState,
  type EmployeeFloorZone,
} from "./employeeFloorViewModel";

describe("employeeFloorViewModel", () => {
  it("maps presentation states to floor visual states", () => {
    const cases: Array<[EmployeeVisualState, EmployeeFloorVisualState]> = [
      ["idle", "social_idle"],
      ["standby", "social_idle"],
      ["stopped", "offline_stopped"],
      ["shell_running", "desk_terminal"],
      ["codex_starting", "desk_terminal"],
      ["codex_running", "desk_working"],
      ["codex_waiting_instruction", "desk_waiting_instruction"],
      ["codex_waiting_approval", "desk_waiting_approval"],
      ["action_running", "desk_working"],
      ["process_running", "desk_terminal"],
      ["waiting_approval", "desk_waiting_approval"],
      ["review_needed", "desk_review"],
      ["handoff_ready", "social_handoff_ready"],
      ["done_clean", "social_handoff_ready"],
      ["blocked", "desk_blocked"],
    ];

    for (const [presentationState, visualState] of cases) {
      expect(floorVisualStateForPresentationState(presentationState)).toBe(visualState);
      expect(
        createEmployeeFloorViewModel({
          employee: employee({ id: presentationState }),
          presentation: presentation(presentationState),
          selected: false,
          deskIndex: 0,
        }).visualState,
      ).toBe(visualState);
    }
  });

  it("keeps active work at desks and routes waiting or inactive employees to rooms", () => {
    const cases: Array<[EmployeeVisualState, EmployeeFloorZone, boolean, string]> = [
      ["idle", "done_room", false, "idle_available"],
      ["standby", "standby", false, "on_standby"],
      ["stopped", "offline", false, "offline"],
      ["shell_running", "desk", true, "running_terminal"],
      ["codex_starting", "desk", false, "running_terminal"],
      ["codex_running", "desk", true, "working_at_desk"],
      ["codex_waiting_instruction", "executive_office", false, "waiting_instruction"],
      ["codex_waiting_approval", "executive_office", false, "terminal_waiting_approval"],
      ["action_running", "desk", true, "working_at_desk"],
      ["process_running", "desk", true, "running_terminal"],
      ["waiting_approval", "executive_office", false, "waiting_approval"],
      ["review_needed", "executive_office", false, "reviewing_changes"],
      ["handoff_ready", "executive_office", false, "handoff_ready"],
      ["done_clean", "executive_office", false, "handoff_ready"],
      ["blocked", "executive_office", false, "blocked"],
    ];

    for (const [state, zone, worksAtDesk, officeState] of cases) {
      const model = createEmployeeFloorViewModel({
        employee: employee({ id: state }),
        presentation: presentation(state),
        selected: false,
        deskIndex: 2,
      });

      expect(model.zone).toBe(zone);
      expect(model.worksAtDesk).toBe(worksAtDesk);
      expect(model.officeState).toBe(officeState);
    }
  });

  it("lets structured owner-wait behavior override the legacy source state for routing", () => {
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-owner-wait" }),
      presentation: presentation("action_running", {
        behavior: "waiting_at_owner",
        attentionRequired: true,
        attentionReason: "needs_terminal_approval",
        terminalState: "codex_waiting_approval",
      }),
      selected: false,
      deskIndex: 1,
    });

    expect(model.officeState).toBe("terminal_waiting_approval");
    expect(model.visualState).toBe("desk_waiting_approval");
    expect(model.zone).toBe("executive_office");
    expect(model.worksAtDesk).toBe(false);
  });

  it("lets structured terminal behavior override action-running desk work routing", () => {
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-terminal-work" }),
      presentation: presentation("action_running", {
        behavior: "at_desk_terminal",
        workPhase: "tool_running",
        turnOwner: "tool",
        terminalState: "codex_running",
      }),
      selected: false,
      deskIndex: 1,
    });

    expect(model.officeState).toBe("running_terminal");
    expect(model.visualState).toBe("desk_terminal");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
  });

  it("preserves employee identity, selection, desk order, and presentation signals", () => {
    const models = createEmployeeFloorViewModels(
      [
        {
          employee: employee({ id: "emp-1", name: "Mira", role: "frontend" }),
          presentation: presentation("review_needed", {
            changedFiles: 4,
            hasReviewNeeded: true,
          }),
        },
        {
          employee: employee({ id: "emp-2", name: "Noah", role: "reviewer" }),
          presentation: presentation("waiting_approval", {
            pendingApprovals: 2,
            blockers: ["needs approval"],
          }),
        },
      ],
      "emp-2",
    );

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: "emp-1",
      kind: "employee",
      name: "Mira",
      role: "frontend",
      employeeStatus: "running",
      selected: false,
      deskIndex: 0,
      officeState: "reviewing_changes",
      visualState: "desk_review",
      zone: "executive_office",
      changedFiles: 4,
      hasReviewNeeded: true,
    });
    expect(models[1]).toMatchObject({
      id: "emp-2",
      selected: true,
      deskIndex: 1,
      officeState: "waiting_approval",
      visualState: "desk_waiting_approval",
      zone: "executive_office",
      pendingApprovals: 2,
      blockers: ["needs approval"],
    });
  });

  it("fills the office with unnamed standby character slots when requested", () => {
    const models = createEmployeeFloorViewModels(
      [
        {
          employee: employee({ id: "emp-1", name: "Mira", role: "frontend" }),
          presentation: presentation("idle"),
        },
        {
          employee: employee({ id: "emp-2", name: "Noah", role: "reviewer" }),
          presentation: presentation("codex_running"),
        },
      ],
      null,
      { includeStandby: true },
    );

    expect(models).toHaveLength(10);
    expect(models.filter((model) => model.kind === "employee")).toHaveLength(2);
    expect(models.filter((model) => model.kind === "standby")).toHaveLength(8);
    expect(models[2]).toMatchObject({
      kind: "standby",
      name: "",
      officeState: "standby_available",
      zone: "standby",
      worksAtDesk: false,
    });
  });
});

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

function presentation(
  state: EmployeeVisualState,
  overrides: Partial<EmployeeActivityPresentation> = {},
): EmployeeActivityPresentation {
  return {
    state,
    label: state.replaceAll("_", " "),
    detail: "Activity detail",
    stationTitle: "Station title",
    pendingApprovals: 0,
    runningActions: 0,
    runningProcesses: 0,
    changedFiles: 0,
    hasHandoffReady: state === "handoff_ready",
    hasReviewNeeded: state === "review_needed",
    attentionRequired: false,
    attentionReason: null,
    behavior: null,
    workPhase: null,
    turnOwner: null,
    terminalState: null,
    activityReason: null,
    agentKind: null,
    agentState: null,
    blockers: [],
    ...overrides,
  };
}
