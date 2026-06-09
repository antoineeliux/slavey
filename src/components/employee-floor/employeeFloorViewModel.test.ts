import { describe, expect, it } from "vitest";

import { resolveEmployeeActivityContractView } from "../../lib/employeeActivityContractView";
import type { Employee, EmployeeActivity, TerminalSessionRecord } from "../../types";
import {
  presentEmployeeActivity,
  type EmployeeActivityPresentation,
  type EmployeeVisualState,
} from "../employee-scene/activityPresentation";
import {
  createEmployeeFloorViewModel,
  createEmployeeFloorViewModels,
  floorVisualStateForPresentationState,
  type EmployeeOfficeState,
  type EmployeeFloorPetVariant,
  type EmployeeFloorVisualState,
  type EmployeeFloorZone,
} from "./employeeFloorViewModel";

describe("employeeFloorViewModel", () => {
  it("maps presentation states to floor visual states", () => {
    const cases: Array<[EmployeeVisualState, EmployeeFloorVisualState]> = [
      ["idle", "social_idle"],
      ["standby", "social_idle"],
      ["stopped", "offline_stopped"],
      ["shell_running", "social_idle"],
      ["codex_starting", "social_idle"],
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
      ["shell_running", "done_room", false, "idle_available"],
      ["codex_starting", "done_room", false, "idle_available"],
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

  it("keeps backend activity, terminal state, and floor routing contracts aligned", () => {
    const cases: Array<{
      name: string;
      activity: Partial<EmployeeActivity>;
      terminal?: Partial<TerminalSessionRecord>;
      expected: {
        state: EmployeeVisualState;
        behavior: EmployeeActivityPresentation["behavior"];
        turnOwner: EmployeeActivityPresentation["turnOwner"];
        terminalState: EmployeeActivityPresentation["terminalState"];
        officeState: EmployeeOfficeState;
        zone: EmployeeFloorZone;
        worksAtDesk: boolean;
      };
    }> = [
      {
        name: "codex_starting_is_not_desk_work",
        activity: codexActivity({
          status: "codex_starting",
          behavior: "at_desk_terminal",
          terminalState: "codex_starting",
          agentState: "starting",
          workPhase: "agent_starting",
          turnOwner: "none",
        }),
        terminal: { profile: "codex", activeProfile: "codex", turnState: "codex_starting" },
        expected: {
          state: "codex_starting",
          behavior: "at_desk_terminal",
          turnOwner: "none",
          terminalState: "codex_starting",
          officeState: "idle_available",
          zone: "done_room",
          worksAtDesk: false,
        },
      },
      {
        name: "contract_starting_activity_beats_active_terminal_turn",
        activity: codexActivity({
          status: "codex_starting",
          behavior: "at_desk_terminal",
          terminalState: "codex_starting",
          agentState: "starting",
          workPhase: "agent_starting",
          turnOwner: "none",
        }),
        terminal: { profile: "codex", activeProfile: "codex", turnState: "agent_working" },
        expected: {
          state: "codex_starting",
          behavior: "at_desk_terminal",
          turnOwner: "none",
          terminalState: "codex_starting",
          officeState: "idle_available",
          zone: "done_room",
          worksAtDesk: false,
        },
      },
      {
        name: "contract_owner_instruction_beats_active_terminal_turn",
        activity: codexActivity({
          status: "codex_waiting_instruction",
          behavior: "waiting_at_owner",
          terminalState: "codex_waiting_instruction",
          agentState: "waiting_prompt",
          workPhase: "waiting_for_owner",
          turnOwner: "owner",
          attentionReason: "needs_instruction",
        }),
        terminal: {
          profile: "codex",
          activeProfile: "codex",
          turnState: "agent_working",
          lastPromptSubmittedAt: 100,
          lastPromptReadyAt: 200,
        },
        expected: {
          state: "codex_waiting_instruction",
          behavior: "waiting_at_owner",
          turnOwner: "owner",
          terminalState: "codex_waiting_instruction",
          officeState: "waiting_instruction",
          zone: "executive_office",
          worksAtDesk: false,
        },
      },
      {
        name: "submitted_codex_turn_works_at_desk",
        activity: codexActivity({
          status: "codex_running",
          behavior: "at_desk_working",
          terminalState: "codex_running",
          agentState: "thinking",
          workPhase: "agent_working",
          turnOwner: "agent",
        }),
        terminal: { profile: "codex", activeProfile: "codex", turnState: "prompt_submitted" },
        expected: {
          state: "codex_running",
          behavior: "at_desk_working",
          turnOwner: "agent",
          terminalState: "codex_running",
          officeState: "working_at_desk",
          zone: "desk",
          worksAtDesk: true,
        },
      },
      {
        name: "owner_prompt_ready_routes_to_owner",
        activity: codexActivity({
          status: "codex_waiting_instruction",
          behavior: "waiting_at_owner",
          terminalState: "codex_waiting_instruction",
          agentState: "waiting_prompt",
          workPhase: "waiting_for_owner",
          turnOwner: "owner",
          attentionReason: "needs_instruction",
        }),
        terminal: {
          profile: "codex",
          activeProfile: "codex",
          turnState: "owner_composing",
          lastPromptSubmittedAt: 100,
          lastPromptReadyAt: 200,
        },
        expected: {
          state: "codex_waiting_instruction",
          behavior: "waiting_at_owner",
          turnOwner: "owner",
          terminalState: "codex_waiting_instruction",
          officeState: "waiting_instruction",
          zone: "executive_office",
          worksAtDesk: false,
        },
      },
      {
        name: "terminal_approval_routes_to_owner",
        activity: codexActivity({
          status: "codex_waiting_approval",
          behavior: "waiting_at_owner",
          terminalState: "codex_waiting_approval",
          agentState: "waiting_approval",
          workPhase: "waiting_for_owner",
          turnOwner: "owner",
          attentionReason: "needs_terminal_approval",
        }),
        terminal: {
          profile: "codex",
          activeProfile: "codex",
          turnState: "waiting_approval",
          lastPromptSubmittedAt: 100,
          lastApprovalPromptAt: 200,
        },
        expected: {
          state: "codex_waiting_approval",
          behavior: "waiting_at_owner",
          turnOwner: "owner",
          terminalState: "codex_waiting_approval",
          officeState: "terminal_waiting_approval",
          zone: "executive_office",
          worksAtDesk: false,
        },
      },
      {
        name: "active_codex_turn_does_not_override_app_approval",
        activity: {
          status: "action_pending_approval",
          behavior: "waiting_at_owner",
          terminalState: "codex_running",
          work: { phase: "waiting_for_owner", turnOwner: "owner" },
          attention: {
            required: true,
            reason: "needs_app_approval",
            priority: "normal",
          },
        },
        terminal: { profile: "codex", activeProfile: "codex", turnState: "agent_working" },
        expected: {
          state: "waiting_approval",
          behavior: "waiting_at_owner",
          turnOwner: "owner",
          terminalState: "codex_running",
          officeState: "waiting_approval",
          zone: "executive_office",
          worksAtDesk: false,
        },
      },
      {
        name: "shell_open_is_not_desk_work",
        activity: {
          status: "shell_running",
          behavior: "at_desk_terminal",
          terminalState: "shell_running",
          work: { phase: "shell_open", turnOwner: "none" },
        },
        terminal: { profile: "shell", activeProfile: "shell", turnState: "shell" },
        expected: {
          state: "shell_running",
          behavior: "at_desk_terminal",
          turnOwner: "none",
          terminalState: "shell_running",
          officeState: "idle_available",
          zone: "done_room",
          worksAtDesk: false,
        },
      },
    ];

    for (const testCase of cases) {
      const nextEmployee = employee({
        id: `emp-${testCase.name}`,
        terminalSessionId: testCase.terminal ? `term-${testCase.name}` : null,
      });
      const terminalSessions = testCase.terminal
        ? [
            terminalSession(nextEmployee.id, {
              sessionId: `term-${testCase.name}`,
              ...testCase.terminal,
            }),
          ]
        : [];
      const presented = presentEmployeeActivity({
        employee: nextEmployee,
        activity: backendActivity(nextEmployee.id, {
          activeTerminalSessionId: testCase.terminal ? `term-${testCase.name}` : null,
          ...testCase.activity,
        }),
        terminalSessions,
        approvals: [],
        actions: [],
        processes: [],
        review: null,
        handoff: null,
      });
      const model = createEmployeeFloorViewModel({
        employee: nextEmployee,
        presentation: presented,
        selected: false,
        deskIndex: 0,
      });

      expect(
        {
          state: presented.state,
          behavior: presented.behavior,
          turnOwner: presented.turnOwner,
          terminalState: presented.terminalState,
          officeState: model.officeState,
          zone: model.zone,
          worksAtDesk: model.worksAtDesk,
        },
        testCase.name,
      ).toEqual(testCase.expected);
    }
  });

  it("routes by contract desk work before legacy owner-wait presentation", () => {
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-contract-desk-work" }),
      presentation: presentation("codex_waiting_instruction", {
        behavior: "waiting_at_owner",
        attentionRequired: true,
        attentionReason: "needs_instruction",
        contract: activityContract({
          placement: "desk",
          activity: "working",
        }),
      }),
      selected: false,
      deskIndex: 1,
    });

    expect(model.officeState).toBe("working_at_desk");
    expect(model.visualState).toBe("desk_working");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
  });

  it("routes by contract owner approval before legacy desk-work presentation", () => {
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-contract-owner-approval" }),
      presentation: presentation("codex_running", {
        behavior: "at_desk_working",
        workPhase: "agent_working",
        turnOwner: "agent",
        contract: activityContract({
          placement: "owner_office",
          activity: "approval",
          attentionReason: "needs_terminal_approval",
        }),
      }),
      selected: false,
      deskIndex: 1,
    });

    expect(model.officeState).toBe("terminal_waiting_approval");
    expect(model.visualState).toBe("desk_waiting_approval");
    expect(model.zone).toBe("executive_office");
    expect(model.worksAtDesk).toBe(false);
  });

  it("routes done-room terminal contracts away from legacy desk-terminal behavior", () => {
    const presented = presentation("shell_running", {
      behavior: "at_desk_terminal",
      workPhase: "shell_open",
      turnOwner: "none",
      contract: activityContract({
        placement: "done_room",
        activity: "terminal",
      }),
    });
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-contract-done-room-terminal" }),
      presentation: presented,
      selected: false,
      deskIndex: 1,
    });

    expect(presented.contractView?.floorIntent).toBe("done_room_idle");
    expect(model.officeState).toBe("idle_available");
    expect(model.visualState).toBe("social_idle");
    expect(model.zone).toBe("done_room");
    expect(model.worksAtDesk).toBe(false);
  });

  it("keeps presentation fallback routing when no activity contract view is present", () => {
    const model = createEmployeeFloorViewModel({
      employee: employee({ id: "emp-no-contract-terminal" }),
      presentation: presentation("action_running", {
        behavior: "at_desk_terminal",
        workPhase: "tool_running",
        turnOwner: "tool",
        terminalState: "codex_running",
        contract: null,
      }),
      selected: false,
      deskIndex: 1,
    });

    expect(model.officeState).toBe("running_terminal");
    expect(model.visualState).toBe("desk_terminal");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
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

  it("assigns desks and standby filler from person employees only", () => {
    const models = createEmployeeFloorViewModels(
      [
        {
          employee: employee({ id: "owner-1", name: "Mira", role: "frontend" }),
          presentation: presentation("codex_running"),
        },
        {
          employee: employee({
            id: "pet-1",
            name: "Pixel",
            visualKind: "pet",
            companionOfEmployeeId: "owner-1",
            petVariant: "cat",
          }),
          presentation: presentation("codex_running"),
        },
        {
          employee: employee({ id: "owner-2", name: "Noah", role: "reviewer" }),
          presentation: presentation("idle"),
        },
      ],
      "pet-1",
      { includeStandby: true },
    );

    const owner = models.find((model) => model.id === "owner-1");
    const pet = models.find((model) => model.id === "pet-1");
    const secondOwner = models.find((model) => model.id === "owner-2");

    expect(owner).toMatchObject({
      visualKind: "person",
      occupiesDesk: true,
      deskIndex: 0,
      followTargetEmployeeId: null,
    });
    expect(pet).toMatchObject({
      kind: "employee",
      visualKind: "pet",
      companionOfEmployeeId: "owner-1",
      followTargetEmployeeId: "owner-1",
      petVariant: "cat",
      occupiesDesk: false,
      selected: true,
      deskIndex: 0,
      zone: "open_floor",
      worksAtDesk: false,
    });
    expect(secondOwner).toMatchObject({
      visualKind: "person",
      occupiesDesk: true,
      deskIndex: 1,
    });
    expect(models.filter((model) => model.visualKind === "pet")).toHaveLength(1);
    expect(models.filter((model) => model.kind === "standby")).toHaveLength(8);
    expect(models).toHaveLength(11);
  });
});

function employee(
  overrides: Partial<Employee> & {
    visualKind?: "person" | "pet" | null;
    companionOfEmployeeId?: string | null;
    petVariant?: EmployeeFloorPetVariant | null;
  } = {},
): Employee {
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
  } as Employee;
}

function backendActivity(
  employeeId: string,
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
  const status = overrides.status ?? "idle";
  return {
    employeeId,
    status,
    contract: defaultActivityContract(status, overrides.attention?.reason),
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

function codexActivity({
  status,
  behavior,
  terminalState,
  agentState,
  workPhase,
  turnOwner,
  attentionReason,
}: {
  status: EmployeeActivity["status"];
  behavior: NonNullable<EmployeeActivity["behavior"]>;
  terminalState: NonNullable<EmployeeActivity["terminalState"]>;
  agentState: NonNullable<EmployeeActivity["agent"]>["state"];
  workPhase: NonNullable<EmployeeActivity["work"]>["phase"];
  turnOwner: NonNullable<EmployeeActivity["work"]>["turnOwner"];
  attentionReason?: NonNullable<EmployeeActivity["attention"]>["reason"];
}): Partial<EmployeeActivity> {
  return {
    status,
    behavior,
    terminalState,
    agent: {
      kind: "codex",
      state: agentState,
      lastStateChangedAt: 1,
    },
    work: {
      phase: workPhase,
      turnOwner,
    },
    attention: {
      required: Boolean(attentionReason),
      reason: attentionReason ?? null,
      priority: attentionReason ? "normal" : "none",
    },
  };
}

function terminalSession(
  employeeId: string,
  overrides: Partial<TerminalSessionRecord> = {},
): TerminalSessionRecord {
  const profile = overrides.profile ?? "codex";
  return {
    sessionId: "term-1",
    employeeId,
    profile,
    runtime: "pty",
    activeProfile: profile,
    cwd: "/workspace",
    status: "running",
    startedAt: 1,
    label: `${profile} session`,
    turnState: profile === "shell" ? "shell" : "codex_starting",
    ...overrides,
  };
}

function presentation(
  state: EmployeeVisualState,
  overrides: Partial<EmployeeActivityPresentation> = {},
): EmployeeActivityPresentation {
  const contract = overrides.contract ?? null;
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
    contract,
    contractView: contract
      ? resolveEmployeeActivityContractView({
          contract,
        })
      : null,
    blockers: [],
    ...overrides,
  };
}

function activityContract({
  placement,
  activity,
  attentionReason = null,
}: {
  placement: NonNullable<EmployeeActivity["contract"]>["render"]["placement"];
  activity: NonNullable<EmployeeActivity["contract"]>["render"]["activity"];
  attentionReason?: NonNullable<EmployeeActivity["contract"]>["attention"]["reason"];
}): NonNullable<EmployeeActivity["contract"]> {
  return {
    lifecycle: "active",
    work: {
      kind: activity === "terminal" ? "shell" : "codex",
      phase: activity === "terminal" ? "idle" : "working",
      turnOwner: activity === "working" ? "agent" : "none",
    },
    render: {
      placement,
      posture: placement === "desk" ? "sitting" : "standing",
      activity,
    },
    attention: {
      required: Boolean(attentionReason),
      reason: attentionReason,
      priority: attentionReason ? "normal" : "none",
    },
    source: {
      runtime: "pty",
      confidence: "fallback",
    },
  };
}

function defaultActivityContract(
  status: EmployeeActivity["status"],
  attentionReason: NonNullable<EmployeeActivity["attention"]>["reason"] | null | undefined = null,
): EmployeeActivity["contract"] {
  switch (status) {
    case "standby":
      return {
        ...activityContract({ placement: "standby", activity: "idle" }),
        lifecycle: "standby",
        work: { kind: "none", phase: "idle", turnOwner: "none" },
      };
    case "stopped":
      return {
        ...activityContract({ placement: "offline", activity: "idle" }),
        lifecycle: "stopped",
        work: { kind: "none", phase: "idle", turnOwner: "none" },
      };
    case "shell_running":
      return activityContract({ placement: "done_room", activity: "terminal" });
    case "codex_starting":
      return {
        ...activityContract({ placement: "done_room", activity: "terminal" }),
        work: { kind: "codex", phase: "starting", turnOwner: "none" },
      };
    case "codex_running":
      return activityContract({ placement: "desk", activity: "working" });
    case "codex_waiting_instruction":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "waiting_instruction",
          attentionReason: "needs_instruction",
        }),
        work: { kind: "codex", phase: "waiting_owner", turnOwner: "owner" },
      };
    case "codex_waiting_approval":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "approval",
          attentionReason: "needs_terminal_approval",
        }),
        work: { kind: "codex", phase: "waiting_approval", turnOwner: "owner" },
      };
    case "action_pending_approval":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "approval",
          attentionReason: attentionReason ?? "needs_app_approval",
        }),
        work: { kind: "action", phase: "waiting_approval", turnOwner: "owner" },
      };
    case "action_running":
      return {
        ...activityContract({ placement: "desk", activity: "working" }),
        work: { kind: "action", phase: "working", turnOwner: "tool" },
      };
    case "process_running":
      return {
        ...activityContract({ placement: "desk", activity: "terminal" }),
        work: { kind: "process", phase: "working", turnOwner: "tool" },
      };
    case "review_needed":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "review",
          attentionReason: "review_needed",
        }),
        work: { kind: "review", phase: "ready", turnOwner: "owner" },
      };
    case "handoff_ready":
    case "done_clean":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "handoff",
          attentionReason: status === "done_clean" ? "ready_to_report" : "handoff_ready",
        }),
        work: { kind: "review", phase: "ready", turnOwner: "owner" },
      };
    case "blocked":
      return {
        ...activityContract({
          placement: "owner_office",
          activity: "blocked",
          attentionReason: "blocked_needs_help",
        }),
        work: { kind: "none", phase: "blocked", turnOwner: "owner" },
      };
    case "idle":
    default:
      return {
        ...activityContract({ placement: "done_room", activity: "idle" }),
        work: { kind: "none", phase: "idle", turnOwner: "none" },
      };
  }
}
