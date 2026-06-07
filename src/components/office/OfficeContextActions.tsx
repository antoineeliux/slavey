import { Check, GitBranch, ListTree, ShieldQuestion, TerminalSquare, X } from "lucide-react";

import type {
  Action,
  ApprovalRequest,
  WorktreeHandoffPreflight,
} from "../../types";
import type { EmployeeFloorViewModel } from "../employee-floor/employeeFloorViewModel";

export function OfficeContextActions({
  viewModel,
  pendingApproval,
  pendingAction,
  handoff,
  handoffDisabledReason,
  changedFiles,
  onOpenApprovals,
  onOpenReview,
  onOpenTerminal,
  onResolvePendingApproval,
  onApplyHandoff,
}: {
  viewModel: EmployeeFloorViewModel;
  pendingApproval: ApprovalRequest | null;
  pendingAction: Action | null;
  handoff: WorktreeHandoffPreflight | null;
  handoffDisabledReason: string | null;
  changedFiles: string[];
  onOpenApprovals: () => void;
  onOpenReview: () => void;
  onOpenTerminal: () => void;
  onResolvePendingApproval: (resolution: "approve" | "reject") => void;
  onApplyHandoff: () => void;
}) {
  const requiresTerminalApproval =
    viewModel.attentionReason === "needs_terminal_approval" ||
    viewModel.officeState === "terminal_waiting_approval";
  const requiresAppApproval =
    viewModel.attentionReason === "needs_app_approval" ||
    (viewModel.attentionReason === "needs_approval" &&
      viewModel.officeState === "waiting_approval") ||
    viewModel.officeState === "waiting_approval";

  if (requiresTerminalApproval) {
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <TerminalSquare size={14} />
          <span>Terminal approval required</span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenTerminal}>Open terminal</button>
        </div>
      </div>
    );
  }

  if (requiresAppApproval) {
    const item = pendingAction ?? pendingApproval;
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <ShieldQuestion size={14} />
          <span title={item?.description ?? item?.title ?? ""}>
            {item?.title ?? "Approval pending"}
          </span>
        </div>
        <div className="office-context-actions">
          <button onClick={() => onResolvePendingApproval("approve")} disabled={!item}>
            <Check size={14} />
            Approve
          </button>
          <button className="danger" onClick={() => onResolvePendingApproval("reject")} disabled={!item}>
            <X size={14} />
            Reject
          </button>
          <button onClick={onOpenApprovals}>Details</button>
        </div>
      </div>
    );
  }

  if (viewModel.officeState === "reviewing_changes") {
    const count = Math.max(viewModel.changedFiles, changedFiles.length);
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <ListTree size={14} />
          <span>{count} changed file{count === 1 ? "" : "s"}</span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenReview}>Open review</button>
        </div>
      </div>
    );
  }

  if (viewModel.officeState === "handoff_ready") {
    if (viewModel.sourceState === "done_clean") {
      return (
        <div className="office-context-panel">
          <div className="office-context-title">
            <GitBranch size={14} />
            <span>Ready to report</span>
          </div>
          <div className="office-context-actions">
            <button onClick={onOpenTerminal}>Open details</button>
          </div>
        </div>
      );
    }
    const applyDisabledReason =
      handoff?.canApply === true ? handoffDisabledReason : handoff?.blockers[0] ?? "Handoff is not ready";
    const title = handoff ? `${handoff.commitsToApply.length} commit handoff` : "Handoff ready";
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <GitBranch size={14} />
          <span>{title}</span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenReview}>Open handoff</button>
          <button
            className="success"
            disabled={Boolean(applyDisabledReason)}
            title={applyDisabledReason ?? "Apply handoff"}
            onClick={onApplyHandoff}
          >
            Apply
          </button>
        </div>
      </div>
    );
  }

  if (viewModel.officeState === "blocked") {
    return (
      <div className="office-context-panel">
        <div className="office-context-title danger">
          <X size={14} />
          <span title={viewModel.blockers.join("; ") || viewModel.detail}>
            {viewModel.blockers[0] ?? viewModel.detail}
          </span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenTerminal}>Open details</button>
        </div>
      </div>
    );
  }

  if (viewModel.officeState === "on_standby") {
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <TerminalSquare size={14} />
          <span>{viewModel.terminalSessionId ? "Session preserved" : "Waiting room"}</span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenTerminal}>Open terminal</button>
        </div>
      </div>
    );
  }

  if (
    viewModel.officeState === "running_terminal" ||
    viewModel.officeState === "working_at_desk" ||
    viewModel.officeState === "waiting_instruction"
  ) {
    return (
      <div className="office-context-panel">
        <div className="office-context-title">
          <TerminalSquare size={14} />
          <span>{viewModel.currentCommand ?? viewModel.label}</span>
        </div>
        <div className="office-context-actions">
          <button onClick={onOpenTerminal}>Open terminal</button>
        </div>
      </div>
    );
  }

  return null;
}
