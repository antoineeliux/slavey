import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../store/appStore";
import { resetAppStore } from "../../test/storeTestUtils";
import type { Employee, EmployeeActivity } from "../../types";
import { EmployeeDetailsPanel } from "../EmployeeDetailsPanel";

describe("EmployeeDetailsPanel", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("uses structured activity status for the status pill", () => {
    const selectedEmployee = employee({
      id: "employee-1",
      status: "running",
      terminalSessionId: "terminal-1",
      currentCommand: "codex",
    });
    useAppStore.setState({
      employees: [selectedEmployee],
      selectedEmployeeId: selectedEmployee.id,
      employeeActivities: {
        [selectedEmployee.id]: activity(selectedEmployee.id, "codex_waiting_approval"),
      },
    });

    const { container } = render(<EmployeeDetailsPanel />);
    const statusPill = container.querySelector(".status-pill");

    expect(statusPill).toHaveClass("codex_waiting_approval");
    expect(statusPill).toHaveTextContent("codex waiting approval");
  });

  it("uses canonical standby contract for a standby employee", () => {
    const selectedEmployee = employee({
      id: "employee-1",
      status: "standby",
      terminalSessionId: null,
      currentCommand: null,
    });
    useAppStore.setState({
      employees: [selectedEmployee],
      selectedEmployeeId: selectedEmployee.id,
      employeeActivities: {
        [selectedEmployee.id]: activity(selectedEmployee.id, "standby"),
      },
    });

    const { container } = render(<EmployeeDetailsPanel />);
    const statusPill = container.querySelector(".status-pill");

    expect(statusPill).toHaveClass("standby");
    expect(statusPill).toHaveTextContent("standby");
  });

  it("uses owner-instruction contract for the status pill", () => {
    const selectedEmployee = employee({
      id: "employee-1",
      status: "running",
      terminalSessionId: "terminal-1",
      currentCommand: "codex",
    });
    useAppStore.setState({
      employees: [selectedEmployee],
      selectedEmployeeId: selectedEmployee.id,
      employeeActivities: {
        [selectedEmployee.id]: activity(selectedEmployee.id, "codex_waiting_instruction", {
          attention: { required: true, reason: "needs_instruction", priority: "normal" },
          agent: { kind: "codex", state: "waiting_prompt", lastStateChangedAt: 1 },
          terminalState: "codex_waiting_instruction",
        }),
      },
    });

    const { container } = render(<EmployeeDetailsPanel />);
    const statusPill = container.querySelector(".status-pill");

    expect(statusPill).toHaveClass("codex_waiting_instruction");
    expect(statusPill).toHaveTextContent("codex waiting instruction");
  });
});

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    name: "Ada",
    role: "frontend",
    status: "idle",
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
  status: EmployeeActivity["status"],
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
  return {
    employeeId,
    status,
    lifecycle: "active",
    behavior: "waiting_at_owner",
    session: { kind: "codex", state: "open" },
    agent: { kind: "codex", state: "waiting_approval", lastStateChangedAt: 1 },
    work: { phase: "waiting_for_owner", turnOwner: "owner" },
    attention: { required: true, reason: "needs_terminal_approval", priority: "urgent" },
    contract: defaultActivityContract(status),
    terminalState: "codex_waiting_approval",
    activityReason: "terminal_waiting_approval",
    label: "Terminal approval required",
    details: "Approve or reject in terminal",
    lastActivityAt: 1,
    activeTerminalSessionId: "terminal-1",
    activeActionId: null,
    activeProcessIds: [],
    reviewCounts: { changedFiles: 0, stagedFiles: 0, untrackedFiles: 0 },
    blockers: [],
    ...overrides,
  };
}

function defaultActivityContract(status: EmployeeActivity["status"]): EmployeeActivity["contract"] {
  switch (status) {
    case "standby":
      return {
        lifecycle: "standby",
        work: { kind: "none", phase: "idle", turnOwner: "none" },
        render: { placement: "standby", posture: "standing", activity: "idle" },
        attention: { required: false, reason: null, priority: "none" },
        source: { runtime: "none", confidence: "none" },
      };
    case "codex_waiting_instruction":
      return {
        lifecycle: "active",
        work: { kind: "codex", phase: "waiting_owner", turnOwner: "owner" },
        render: {
          placement: "owner_office",
          posture: "standing",
          activity: "waiting_instruction",
        },
        attention: { required: true, reason: "needs_instruction", priority: "normal" },
        source: { runtime: "pty", confidence: "fallback" },
      };
    case "codex_waiting_approval":
    default:
      return {
        lifecycle: "active",
        work: { kind: "codex", phase: "waiting_approval", turnOwner: "owner" },
        render: { placement: "owner_office", posture: "standing", activity: "approval" },
        attention: { required: true, reason: "needs_terminal_approval", priority: "urgent" },
        source: { runtime: "pty", confidence: "fallback" },
      };
  }
}
