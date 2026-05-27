import { useState } from "react";
import { Check, Plus, ShieldQuestion, TerminalSquare, X } from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { Action, ActionStatus, ApprovalRequest } from "../types";
import {
  formatBytes,
  formatLabel,
  formatTimestamp,
  previewText,
  shortId,
} from "./panelUtils";

export function ActionPanel({
  employeeId,
  cwd,
  actions,
}: {
  employeeId: string;
  cwd: string;
  actions: Action[];
}) {
  const createAction = useAppStore((state) => state.createAction);
  const approvals = useAppStore((state) => state.approvals);
  const requestActionApproval = useAppStore((state) => state.requestActionApproval);
  const approveAction = useAppStore((state) => state.approveAction);
  const rejectAction = useAppStore((state) => state.rejectAction);
  const runAction = useAppStore((state) => state.runAction);
  const cancelAction = useAppStore((state) => state.cancelAction);
  const [filter, setFilter] = useState<ActionPanelFilter>("all");
  const filteredActions = actions.filter((action) => actionMatchesPanelFilter(action, filter));

  return (
    <section className="action-panel">
      <div className="section-heading">
        <TerminalSquare size={15} />
        Actions
        <button
          className="icon-button"
          title="Create shell action"
          onClick={() =>
            void createAction({
              employeeId,
              kind: "shell_command",
              title: "Inspect workspace",
              description: "Run pwd and list the current directory.",
              command: "pwd && ls",
              cwd,
            })
          }
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="action-toolbar">
        {(["all", "pending", "running", "failed", "completed"] as ActionPanelFilter[]).map(
          (item) => (
            <button
              className={
                filter === item
                  ? "command-button compact active-filter"
                  : "command-button compact"
              }
              key={item}
              onClick={() => setFilter(item)}
            >
              {formatActionFilter(item)}
            </button>
          ),
        )}
        <button
          className="command-button compact"
          onClick={() =>
            void createAction({
              employeeId,
              kind: "file_write",
              title: "Write action test file",
              description: "Write a timestamped file through the safe action runner.",
              path: "action-test.txt",
              contents: `Action test ${new Date().toISOString()}\n`,
              cwd,
            })
          }
        >
          File test
        </button>
      </div>
      {filteredActions.length === 0 ? (
        <div className="empty-panel">No actions for this employee.</div>
      ) : (
        <div className="action-list">
          {filteredActions.map((action) => {
            const approval = action.approvalId
              ? approvals.find((item) => item.id === action.approvalId)
              : null;
            const requestDisabled = actionControlDisabledReason(action, "request");
            const approveDisabled = actionControlDisabledReason(action, "approve");
            const rejectDisabled = actionControlDisabledReason(action, "reject");
            const runDisabled = actionControlDisabledReason(action, "run");
            const cancelDisabled = actionControlDisabledReason(action, "cancel");
            return (
              <div className={`action-item ${action.status}`} key={action.id}>
                <div className="action-title">
                  <strong>{action.title}</strong>
                  <span>{action.status.replace("_", " ")}</span>
                </div>
                <p>{action.description}</p>
                <code title={action.command ?? action.path ?? action.kind}>
                  {action.command ?? action.path ?? action.kind}
                  {action.timeoutSecs ? ` · ${action.timeoutSecs}s` : ""}
                </code>
                <div className="audit-grid">
                  <span>Employee</span>
                  <strong title={action.employeeId}>{shortId(action.employeeId)}</strong>
                  <span>Type</span>
                  <strong>{formatLabel(action.kind)}</strong>
                  <span>Source</span>
                  <strong>{formatLabel(action.source)}</strong>
                  <span>Created</span>
                  <strong>{formatTimestamp(action.createdAt)}</strong>
                  <span>Updated</span>
                  <strong>{formatTimestamp(action.updatedAt)}</strong>
                  <span>Started</span>
                  <strong>
                    {action.startedAt ? formatTimestamp(action.startedAt) : "not started"}
                  </strong>
                  <span>Finished</span>
                  <strong>
                    {action.finishedAt ? formatTimestamp(action.finishedAt) : "not finished"}
                  </strong>
                  <span>Approval</span>
                  <strong title={action.approvalId ?? ""}>
                    {approval
                      ? `${approval.status} ${shortId(approval.id)}`
                      : action.approvalId
                        ? shortId(action.approvalId)
                        : "none"}
                  </strong>
                  <span>Limits</span>
                  <strong>
                    {action.timeoutSecs}s / {formatBytes(action.outputCapBytes)}
                  </strong>
                  <span>Reason</span>
                  <strong>
                    {action.failureReason
                      ? formatLabel(action.failureReason)
                      : action.cancellationReason ?? "none"}
                  </strong>
                </div>
                <div className="approval-actions">
                  <button
                    className="command-button compact"
                    disabled={Boolean(requestDisabled)}
                    title={requestDisabled ?? "Request approval"}
                    onClick={() => void requestActionApproval(action.id)}
                  >
                    Request
                  </button>
                  <button
                    className="icon-button"
                    disabled={Boolean(approveDisabled)}
                    title={approveDisabled ?? "Approve"}
                    onClick={() => void approveAction(action.id)}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={Boolean(rejectDisabled)}
                    title={rejectDisabled ?? "Reject"}
                    onClick={() => void rejectAction(action.id)}
                  >
                    <X size={14} />
                  </button>
                  <button
                    className="command-button compact"
                    disabled={Boolean(runDisabled)}
                    title={runDisabled ?? "Run action"}
                    onClick={() => void runAction(action.id)}
                  >
                    Run
                  </button>
                  <button
                    className="command-button compact"
                    disabled={Boolean(cancelDisabled)}
                    title={cancelDisabled ?? "Cancel action"}
                    onClick={() => void cancelAction(action.id)}
                  >
                    Cancel
                  </button>
                </div>
                {action.error ? <pre className="error-output">{previewText(action.error)}</pre> : null}
                {action.output ? <pre>{previewText(action.output)}</pre> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ApprovalPanel({
  employeeId,
  approvals,
  onCreate,
}: {
  employeeId: string;
  approvals: ApprovalRequest[];
  onCreate: () => void;
}) {
  const approveApproval = useAppStore((state) => state.approveApproval);
  const rejectApproval = useAppStore((state) => state.rejectApproval);
  const [filter, setFilter] = useState<ApprovalPanelFilter>("pending");
  const filteredApprovals = approvals.filter((approval) =>
    approvalMatchesPanelFilter(approval, filter),
  );

  return (
    <section className="approval-panel">
      <div className="section-heading">
        <ShieldQuestion size={15} />
        Approvals
        <button className="icon-button" title="Create approval request" onClick={onCreate}>
          <Plus size={14} />
        </button>
      </div>
      <div className="action-toolbar">
        {(["pending", "all", "resolved"] as ApprovalPanelFilter[]).map((item) => (
          <button
            className={
              filter === item ? "command-button compact active-filter" : "command-button compact"
            }
            key={item}
            onClick={() => setFilter(item)}
          >
            {formatLabel(item)}
          </button>
        ))}
      </div>
      {filteredApprovals.length === 0 ? (
        <div className="empty-panel">No approvals for this filter.</div>
      ) : (
        <div className="approval-list">
          {filteredApprovals.map((approval) => (
            <div className="approval-item" key={approval.id}>
              <div className="action-title">
                <strong>{approval.title}</strong>
                <span>{approval.status}</span>
              </div>
              <p>{approval.description}</p>
              <code title={approval.command ?? approval.path ?? employeeId}>
                {approval.command ?? approval.path ?? approval.kind}
              </code>
              <div className="audit-grid">
                <span>Employee</span>
                <strong title={approval.employeeId}>{shortId(approval.employeeId)}</strong>
                <span>Type</span>
                <strong>{formatLabel(approval.kind)}</strong>
                <span>Action</span>
                <strong title={approval.actionId ?? ""}>
                  {approval.actionId ? shortId(approval.actionId) : "none"}
                </strong>
                <span>Created</span>
                <strong>{formatTimestamp(approval.createdAt)}</strong>
                <span>Resolved</span>
                <strong>
                  {approval.resolvedAt ? formatTimestamp(approval.resolvedAt) : "pending"}
                </strong>
              </div>
              <div className="approval-actions">
                <button
                  className="icon-button"
                  disabled={approval.status !== "pending"}
                  title={approval.status === "pending" ? "Approve" : "Approval already resolved"}
                  onClick={() => void approveApproval(approval.id)}
                >
                  <Check size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={approval.status !== "pending"}
                  title={approval.status === "pending" ? "Reject" : "Approval already resolved"}
                  onClick={() => void rejectApproval(approval.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type ActionPanelFilter = "all" | "pending" | "running" | "failed" | "completed";
type ActionControl = "request" | "approve" | "reject" | "run" | "cancel";
type ApprovalPanelFilter = "pending" | "all" | "resolved";

function actionMatchesPanelFilter(action: Action, filter: ActionPanelFilter): boolean {
  switch (filter) {
    case "pending":
      return action.status === "pending_approval";
    case "running":
      return action.status === "running";
    case "failed":
      return action.status === "failed";
    case "completed":
      return (["succeeded", "rejected", "cancelled"] as ActionStatus[]).includes(action.status);
    case "all":
      return true;
  }
}

function actionControlDisabledReason(action: Action, control: ActionControl): string | null {
  if (control === "request") {
    return action.status === "draft" ? null : "Only draft actions can request approval";
  }
  if (control === "approve" || control === "reject") {
    return action.status === "pending_approval"
      ? null
      : "Only pending approval actions can be resolved";
  }
  if (control === "run") {
    return action.status === "approved" ? null : "Action must be approved before running";
  }
  return ["draft", "pending_approval", "approved", "running"].includes(action.status)
    ? null
    : "Final actions cannot be cancelled";
}

function formatActionFilter(filter: ActionPanelFilter): string {
  return filter === "pending" ? "Pending approval" : formatLabel(filter);
}

function approvalMatchesPanelFilter(
  approval: ApprovalRequest,
  filter: ApprovalPanelFilter,
): boolean {
  if (filter === "pending") {
    return approval.status === "pending";
  }
  if (filter === "resolved") {
    return approval.status !== "pending";
  }
  return true;
}
