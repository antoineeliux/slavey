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
    expect(screen.getByText("Review needed")).toBeInTheDocument();
    expect(screen.getByText("Mira Frontend").closest(".employee-station")).toHaveAttribute(
      "data-state",
      "review_needed",
    );
    expect(screen.getByText("Mira Frontend").closest(".employee-station")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("maps structured activity and fallback state to visual states", () => {
    const cases: Array<[string, ReturnType<typeof presentEmployeeActivity>["state"], Parameters<typeof presentation>[1]]> = [
      ["idle", "idle", { activityStatus: "idle" }],
      ["standby", "standby", { employeeStatus: "standby", activityStatus: "standby" }],
      ["shell", "shell_running", { activityStatus: "shell_running", terminalProfile: "shell" }],
      [
        "shell-codex",
        "codex_starting",
        { activityStatus: "shell_running", terminalProfile: "shell", activeProfile: "codex" },
      ],
      ["codex-starting", "codex_starting", { activityStatus: "codex_starting", terminalProfile: "codex" }],
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
        { activityStatus: "codex_running", terminalProfile: "codex", lastPromptReadyAt: 20_000 },
      ],
      [
        "backend-codex-waiting",
        "codex_waiting_instruction",
        { activityStatus: "codex_waiting_instruction", terminalProfile: "codex" },
      ],
      [
        "backend-agent-waiting",
        "codex_waiting_instruction",
        { activityStatus: "codex_running", agentState: "waiting_prompt" },
      ],
      [
        "backend-attention-approval",
        "waiting_approval",
        { activityStatus: "codex_running", terminalProfile: "codex", attentionReason: "needs_approval" },
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
        { activityStatus: "codex_running", agentState: "waiting_approval" },
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
          activityStatus: "codex_running",
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
    behavior?: EmployeeActivity["behavior"];
    terminalState?: EmployeeActivity["terminalState"];
    attentionReason?: EmployeeAttentionReason;
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
          activeTerminalSessionId: options.terminalProfile ? `term-${suffix}` : null,
          behavior: options.behavior,
          terminalState: options.terminalState,
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
            activeProfile: options.activeProfile,
            cwd: nextEmployee.cwd,
            status: "running",
            startedAt: 1,
            lastOutputAt: options.lastOutputAt,
            lastPromptSubmittedAt: options.lastPromptSubmittedAt,
            lastPromptReadyAt: options.lastPromptReadyAt,
            lastApprovalPromptAt: options.lastApprovalPromptAt,
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
