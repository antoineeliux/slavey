import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OfficeStatusHud } from "./OfficeStatusHud";

describe("OfficeStatusHud", () => {
  it("does not render when no employee is selected", () => {
    const { container } = render(
      <OfficeStatusHud
        viewModel={null}
        pendingApproval={null}
        pendingAction={null}
        handoff={null}
        handoffDisabledReason={null}
        changedFiles={[]}
        companionCount={0}
        onOpenTerminal={vi.fn()}
        onOpenEditor={vi.fn()}
        onOpenApprovals={vi.fn()}
        onOpenReview={vi.fn()}
        onResolvePendingApproval={vi.fn()}
        onApplyHandoff={vi.fn()}
        onCreateCompanion={vi.fn()}
        onReleaseEmployee={vi.fn()}
        onSetStandby={vi.fn()}
        onResumeStandby={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("No employee selected")).not.toBeInTheDocument();
  });
});
