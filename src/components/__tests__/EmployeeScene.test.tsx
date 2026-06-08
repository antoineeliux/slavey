import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../store/appStore";
import { resetAppStore } from "../../test/storeTestUtils";
import type {
  Employee,
  EmployeeActivity,
  EmployeeActivityStatus,
  EmployeeAttentionReason,
} from "../../types";
import { presentEmployeeActivity } from "../employee-scene/activityPresentation";
import { createEmployeeFloorViewModel } from "../employee-floor/employeeFloorViewModel";
import { EmployeeScene } from "../EmployeeScene";

describe("EmployeeScene", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("renders children behind the animation boundary", () => {
    render(
      <EmployeeScene>
        <div>Activity state comes from backend</div>
      </EmployeeScene>,
    );

    expect(screen.getByText("Activity state comes from backend")).toBeInTheDocument();
    expect(screen.getByText("Activity state comes from backend").parentElement).toHaveClass(
      "employee-scene",
    );
  });

  it("renders employees as state-driven stations with selected state", () => {
    const employees = [
      employee({ id: "emp-1", name: "Mira Frontend", terminalSessionId: "term-1" }),
      employee({ id: "emp-2", name: "Noah Reviewer", status: "idle" }),
    ];
    useAppStore.setState({
      employees,
      selectedEmployeeId: "emp-1",
      employeeActivities: {
        "emp-1": activity("emp-1", "review_needed", {
          label: "Review needed",
          reviewCounts: { changedFiles: 3, stagedFiles: 1, untrackedFiles: 1 },
        }),
        "emp-2": activity("emp-2", "idle", { label: "Idle" }),
      },
    });

    render(<EmployeeScene />);

    expect(screen.getByTestId("employee-scene")).toBeInTheDocument();
    expect(screen.getByText("Command floor")).toBeInTheDocument();
    expect(screen.getByText("Mira Frontend")).toBeInTheDocument();
    expect(screen.getByText("Noah Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("Review needed").length).toBeGreaterThan(0);
    expect(screen.getByText("Mira Frontend").closest(".employee-station")).toHaveAttribute(
      "data-state",
      "review_needed",
    );
    expect(screen.getByText("Mira Frontend").closest(".employee-station")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders contract desk Codex work as selected desk work on the floor", async () => {
    const nextEmployee = employee({
      id: "emp-desk-contract",
      name: "Ada Desk",
      terminalSessionId: "term-desk-contract",
    });
    useAppStore.setState({
      employees: [nextEmployee],
      selectedEmployeeId: nextEmployee.id,
      employeeActivities: {
        [nextEmployee.id]: activity(nextEmployee.id, "codex_running", {
          label: "Legacy waiting label",
          details: "Legacy waiting detail",
          behavior: "waiting_at_owner",
          terminalState: "codex_waiting_instruction",
          activeTerminalSessionId: "term-desk-contract",
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
      },
      terminalSessions: [
        {
          sessionId: "term-desk-contract",
          employeeId: nextEmployee.id,
          profile: "codex",
          runtime: "codex_app_server",
          activeProfile: "codex",
          cwd: nextEmployee.cwd,
          status: "running",
          startedAt: 1,
          label: "Codex app-server",
          lastPromptSubmittedAt: 1,
          turnState: "agent_working",
        },
      ],
    });

    render(<EmployeeScene />);

    expect(await screen.findByText("1 at desks")).toBeInTheDocument();
    expect(screen.getByText("Ada Desk").closest(".employee-station")).toHaveAttribute(
      "data-state",
      "codex_running",
    );
    expect(screen.getByText("Ada Desk: Codex running")).toBeInTheDocument();
    expect(screen.getAllByText("Codex running").length).toBeGreaterThan(0);
    expect(screen.getByText("Working on task")).toBeInTheDocument();
    expect(screen.queryByText("Legacy waiting label")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy waiting detail")).not.toBeInTheDocument();
  });

  it("renders done-room shell contracts away from desks despite terminal legacy behavior", async () => {
    const nextEmployee = employee({
      id: "emp-shell-done-room",
      name: "Ada Shell",
      terminalSessionId: "term-shell-done-room",
    });
    useAppStore.setState({
      employees: [nextEmployee],
      selectedEmployeeId: nextEmployee.id,
      employeeActivities: {
        [nextEmployee.id]: activity(nextEmployee.id, "shell_running", {
          label: "Legacy desk terminal",
          details: "Legacy desk terminal detail",
          behavior: "at_desk_terminal",
          terminalState: "shell_running",
          activeTerminalSessionId: "term-shell-done-room",
          contract: activityContract({
            placement: "done_room",
            renderActivity: "terminal",
            workKind: "shell",
            workPhase: "idle",
            turnOwner: "none",
          }),
        }),
      },
      terminalSessions: [
        {
          sessionId: "term-shell-done-room",
          employeeId: nextEmployee.id,
          profile: "shell",
          runtime: "pty",
          activeProfile: "shell",
          cwd: nextEmployee.cwd,
          status: "running",
          startedAt: 1,
          label: "Shell",
          turnState: "shell",
        },
      ],
    });

    render(<EmployeeScene />);

    expect(await screen.findByText("0 at desks")).toBeInTheDocument();
    expect(screen.getByText("Ada Shell").closest(".employee-station")).toHaveAttribute(
      "data-state",
      "shell_running",
    );
    expect(screen.getByText("Ada Shell: Shell running")).toBeInTheDocument();
    expect(screen.queryByText("Legacy desk terminal")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy desk terminal detail")).not.toBeInTheDocument();
  });

  it("maps contract-backed activity and no-activity fallback state to visual states", () => {
    const cases: Array<[string, ReturnType<typeof presentEmployeeActivity>["state"], Parameters<typeof presentation>[1]]> = [
      ["idle", "idle", { activityStatus: "idle" }],
      ["standby", "standby", { employeeStatus: "standby", activityStatus: "standby" }],
      ["shell", "shell_running", { activityStatus: "shell_running", terminalProfile: "shell" }],
      [
        "shell-codex",
        "codex_starting",
        { activityStatus: "codex_starting", terminalProfile: "shell", activeProfile: "codex" },
      ],
      ["codex-starting", "codex_starting", { activityStatus: "codex_starting", terminalProfile: "codex" }],
      [
        "codex-starting-active-output",
        "codex_running",
        {
          activityStatus: "codex_running",
          terminalProfile: "codex",
          turnState: "agent_working",
        },
      ],
      [
        "codex",
        "codex_running",
        { activityStatus: "codex_running", terminalProfile: "codex", lastPromptSubmittedAt: 15_000 },
      ],
      [
        "structured-action-running-with-codex-terminal",
        "action_running",
        {
          activityStatus: "action_running",
          behavior: "at_desk_terminal",
          terminalState: "codex_running",
        },
      ],
      [
        "structured-process-running-with-codex-terminal",
        "process_running",
        {
          activityStatus: "process_running",
          behavior: "at_desk_terminal",
          terminalState: "codex_running",
        },
      ],
      [
        "codex-waiting",
        "codex_waiting_instruction",
        { activityStatus: "codex_waiting_instruction", terminalProfile: "codex", lastPromptReadyAt: 20_000 },
      ],
      [
        "backend-codex-waiting",
        "codex_waiting_instruction",
        { activityStatus: "codex_waiting_instruction", terminalProfile: "codex" },
      ],
      [
        "backend-agent-waiting",
        "codex_waiting_instruction",
        { activityStatus: "codex_waiting_instruction", agentState: "waiting_prompt" },
      ],
      [
        "backend-attention-approval",
        "waiting_approval",
        { activityStatus: "action_pending_approval", terminalProfile: "codex", attentionReason: "needs_app_approval" },
      ],
      [
        "structured-app-approval",
        "waiting_approval",
        {
          activityStatus: "action_pending_approval",
          behavior: "waiting_at_owner",
          attentionReason: "needs_app_approval",
        },
      ],
      [
        "structured-terminal-approval",
        "codex_waiting_approval",
        {
          activityStatus: "codex_waiting_approval",
          behavior: "waiting_at_owner",
          terminalState: "codex_waiting_approval",
          attentionReason: "needs_terminal_approval",
          actionRunning: true,
        },
      ],
      [
        "backend-agent-approval",
        "codex_waiting_approval",
        { activityStatus: "codex_waiting_approval", agentState: "waiting_approval" },
      ],
      [
        "backend-terminal-approval",
        "codex_waiting_approval",
        { activityStatus: "codex_waiting_approval", agentState: "waiting_approval" },
      ],
      [
        "terminal-approval",
        "codex_waiting_approval",
        {
          activityStatus: "codex_waiting_approval",
          terminalProfile: "codex",
          lastPromptSubmittedAt: 15_000,
          lastApprovalPromptAt: 20_000,
        },
      ],
      [
        "codex-prompt-submitted",
        "codex_running",
        {
          activityStatus: "codex_running",
          terminalProfile: "codex",
          lastOutputAt: 1,
          lastPromptSubmittedAt: 15_000,
        },
      ],
      ["approval", "waiting_approval", { approval: true }],
      ["action", "action_running", { actionRunning: true }],
      ["process", "process_running", { processRunning: true }],
      ["review", "review_needed", { activityStatus: "review_needed", changedFiles: 2 }],
      ["handoff", "handoff_ready", { handoffReady: true }],
      ["done", "done_clean", { activityStatus: "done_clean", employeeStatus: "done" }],
      ["blocked", "blocked", { employeeStatus: "failed" }],
      [
        "stopped-stale-agent",
        "stopped",
        { activityStatus: "stopped", employeeStatus: "stopped", agentState: "failed" },
      ],
      ["stopped", "stopped", { activityStatus: "stopped", employeeStatus: "stopped" }],
    ];

    for (const [name, expectedState, options] of cases) {
      expect(presentation(name, options).state).toBe(expectedState);
    }
  });

  it("lets contract owner-office terminal approval beat legacy active codex work", () => {
    const presented = presentation("contract-owner-approval", {
      activityStatus: "codex_running",
      terminalProfile: "codex",
      turnState: "agent_working",
      behavior: "at_desk_working",
      terminalState: "codex_running",
      contract: activityContract({
        placement: "owner_office",
        renderActivity: "approval",
        workKind: "codex",
        workPhase: "waiting_approval",
        turnOwner: "owner",
        attentionReason: "needs_terminal_approval",
      }),
    });

    expect(presented.state).toBe("codex_waiting_approval");
    expect(presented.attentionRequired).toBe(true);
    expect(presented.attentionReason).toBe("needs_terminal_approval");
  });

  it("lets contract desk codex work beat stale legacy waiting instruction", () => {
    const presented = presentation("contract-desk-codex", {
      activityStatus: "codex_waiting_instruction",
      activityLabel: "Awaiting prompt",
      activityDetails: "Waiting for your next instruction",
      behavior: "waiting_at_owner",
      terminalState: "codex_waiting_instruction",
      attentionReason: "needs_instruction",
      contract: activityContract({
        placement: "desk",
        renderActivity: "working",
        workKind: "codex",
        workPhase: "working",
        turnOwner: "agent",
      }),
    });

    expect(presented.state).toBe("codex_running");
    expect(presented.label).toBe("Codex running");
    expect(presented.detail).toBe("Working on task");
    expect(presented.stationTitle).toContain("Codex running. Working on task");
    expect(presented.attentionRequired).toBe(false);
    expect(presented.attentionReason).toBeNull();
  });

  it("keeps contract done-room shell in shell status while floor routes away from desk", () => {
    const nextEmployee = employee({ id: "emp-contract-done-room-shell" });
    const presented = presentation("contract-done-room-shell", {
      activityStatus: "shell_running",
      behavior: "at_desk_terminal",
      terminalState: "shell_running",
      contract: activityContract({
        placement: "done_room",
        renderActivity: "terminal",
        workKind: "shell",
        workPhase: "idle",
        turnOwner: "none",
      }),
    });
    const model = createEmployeeFloorViewModel({
      employee: nextEmployee,
      presentation: presented,
      selected: false,
      deskIndex: 0,
    });

    expect(presented.state).toBe("shell_running");
    expect(presented.label.toLowerCase()).toContain("shell");
    expect(model.zone).toBe("done_room");
    expect(model.worksAtDesk).toBe(false);
  });

  it("keeps no-activity terminal heuristics for active codex turns", () => {
    const presented = presentation("no-activity-active-turn", {
      terminalProfile: "codex",
      turnState: "agent_working",
    });

    expect(presented.contract).toBeNull();
    expect(presented.state).toBe("codex_running");
    expect(presented.behavior).toBeNull();
  });

  it("keeps no-activity approval fallback without an EmployeeActivity", () => {
    const presented = presentation("no-activity-approval", {
      approval: true,
    });

    expect(presented.contract).toBeNull();
    expect(presented.contractView).toBeNull();
    expect(presented.state).toBe("waiting_approval");
    expect(presented.label).toBe("Waiting approval");
    expect(presented.detail).toBe("1 approval pending");
    expect(presented.attentionRequired).toBe(true);
    expect(presented.attentionReason).toBe("needs_app_approval");
  });
});

function presentation(
  suffix: string,
  options: {
    employeeStatus?: Employee["status"];
    activityStatus?: EmployeeActivityStatus;
    terminalProfile?: "shell" | "codex";
    activeProfile?: "shell" | "codex";
    approval?: boolean;
    actionRunning?: boolean;
    processRunning?: boolean;
    changedFiles?: number;
    handoffReady?: boolean;
    lastOutputAt?: number;
    lastPromptSubmittedAt?: number;
    lastPromptReadyAt?: number;
    lastApprovalPromptAt?: number;
    activityLabel?: string;
    activityDetails?: string | null;
    turnState?:
      | "unknown"
      | "shell"
      | "codex_starting"
      | "owner_prompt_ready"
      | "owner_composing"
      | "prompt_submitted"
      | "agent_working"
      | "waiting_approval"
      | "completed"
      | "failed";
    behavior?: EmployeeActivity["behavior"];
    terminalState?: EmployeeActivity["terminalState"];
    attentionReason?: EmployeeAttentionReason;
    contract?: EmployeeActivity["contract"];
    agentKind?: "none" | "codex" | "claude";
    agentState?:
      | "not_active"
      | "starting"
      | "thinking"
      | "waiting_prompt"
      | "waiting_approval"
      | "completed"
      | "failed";
  },
) {
  const nextEmployee = employee({
    id: `emp-${suffix}`,
    status: options.employeeStatus ?? "running",
    terminalSessionId: options.terminalProfile ? `term-${suffix}` : null,
  });
  return presentEmployeeActivity({
    employee: nextEmployee,
    activity: options.activityStatus
      ? activity(nextEmployee.id, options.activityStatus, {
          attention: options.attentionReason
            ? {
                required: true,
                reason: options.attentionReason,
                priority: "normal",
              }
            : undefined,
          reviewCounts: {
            changedFiles: options.changedFiles ?? 0,
            stagedFiles: 0,
            untrackedFiles: 0,
          },
          ...(options.activityLabel ? { label: options.activityLabel } : {}),
          ...(options.activityDetails !== undefined ? { details: options.activityDetails } : {}),
          activeTerminalSessionId: options.terminalProfile ? `term-${suffix}` : null,
          behavior: options.behavior,
          terminalState: options.terminalState,
          ...(options.contract ? { contract: options.contract } : {}),
          activityReason: options.terminalState ? options.terminalState : undefined,
          agent: options.agentState
            ? {
                kind: options.agentKind ?? "codex",
                state: options.agentState,
                lastStateChangedAt: 1,
              }
            : undefined,
        })
      : null,
    terminalSessions: options.terminalProfile
      ? [
          {
            sessionId: `term-${suffix}`,
            employeeId: nextEmployee.id,
            profile: options.terminalProfile,
            runtime: "pty",
            activeProfile: options.activeProfile,
            cwd: nextEmployee.cwd,
            status: "running",
            startedAt: 1,
            lastOutputAt: options.lastOutputAt,
            lastPromptSubmittedAt: options.lastPromptSubmittedAt,
            lastPromptReadyAt: options.lastPromptReadyAt,
            lastApprovalPromptAt: options.lastApprovalPromptAt,
            turnState: options.turnState ?? (options.terminalProfile === "shell" ? "shell" : "codex_starting"),
            label: `${options.terminalProfile} session`,
          },
        ]
      : [],
    approvals: options.approval
      ? [
          {
            id: `approval-${suffix}`,
            employeeId: nextEmployee.id,
            kind: "shell_command",
            title: "Approve command",
            description: "Approve command",
            status: "pending",
            createdAt: 1,
          },
        ]
      : [],
    actions: options.actionRunning
      ? [
          {
            id: `action-${suffix}`,
            employeeId: nextEmployee.id,
            kind: "shell_command",
            title: "Run action",
            description: "Run action",
            source: "employee",
            timeoutSecs: 120,
            outputCapBytes: 64_000,
            status: "running",
            output: "",
            createdAt: 1,
            updatedAt: 1,
          },
        ]
      : [],
    processes: options.processRunning
      ? [
          {
            id: `process-${suffix}`,
            employeeId: nextEmployee.id,
            title: "Watcher",
            command: "npm run dev",
            cwd: nextEmployee.cwd,
            status: "running",
            createdAt: 1,
            updatedAt: 1,
          },
        ]
      : [],
    review: null,
    handoff: options.handoffReady
      ? {
          employeeId: nextEmployee.id,
          employeeBranch: "employee/branch",
          mainBranch: "main",
          ahead: 1,
          behind: 0,
          commitsToApply: [],
          employeeClean: true,
          mainClean: true,
          mainConflictedFiles: [],
          applyStrategy: "cherry_pick",
          mainOperation: {
            inProgress: false,
            operation: null,
            head: null,
            canAbort: false,
            message: "ready",
          },
          blockers: [],
          canApply: true,
          message: "Ready",
        }
      : null,
  });
}

function activityContract({
  placement,
  renderActivity,
  workKind,
  workPhase,
  turnOwner,
  attentionReason = null,
  sourceRuntime = "pty",
  sourceConfidence = "structured",
}: {
  placement: NonNullable<EmployeeActivity["contract"]>["render"]["placement"];
  renderActivity: NonNullable<EmployeeActivity["contract"]>["render"]["activity"];
  workKind: NonNullable<EmployeeActivity["contract"]>["work"]["kind"];
  workPhase: NonNullable<EmployeeActivity["contract"]>["work"]["phase"];
  turnOwner: NonNullable<EmployeeActivity["contract"]>["work"]["turnOwner"];
  attentionReason?: NonNullable<EmployeeActivity["contract"]>["attention"]["reason"];
  sourceRuntime?: NonNullable<EmployeeActivity["contract"]>["source"]["runtime"];
  sourceConfidence?: NonNullable<EmployeeActivity["contract"]>["source"]["confidence"];
}): NonNullable<EmployeeActivity["contract"]> {
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
      required: Boolean(attentionReason),
      reason: attentionReason,
      priority: attentionReason ? "normal" : "none",
    },
    source: {
      runtime: sourceRuntime,
      confidence: sourceConfidence,
    },
  };
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    name: "Ada",
    role: "frontend",
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

function activity(
  employeeId: string,
  status: EmployeeActivityStatus,
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
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

function defaultActivityContract(
  status: EmployeeActivityStatus,
  attentionReason: EmployeeAttentionReason | null | undefined = null,
): EmployeeActivity["contract"] {
  switch (status) {
    case "standby":
      return {
        ...activityContract({
          placement: "standby",
          renderActivity: "idle",
          workKind: "none",
          workPhase: "idle",
          turnOwner: "none",
        }),
        lifecycle: "standby",
      };
    case "stopped":
      return {
        ...activityContract({
          placement: "offline",
          renderActivity: "idle",
          workKind: "none",
          workPhase: "idle",
          turnOwner: "none",
        }),
        lifecycle: "stopped",
      };
    case "shell_running":
      return activityContract({
        placement: "done_room",
        renderActivity: "terminal",
        workKind: "shell",
        workPhase: "idle",
        turnOwner: "none",
      });
    case "codex_starting":
      return activityContract({
        placement: "done_room",
        renderActivity: "terminal",
        workKind: "codex",
        workPhase: "starting",
        turnOwner: "none",
      });
    case "codex_running":
      return activityContract({
        placement: "desk",
        renderActivity: "working",
        workKind: "codex",
        workPhase: "working",
        turnOwner: "agent",
      });
    case "codex_waiting_instruction":
      return activityContract({
        placement: "owner_office",
        renderActivity: "waiting_instruction",
        workKind: "codex",
        workPhase: "waiting_owner",
        turnOwner: "owner",
        attentionReason: "needs_instruction",
      });
    case "codex_waiting_approval":
      return activityContract({
        placement: "owner_office",
        renderActivity: "approval",
        workKind: "codex",
        workPhase: "waiting_approval",
        turnOwner: "owner",
        attentionReason: "needs_terminal_approval",
      });
    case "action_pending_approval":
      return activityContract({
        placement: "owner_office",
        renderActivity: "approval",
        workKind: "action",
        workPhase: "waiting_approval",
        turnOwner: "owner",
        attentionReason: attentionReason ?? "needs_app_approval",
      });
    case "action_running":
      return activityContract({
        placement: "desk",
        renderActivity: "working",
        workKind: "action",
        workPhase: "working",
        turnOwner: "tool",
      });
    case "process_running":
      return activityContract({
        placement: "desk",
        renderActivity: "terminal",
        workKind: "process",
        workPhase: "working",
        turnOwner: "tool",
      });
    case "review_needed":
      return activityContract({
        placement: "owner_office",
        renderActivity: "review",
        workKind: "review",
        workPhase: "ready",
        turnOwner: "owner",
        attentionReason: "review_needed",
      });
    case "handoff_ready":
    case "done_clean":
      return activityContract({
        placement: "owner_office",
        renderActivity: "handoff",
        workKind: "review",
        workPhase: "ready",
        turnOwner: "owner",
        attentionReason: status === "done_clean" ? "ready_to_report" : "handoff_ready",
      });
    case "blocked":
      return activityContract({
        placement: "owner_office",
        renderActivity: "blocked",
        workKind: "none",
        workPhase: "blocked",
        turnOwner: "owner",
        attentionReason: "blocked_needs_help",
      });
    case "idle":
    default:
      return activityContract({
        placement: "done_room",
        renderActivity: "idle",
        workKind: "none",
        workPhase: "idle",
        turnOwner: "none",
      });
  }
}
