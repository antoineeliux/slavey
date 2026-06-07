import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmployeeFloorViewModel } from "../employee-floor/employeeFloorViewModel";
import { OfficeContextActions } from "./OfficeContextActions";

describe("OfficeContextActions", () => {
  it("opens the terminal for terminal-native approval prompts", () => {
    const openTerminal = vi.fn();

    render(
      <OfficeContextActions
        viewModel={viewModel("terminal_waiting_approval")}
        pendingApproval={null}
        pendingAction={null}
        handoff={null}
        handoffDisabledReason={null}
        changedFiles={[]}
        onOpenApprovals={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenTerminal={openTerminal}
        onResolvePendingApproval={vi.fn()}
        onApplyHandoff={vi.fn()}
      />,
    );

    screen.getByText("Terminal approval required");
    screen.getByRole("button", { name: "Open terminal" }).click();

    expect(openTerminal).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });
});

function viewModel(
  officeState: EmployeeFloorViewModel["officeState"],
): EmployeeFloorViewModel {
  return {
    id: "employee-1",
    kind: "employee",
    name: "Ada",
    role: "general",
    employeeStatus: "running",
    selected: true,
    deskIndex: 0,
    standbySlotId: null,
    standbyRoom: null,
    sourceState: "codex_waiting_approval",
    officeState,
    visualState: "desk_waiting_approval",
    zone: "executive_office",
    label: "Terminal approval",
    detail: "Approve or reject in terminal",
    stationTitle: "Ada",
    cwd: "/tmp",
    worktreePath: null,
    branchName: null,
    currentCommand: "codex",
    terminalSessionId: "terminal-1",
    markerColor: "#d6b45f",
    muted: false,
    worksAtDesk: false,
    pendingApprovals: 0,
    runningActions: 0,
    runningProcesses: 0,
    changedFiles: 0,
    hasHandoffReady: false,
    hasReviewNeeded: false,
    attentionReason:
      officeState === "terminal_waiting_approval" ? "needs_terminal_approval" : null,
    behavior: officeState === "terminal_waiting_approval" ? "waiting_at_owner" : null,
    workPhase:
      officeState === "terminal_waiting_approval" ? "waiting_for_owner" : null,
    turnOwner: officeState === "terminal_waiting_approval" ? "owner" : null,
    terminalState:
      officeState === "terminal_waiting_approval" ? "codex_waiting_approval" : null,
    activityReason:
      officeState === "terminal_waiting_approval" ? "terminal_waiting_approval" : null,
    blockers: [],
  };
}
