import { useEffect } from "react";
import {
  Check,
  Code2,
  FileCode2,
  GitBranch,
  ListTree,
  Plus,
  ShieldQuestion,
  TerminalSquare,
  X,
} from "lucide-react";

import { EmployeeDashboard } from "./components/EmployeeDashboard";
import { EditorPane } from "./components/EditorPane";
import { TerminalPane } from "./components/TerminalPane";
import { useAppStore } from "./store/appStore";
import type { Action, ApprovalRequest } from "./types";

export default function App() {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const logs = useAppStore((state) => state.logs);
  const createEmployee = useAppStore((state) => state.createEmployee);
  const backendReady = useAppStore((state) => state.backendReady);

  useEffect(() => {
    let disposed = false;
    let cleanup: Array<() => void> = [];

    void useAppStore
      .getState()
      .connectEvents()
      .then((unlisten) => {
        if (disposed) {
          unlisten.forEach((item) => item());
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        useAppStore.getState().addLog({
          id: crypto.randomUUID(),
          level: "warn",
          message: `event bridge unavailable: ${String(error)}`,
          timestamp: Date.now(),
        });
      });

    void useAppStore.getState().bootstrap();

    return () => {
      disposed = true;
      cleanup.forEach((item) => item());
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-mark">
            <Code2 size={18} />
          </div>
          <div>
            <h1>Slavey</h1>
            <p>{backendReady ? "workspace online" : "waiting for backend"}</p>
          </div>
          <button
            className="icon-button"
            title="Create general employee"
            onClick={() =>
              void createEmployee({
                name: nextEmployeeName(),
                role: "general",
              })
            }
          >
            <Plus size={17} />
          </button>
        </div>
        <EmployeeDashboard />
      </aside>

      <main className="workbench">
        <div className="tab-strip" role="tablist" aria-label="Workspace">
          <button
            className={activeTab === "terminal" ? "tab active" : "tab"}
            onClick={() => setActiveTab("terminal")}
          >
            <TerminalSquare size={16} />
            Terminal
          </button>
          <button
            className={activeTab === "editor" ? "tab active" : "tab"}
            onClick={() => setActiveTab("editor")}
          >
            <FileCode2 size={16} />
            Editor
          </button>
        </div>
        <section className="workspace-panel">
          {activeTab === "terminal" ? <TerminalPane /> : <EditorPane />}
        </section>
      </main>

      <aside className="details-panel">
        <EmployeeDetails />
      </aside>

      <section className="event-log">
        <div className="log-header">
          <ListTree size={15} />
          Events
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="empty-line">No events yet</div>
          ) : (
            logs.map((log) => (
              <div className={`log-line ${log.level}`} key={log.id}>
                <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                <strong>{log.level}</strong>
                <p>{log.message}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function EmployeeDetails() {
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const approvals = useAppStore((state) => state.approvals);
  const actions = useAppStore((state) => state.actions);
  const rolePolicies = useAppStore((state) => state.rolePolicies);
  const worktreeStatuses = useAppStore((state) => state.worktreeStatuses);
  const worktreeDiffs = useAppStore((state) => state.worktreeDiffs);
  const createApproval = useAppStore((state) => state.createApproval);
  const createWorktree = useAppStore((state) => state.createWorktree);
  const removeWorktree = useAppStore((state) => state.removeWorktree);
  const loadWorktreeStatus = useAppStore((state) => state.loadWorktreeStatus);
  const loadWorktreeDiff = useAppStore((state) => state.loadWorktreeDiff);
  const startTerminal = useAppStore((state) => state.startTerminal);
  const stopTerminal = useAppStore((state) => state.stopTerminal);
  const removeEmployee = useAppStore((state) => state.removeEmployee);

  useEffect(() => {
    if (selectedEmployee?.worktreePath) {
      void loadWorktreeStatus(selectedEmployee.id);
      void loadWorktreeDiff(selectedEmployee.id);
    }
  }, [loadWorktreeDiff, loadWorktreeStatus, selectedEmployee?.id, selectedEmployee?.worktreePath]);

  if (!selectedEmployee) {
    return (
      <div className="details-empty">
        <h2>No employee</h2>
        <p>Create or select an employee to attach tools.</p>
      </div>
    );
  }

  const employeeApprovals = approvals.filter(
    (approval) => approval.employeeId === selectedEmployee.id,
  );
  const pendingApprovals = employeeApprovals.filter(
    (approval) => approval.status === "pending",
  );
  const displayStatus =
    pendingApprovals.length > 0 ? "waiting_approval" : selectedEmployee.status;
  const worktreeStatus = worktreeStatuses[selectedEmployee.id];
  const worktreeDiff = worktreeDiffs[selectedEmployee.id] ?? "";
  const employeeActions = actions.filter(
    (action) => action.employeeId === selectedEmployee.id,
  );
  const rolePolicy = rolePolicies.find((policy) => policy.role === selectedEmployee.role);

  return (
    <div className="details-stack">
      <div>
        <h2>{selectedEmployee.name}</h2>
        <p>{selectedEmployee.role}</p>
      </div>
      <div className={`status-pill ${displayStatus}`}>
        {displayStatus.replace("_", " ")}
      </div>
      <dl className="detail-list">
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
              ? worktreeStatus?.dirty
                ? "dirty"
                : "clean"
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
            <strong>
              {rolePolicy.defaultActionKinds.map(formatLabel).join(", ")}
            </strong>
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
          onClick={() => void startTerminal(selectedEmployee.id)}
        >
          Start shell
        </button>
        <button
          className="command-button"
          disabled={!selectedEmployee.terminalSessionId}
          onClick={() => void stopTerminal(selectedEmployee.id)}
        >
          Stop
        </button>
        <button
          className="command-button"
          disabled={Boolean(selectedEmployee.worktreePath)}
          onClick={() => void createWorktree(selectedEmployee.id)}
        >
          <GitBranch size={14} />
          Worktree
        </button>
        <button
          className="command-button"
          disabled={!selectedEmployee.worktreePath || Boolean(worktreeStatus?.dirty)}
          onClick={() => void removeWorktree(selectedEmployee.id)}
          title={
            worktreeStatus?.dirty
              ? "Worktree has uncommitted changes"
              : "Remove clean worktree"
          }
        >
          Remove tree
        </button>
        <button
          className="command-button danger"
          onClick={() => void removeEmployee(selectedEmployee.id)}
        >
          Remove
        </button>
      </div>
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
      <ActionPanel employeeId={selectedEmployee.id} cwd={selectedEmployee.cwd} actions={employeeActions} />
      {selectedEmployee.worktreePath ? (
        <section className="diff-panel">
          <div className="section-heading">
            <GitBranch size={15} />
            Diff
            <button
              className="icon-button"
              title="Refresh diff"
              onClick={() => void loadWorktreeDiff(selectedEmployee.id)}
            >
              <ListTree size={14} />
            </button>
          </div>
          <pre>{worktreeDiff.trim() || "No worktree diff."}</pre>
        </section>
      ) : null}
    </div>
  );
}

function ActionPanel({
  employeeId,
  cwd,
  actions,
}: {
  employeeId: string;
  cwd: string;
  actions: Action[];
}) {
  const createAction = useAppStore((state) => state.createAction);
  const requestActionApproval = useAppStore((state) => state.requestActionApproval);
  const approveAction = useAppStore((state) => state.approveAction);
  const rejectAction = useAppStore((state) => state.rejectAction);
  const runAction = useAppStore((state) => state.runAction);

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
        <button
          className="command-button compact"
          onClick={() =>
            void createAction({
              employeeId,
              kind: "file_write",
              title: "Write action test file",
              description: "Write a timestamped file through the safe action runner.",
              path: ".slavey/action-test.txt",
              contents: `Action test ${new Date().toISOString()}\n`,
              cwd,
            })
          }
        >
          File test
        </button>
      </div>
      {actions.length === 0 ? (
        <div className="empty-panel">No actions for this employee.</div>
      ) : (
        <div className="action-list">
          {actions.map((action) => (
            <div className={`action-item ${action.status}`} key={action.id}>
              <div className="action-title">
                <strong>{action.title}</strong>
                <span>{action.status.replace("_", " ")}</span>
              </div>
              <p>{action.description}</p>
              <code title={action.command ?? action.path ?? action.kind}>
                {action.command ?? action.path ?? action.kind}
              </code>
              <div className="approval-actions">
                <button
                  className="command-button compact"
                  disabled={action.status !== "draft"}
                  onClick={() => void requestActionApproval(action.id)}
                >
                  Request
                </button>
                <button
                  className="icon-button"
                  disabled={action.status !== "pending_approval"}
                  title="Approve"
                  onClick={() => void approveAction(action.id)}
                >
                  <Check size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={!["pending_approval", "approved"].includes(action.status)}
                  title="Reject"
                  onClick={() => void rejectAction(action.id)}
                >
                  <X size={14} />
                </button>
                <button
                  className="command-button compact"
                  disabled={action.status !== "approved"}
                  onClick={() => void runAction(action.id)}
                >
                  Run
                </button>
              </div>
              {action.output || action.error ? (
                <pre>{action.output || action.error}</pre>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ApprovalPanel({
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
  const pending = approvals.filter((approval) => approval.status === "pending");

  return (
    <section className="approval-panel">
      <div className="section-heading">
        <ShieldQuestion size={15} />
        Approvals
        <button className="icon-button" title="Create approval request" onClick={onCreate}>
          <Plus size={14} />
        </button>
      </div>
      {pending.length === 0 ? (
        <div className="empty-panel">No approvals pending for this employee.</div>
      ) : (
        <div className="approval-list">
          {pending.map((approval) => (
            <div className="approval-item" key={approval.id}>
              <strong>{approval.title}</strong>
              <p>{approval.description}</p>
              <code title={approval.command ?? approval.path ?? employeeId}>
                {approval.command ?? approval.path ?? approval.kind}
              </code>
              <div className="approval-actions">
                <button
                  className="icon-button"
                  title="Approve"
                  onClick={() => void approveApproval(approval.id)}
                >
                  <Check size={14} />
                </button>
                <button
                  className="icon-button"
                  title="Reject"
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

function nextEmployeeName(): string {
  const count = useAppStore.getState().employees.length + 1;
  return `Employee ${count}`;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}
