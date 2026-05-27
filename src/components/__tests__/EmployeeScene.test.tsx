import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../store/appStore";
import { resetAppStore } from "../../test/storeTestUtils";
import type { Employee, EmployeeActivity, EmployeeActivityStatus } from "../../types";
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
      ["shell", "shell_running", { activityStatus: "shell_running", terminalProfile: "shell" }],
      ["codex", "codex_running", { activityStatus: "codex_running", terminalProfile: "codex" }],
      ["approval", "waiting_approval", { approval: true }],
      ["action", "action_running", { actionRunning: true }],
      ["process", "process_running", { processRunning: true }],
      ["review", "review_needed", { activityStatus: "review_needed", changedFiles: 2 }],
      ["handoff", "handoff_ready", { handoffReady: true }],
      ["blocked", "blocked", { employeeStatus: "failed" }],
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
    approval?: boolean;
    actionRunning?: boolean;
    processRunning?: boolean;
    changedFiles?: number;
    handoffReady?: boolean;
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
          reviewCounts: {
            changedFiles: options.changedFiles ?? 0,
            stagedFiles: 0,
            untrackedFiles: 0,
          },
          activeTerminalSessionId: options.terminalProfile ? `term-${suffix}` : null,
        })
      : null,
    terminalSessions: options.terminalProfile
      ? [
          {
            sessionId: `term-${suffix}`,
            employeeId: nextEmployee.id,
            profile: options.terminalProfile,
            cwd: nextEmployee.cwd,
            status: "running",
            startedAt: 1,
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
