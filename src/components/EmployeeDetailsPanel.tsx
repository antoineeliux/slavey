import { useEffect, useState } from "react";
import {
  Bot,
  Code2,
  GitBranch,
  History,
  Pencil,
  RefreshCw,
  Send,
  ShieldQuestion,
  Square,
} from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { Employee, EmployeeActivity, TerminalSessionRecord } from "../types";
import { resolveEmployeeActivityContractView } from "../lib/employeeActivityContractView";
import { ActionPanel, ApprovalPanel } from "./ActionApprovalPanel";
import { EmployeeDashboard } from "./EmployeeDashboard";
import {
  codexStatusLabel,
  codexStatusTitle,
  formatLabel,
  formatTimestamp,
  worktreeCreateDisabledReason,
} from "./panelUtils";
import { ProcessPanel } from "./ProcessPanel";
import { ReviewPanel } from "./ReviewPanel";

export function EmployeeDetailsPanel() {
  const backendReady = useAppStore((state) => state.backendReady);
  const activeTab = useAppStore((state) => state.activeTab);
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const employeeActivities = useAppStore((state) => state.employeeActivities);
  const approvals = useAppStore((state) => state.approvals);
  const actions = useAppStore((state) => state.actions);
  const processes = useAppStore((state) => state.processes);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const codexCliStatus = useAppStore((state) => state.codexCliStatus);
  const codexCliStatusLoading = useAppStore((state) => state.codexCliStatusLoading);
  const workspaceInfo = useAppStore((state) => state.workspaceInfo);
  const rolePolicies = useAppStore((state) => state.rolePolicies);
  const worktreeStatuses = useAppStore((state) => state.worktreeStatuses);
  const worktreeReviews = useAppStore((state) => state.worktreeReviews);
  const worktreeCommits = useAppStore((state) => state.worktreeCommits);
  const worktreeHandoffs = useAppStore((state) => state.worktreeHandoffs);
  const worktreeHandoffResults = useAppStore((state) => state.worktreeHandoffResults);
  const worktreeChangedFiles = useAppStore((state) => state.worktreeChangedFiles);
  const worktreeFileDiffs = useAppStore((state) => state.worktreeFileDiffs);
  const selectedReviewFiles = useAppStore((state) => state.selectedReviewFiles);
  const createApproval = useAppStore((state) => state.createApproval);
  const createWorktree = useAppStore((state) => state.createWorktree);
  const removeWorktree = useAppStore((state) => state.removeWorktree);
  const loadWorktreeStatus = useAppStore((state) => state.loadWorktreeStatus);
  const loadWorktreeReview = useAppStore((state) => state.loadWorktreeReview);
  const loadWorktreeCommits = useAppStore((state) => state.loadWorktreeCommits);
  const loadWorktreeHandoff = useAppStore((state) => state.loadWorktreeHandoff);
  const loadWorktreeChangedFiles = useAppStore((state) => state.loadWorktreeChangedFiles);
  const loadCodexCliStatus = useAppStore((state) => state.loadCodexCliStatus);
  const startTerminal = useAppStore((state) => state.startTerminal);
  const setEmployeeStandby = useAppStore((state) => state.setEmployeeStandby);
  const resumeEmployeeFromStandby = useAppStore((state) => state.resumeEmployeeFromStandby);
  const stopTerminalSession = useAppStore((state) => state.stopTerminalSession);
  const renameTerminalSession = useAppStore((state) => state.renameTerminalSession);
  const removeEmployee = useAppStore((state) => state.removeEmployee);
  const spawnProcess = useAppStore((state) => state.spawnProcess);

  useEffect(() => {
    if (selectedEmployee?.worktreePath) {
      void loadWorktreeStatus(selectedEmployee.id);
      void loadWorktreeReview(selectedEmployee.id);
      void loadWorktreeCommits(selectedEmployee.id);
      void loadWorktreeHandoff(selectedEmployee.id);
      void loadWorktreeChangedFiles(selectedEmployee.id);
    }
  }, [
    loadWorktreeCommits,
    loadWorktreeChangedFiles,
    loadWorktreeHandoff,
    loadWorktreeReview,
    loadWorktreeStatus,
    selectedEmployee?.id,
    selectedEmployee?.worktreePath,
  ]);

  const panelHeader = (
    <div className="details-header">
      <div className="brand-mark">
        <Code2 size={18} />
      </div>
      <div>
        <h1>Slavey</h1>
        <p>{backendReady ? "workspace online" : "waiting for backend"}</p>
      </div>
    </div>
  );
  const showDashboard = activeTab !== "office";

  if (!selectedEmployee) {
    return (
      <div className="details-shell">
        {panelHeader}
        {showDashboard ? <EmployeeDashboard /> : null}
        <div className="details-empty">
          <h2>No employee selected</h2>
          <p>Create or select an employee to attach tools.</p>
        </div>
      </div>
    );
  }

  const employeeApprovals = approvals.filter(
    (approval) => approval.employeeId === selectedEmployee.id,
  );
  const pendingApprovals = employeeApprovals.filter((approval) => approval.status === "pending");
  const activity = employeeActivities[selectedEmployee.id] ?? null;
  const displayStatus = displayStatusFor(selectedEmployee, activity, pendingApprovals.length);
  const worktreeStatus = worktreeStatuses[selectedEmployee.id];
  const repoHealth = workspaceInfo?.repoHealth ?? null;
  const worktreeDisabledReason = worktreeCreateDisabledReason(
    selectedEmployee.worktreePath,
    repoHealth,
  );
  const worktreeReview = worktreeReviews[selectedEmployee.id];
  const employeeCommits = worktreeCommits[selectedEmployee.id] ?? [];
  const handoff = worktreeHandoffs[selectedEmployee.id];
  const handoffResult = worktreeHandoffResults[selectedEmployee.id];
  const employeeActions = actions.filter((action) => action.employeeId === selectedEmployee.id);
  const employeeProcesses = processes.filter(
    (process) => !process.employeeId || process.employeeId === selectedEmployee.id,
  );
  const recentSessions = terminalSessions
    .filter((session) => session.employeeId === selectedEmployee.id)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5);
  const activeSession = selectedEmployee.terminalSessionId
    ? terminalSessions.find(
        (session) => session.sessionId === selectedEmployee.terminalSessionId,
      ) ?? null
    : null;
  const rolePolicy = rolePolicies.find((policy) => policy.role === selectedEmployee.role);
  const activeSessionReason = selectedEmployee.terminalSessionId
    ? "Employee already has an active terminal session"
    : null;

  return (
    <div className="details-shell">
      {panelHeader}
      {showDashboard ? <EmployeeDashboard /> : null}
      <div className="details-stack">
        <div>
          <h2>{selectedEmployee.name}</h2>
          <p>{selectedEmployee.role}</p>
        </div>
        <div className={`status-pill ${displayStatus}`}>{formatLabel(displayStatus)}</div>
        <dl className="detail-list">
          <div>
            <dt>Activity</dt>
            <dd title={activity?.details ?? ""}>{activity?.label ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Activity state</dt>
            <dd>{activity?.status.replaceAll("_", " ") ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Review counts</dt>
            <dd>
              {activity
                ? `${activity.reviewCounts.changedFiles} changed, ${activity.reviewCounts.stagedFiles} staged, ${activity.reviewCounts.untrackedFiles} untracked`
                : "unknown"}
            </dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>{selectedEmployee.worktreePath ? "isolated worktree" : "root workspace"}</dd>
          </div>
          <div>
            <dt>CWD</dt>
            <dd title={selectedEmployee.cwd}>{selectedEmployee.cwd}</dd>
          </div>
          <div>
            <dt>Worktree</dt>
            <dd title={selectedEmployee.worktreePath ?? ""}>
              {selectedEmployee.worktreePath ?? "No worktree created"}
            </dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{selectedEmployee.branchName ?? "none"}</dd>
          </div>
          <div>
            <dt>Worktree status</dt>
            <dd>
              {selectedEmployee.worktreePath
                ? worktreeStatus
                  ? worktreeStatus.dirty
                    ? "dirty"
                    : "clean"
                  : "loading"
                : "none"}
            </dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{selectedEmployee.terminalSessionId ?? "none"}</dd>
          </div>
          <div>
            <dt>Command</dt>
            <dd>{selectedEmployee.currentCommand ?? "none"}</dd>
          </div>
          <div>
            <dt>Codex CLI</dt>
            <dd
              className="codex-status-line"
              title={codexStatusTitle(codexCliStatus, codexCliStatusLoading)}
            >
              <span>{codexStatusLabel(codexCliStatus, codexCliStatusLoading)}</span>
              <button
                className="icon-button mini"
                disabled={codexCliStatusLoading}
                title="Recheck Codex CLI"
                onClick={() => void loadCodexCliStatus()}
              >
                <RefreshCw size={13} />
              </button>
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{new Date(selectedEmployee.updatedAt).toLocaleTimeString()}</dd>
          </div>
        </dl>
        {rolePolicy ? (
          <section className="policy-panel">
            <div className="section-heading">
              <ShieldQuestion size={15} />
              Role policy
            </div>
            <div className="policy-grid">
              <span>Actions</span>
              <strong>{rolePolicy.defaultActionKinds.map(formatLabel).join(", ")}</strong>
              <span>Shell approval</span>
              <strong>{rolePolicy.requiresApprovalForShell ? "required" : "optional"}</strong>
              <span>File approval</span>
              <strong>{rolePolicy.requiresApprovalForFileWrite ? "required" : "optional"}</strong>
              <span>Review</span>
              <strong>{rolePolicy.canReview ? "enabled" : "disabled"}</strong>
            </div>
          </section>
        ) : null}
        <div className="control-grid">
          <button
            className="command-button primary"
            disabled={Boolean(selectedEmployee.terminalSessionId)}
            title={activeSessionReason ?? "Start shell"}
            onClick={() => void startTerminal(selectedEmployee.id)}
          >
            Start shell
          </button>
          <button
            className="command-button"
            disabled={!selectedEmployee.terminalSessionId}
            onClick={() =>
              selectedEmployee.terminalSessionId &&
              void stopTerminalSession(selectedEmployee.id, selectedEmployee.terminalSessionId)
            }
          >
            Stop
          </button>
          {selectedEmployee.status === "standby" ? (
            <button
              className="command-button"
              onClick={() => void resumeEmployeeFromStandby(selectedEmployee.id)}
            >
              Resume
            </button>
          ) : (
            <button
              className="command-button"
              onClick={() => void setEmployeeStandby(selectedEmployee.id)}
            >
              Standby
            </button>
          )}
          <button
            className="command-button"
            disabled={Boolean(worktreeDisabledReason)}
            onClick={() => void createWorktree(selectedEmployee.id)}
            title={worktreeDisabledReason ?? "Create isolated worktree"}
          >
            <GitBranch size={14} />
            Worktree
          </button>
          <button
            className="command-button"
            disabled={!selectedEmployee.worktreePath || Boolean(worktreeStatus?.dirty)}
            onClick={() => void removeWorktree(selectedEmployee.id)}
            title={worktreeStatus?.dirty ? "Worktree has uncommitted changes" : "Remove clean worktree"}
          >
            Remove tree
          </button>
          <button
            className="command-button danger"
            disabled={Boolean(selectedEmployee.worktreePath)}
            onClick={() => void removeEmployee(selectedEmployee.id)}
            title={
              selectedEmployee.worktreePath
                ? "Remove or archive the worktree before deleting employee"
                : "Remove employee"
            }
          >
            Remove
          </button>
        </div>
        {codexCliStatus?.available === false ? (
          <div className="inline-warning">{codexCliStatus.message}</div>
        ) : null}
        {activeSessionReason ? (
          <div className="inline-note">{activeSessionReason}.</div>
        ) : null}
        {worktreeDisabledReason && !selectedEmployee.worktreePath ? (
          <div className="inline-warning">{worktreeDisabledReason}</div>
        ) : null}
        {activity?.blockers.length ? (
          <div className="handoff-blockers">
            {activity.blockers.map((blocker) => (
              <div className="inline-warning" key={blocker}>
                {blocker}
              </div>
            ))}
          </div>
        ) : null}
        {selectedEmployee.worktreePath && worktreeStatus?.dirty ? (
          <div className="inline-warning">
            Worktree has uncommitted changes; removal is disabled until review is clean.
          </div>
        ) : null}
        <ApprovalPanel
          employeeId={selectedEmployee.id}
          approvals={employeeApprovals}
          onCreate={() =>
            void createApproval({
              employeeId: selectedEmployee.id,
              kind: "shell_command",
              title: "Review shell command",
              description: "Foundation approval request for a future gated shell command.",
              command: "echo pending approval",
              cwd: selectedEmployee.cwd,
            })
          }
        />
        <CodexTaskPanel employee={selectedEmployee} activeSession={activeSession} />
        <ActionPanel employeeId={selectedEmployee.id} cwd={selectedEmployee.cwd} actions={employeeActions} />
        <TerminalSessionHistory
          activeSessionId={selectedEmployee.terminalSessionId ?? null}
          sessions={recentSessions}
          onStop={(session) => void stopTerminalSession(session.employeeId, session.sessionId)}
          onRename={(session) => {
            const label = window.prompt("Session label", session.label);
            if (label?.trim()) {
              void renameTerminalSession(session.employeeId, session.sessionId, label);
            }
          }}
        />
        <ProcessPanel
          processes={employeeProcesses}
          onSpawn={() =>
            void spawnProcess(
              selectedEmployee.id,
              "while true; do date; sleep 2; done",
              selectedEmployee.cwd,
              "Clock loop",
            )
          }
        />
        {selectedEmployee.worktreePath ? (
          <ReviewPanel
            employeeId={selectedEmployee.id}
            review={worktreeReview}
            changedFiles={worktreeChangedFiles[selectedEmployee.id] ?? []}
            selectedFile={selectedReviewFiles[selectedEmployee.id] ?? null}
            fileDiffs={worktreeFileDiffs}
            commits={employeeCommits}
            handoff={handoff}
            handoffResult={handoffResult}
            repoHealth={repoHealth}
            onRefresh={() => {
              void loadWorktreeStatus(selectedEmployee.id);
              void loadWorktreeReview(selectedEmployee.id);
              void loadWorktreeCommits(selectedEmployee.id);
              void loadWorktreeHandoff(selectedEmployee.id);
              void loadWorktreeChangedFiles(selectedEmployee.id);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function CodexTaskPanel({
  employee,
  activeSession,
}: {
  employee: Employee;
  activeSession: TerminalSessionRecord | null;
}) {
  const submitCodexTask = useAppStore((state) => state.submitCodexTask);
  const [prompt, setPrompt] = useState("");
  const trimmedPrompt = prompt.trim();
  const appServerSession =
    activeSession?.runtime === "codex_app_server" ? activeSession : null;
  const blockedByTerminal =
    activeSession && activeSession.runtime !== "codex_app_server"
      ? "Stop the active terminal session before starting Codex app-server"
      : null;
  const disabledReason =
    blockedByTerminal ??
    (trimmedPrompt ? null : "Enter a Codex instruction");

  return (
    <section className="codex-task-panel">
      <div className="section-heading">
        <Bot size={15} />
        Codex
      </div>
      <div className="codex-task-input-row">
        <textarea
          className="codex-task-input"
          value={prompt}
          placeholder="Implement the next backend change..."
          rows={4}
          disabled={Boolean(blockedByTerminal)}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button
          className="command-button primary"
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? (appServerSession ? "Send to Codex" : "Start Codex")}
          onClick={() => {
            if (!trimmedPrompt || blockedByTerminal) {
              return;
            }
            void submitCodexTask({
              employeeId: employee.id,
              sessionId: appServerSession?.sessionId ?? null,
              prompt: trimmedPrompt,
            });
            setPrompt("");
          }}
        >
          <Send size={14} />
          {appServerSession ? "Send" : "Start"}
        </button>
      </div>
      {blockedByTerminal ? <div className="inline-note">{blockedByTerminal}.</div> : null}
    </section>
  );
}

function displayStatusFor(
  employee: Employee,
  activity: EmployeeActivity | null,
  pendingApprovals: number,
): string {
  if (activity) {
    return resolveEmployeeActivityContractView(activity).state;
  }

  if (employee.status === "standby") {
    return "standby";
  }
  if (employee.status === "stopped") {
    return "stopped";
  }
  return pendingApprovals > 0 ? "waiting_approval" : employee.status;
}

function TerminalSessionHistory({
  activeSessionId,
  sessions,
  onStop,
  onRename,
}: {
  activeSessionId: string | null;
  sessions: TerminalSessionRecord[];
  onStop: (session: TerminalSessionRecord) => void;
  onRename: (session: TerminalSessionRecord) => void;
}) {
  return (
    <section className="session-panel">
      <div className="section-heading compact-heading">
        <History size={15} />
        Sessions
      </div>
      {sessions.length === 0 ? (
        <div className="empty-panel">No terminal sessions yet.</div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => (
            <div
              className={
                session.sessionId === activeSessionId
                  ? `session-item active ${session.status}`
                  : `session-item ${session.status}`
              }
              key={session.sessionId}
            >
              <div className="action-title">
                <strong title={session.sessionId}>{session.label}</strong>
                <span>{session.status}</span>
              </div>
              <code title={session.cwd}>{session.cwd}</code>
              <div className="session-meta">
                <span>{formatLabel(session.profile)}</span>
                <span>
                  {formatTimestamp(session.startedAt)} -{" "}
                  {session.stoppedAt ?? session.endedAt
                    ? formatTimestamp(session.stoppedAt ?? session.endedAt ?? 0)
                    : "active"}
                </span>
                <span>{session.stopReason?.replaceAll("_", " ") ?? "active"}</span>
                {session.exitCode !== null && session.exitCode !== undefined ? (
                  <span>exit {session.exitCode}</span>
                ) : null}
              </div>
              {session.message ? <p>{session.message}</p> : null}
              <div className="session-actions">
                <button
                  className="icon-button mini"
                  title="Rename session"
                  onClick={() => onRename(session)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-button mini"
                  disabled={session.status !== "running"}
                  title={session.status === "running" ? "Stop session" : "Session is not running"}
                  onClick={() => onStop(session)}
                >
                  <Square size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
