import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Code2,
  FileCode2,
  FolderOpen,
  GitBranch,
  History,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldQuestion,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";

import { EmployeeDashboard } from "./components/EmployeeDashboard";
import { EditorPane } from "./components/EditorPane";
import { TerminalPane } from "./components/TerminalPane";
import { useAppStore } from "./store/appStore";
import type {
  Action,
  ActionStatus,
  AppSettings,
  ApprovalRequest,
  RepoHealth,
  TerminalSessionRecord,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
} from "./types";

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
          <button
            className={activeTab === "settings" ? "tab active" : "tab"}
            onClick={() => setActiveTab("settings")}
          >
            <Settings2 size={16} />
            Settings
          </button>
        </div>
        <section className="workspace-panel">
          {activeTab === "terminal" ? (
            <TerminalPane />
          ) : activeTab === "editor" ? (
            <EditorPane />
          ) : (
            <SettingsPane />
          )}
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

function SettingsPane() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const workspaceInfo = useAppStore((state) => state.workspaceInfo);
  const recentWorkspaces = useAppStore((state) => state.recentWorkspaces);
  const settings = useAppStore((state) => state.settings);
  const workspaceLoading = useAppStore((state) => state.workspaceLoading);
  const workspaceError = useAppStore((state) => state.workspaceError);
  const setWorkspaceRoot = useAppStore((state) => state.setWorkspaceRoot);
  const loadWorkspaceInfo = useAppStore((state) => state.loadWorkspaceInfo);
  const clearRecentWorkspaces = useAppStore((state) => state.clearRecentWorkspaces);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const addLog = useAppStore((state) => state.addLog);
  const [pathInput, setPathInput] = useState(workspaceRoot ?? "");

  useEffect(() => {
    setPathInput(workspaceRoot ?? "");
  }, [workspaceRoot]);

  const health = workspaceInfo?.repoHealth ?? null;

  const pickWorkspace = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await setWorkspaceRoot(selected);
      }
    } catch (error) {
      addLog({
        id: crypto.randomUUID(),
        level: "warn",
        message: `workspace picker failed: ${String(error)}`,
        timestamp: Date.now(),
      });
    }
  };

  return (
    <div className="settings-pane">
      <section className="workspace-settings-panel">
        <div className="pane-toolbar settings-toolbar">
          <div className="toolbar-title">
            <Settings2 size={16} />
            Workspace
          </div>
          <button
            className="icon-button"
            disabled={workspaceLoading}
            title="Refresh workspace health"
            onClick={() => void loadWorkspaceInfo()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="settings-content">
          <div className="workspace-open-row">
            <button
              className="command-button primary"
              disabled={workspaceLoading}
              onClick={() => void pickWorkspace()}
            >
              <FolderOpen size={15} />
              Open workspace
            </button>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="/absolute/path/to/repo"
              aria-label="Workspace path"
            />
            <button
              className="command-button"
              disabled={workspaceLoading || pathInput.trim().length === 0}
              onClick={() => void setWorkspaceRoot(pathInput)}
            >
              Open
            </button>
          </div>

          <div className="settings-grid">
            <span>Current root</span>
            <strong title={workspaceRoot ?? ""}>{workspaceRoot ?? "none"}</strong>
            <span>Directory</span>
            <strong>{health?.isExistingDirectory ? "exists" : "missing"}</strong>
            <span>Git repo</span>
            <strong>{health?.isGitRepo ? "available" : "unavailable"}</strong>
            <span>Repo root</span>
            <strong title={health?.repoRoot ?? ""}>{health?.repoRoot ?? "none"}</strong>
            <span>Branch</span>
            <strong>{health?.currentBranch ?? "detached or unknown"}</strong>
            <span>Status</span>
            <strong>{health ? (health.dirty ? "dirty" : "clean") : "unknown"}</strong>
            <span>Git identity</span>
            <strong>{identityLabel(health)}</strong>
            <span>Worktrees</span>
            <strong title={health?.worktreeSupportMessage ?? ""}>
              {health?.worktreeSupported ? "available" : "unavailable"}
            </strong>
            <span>Codex CLI</span>
            <strong title={health?.codexCliStatus.message ?? ""}>
              {health ? codexStatusLabel(health.codexCliStatus, false) : "unknown"}
            </strong>
          </div>

          {workspaceInfo?.switchBlockers.length ? (
            <div className="handoff-blockers">
              {workspaceInfo.switchBlockers.map((blocker) => (
                <div className="inline-warning" key={blocker}>
                  {blocker}
                </div>
              ))}
            </div>
          ) : null}

          {workspaceError ? (
            <div className="inline-warning">{workspaceError}</div>
          ) : null}

          <WorkspaceFeatureBlockers health={health} />

          <section className="settings-section">
            <div className="section-heading compact-heading">
              <History size={15} />
              Recent
            </div>
            <div className="recent-workspace-list">
              {recentWorkspaces.length === 0 ? (
                <div className="empty-panel">No recent workspaces.</div>
              ) : (
                recentWorkspaces.map((recent) => (
                  <button
                    className="recent-workspace"
                    key={recent}
                    disabled={workspaceLoading || recent === workspaceRoot}
                    title={recent}
                    onClick={() => void setWorkspaceRoot(recent)}
                  >
                    <span>{recent}</span>
                  </button>
                ))
              )}
            </div>
            <button
              className="command-button compact"
              disabled={recentWorkspaces.length === 0}
              onClick={() => void clearRecentWorkspaces()}
            >
              Clear recent
            </button>
          </section>

          <SettingsForm settings={settings} onChange={updateSettings} />
        </div>
      </section>
    </div>
  );
}

function WorkspaceFeatureBlockers({ health }: { health: RepoHealth | null }) {
  if (!health) {
    return null;
  }
  const blockers = [
    ...health.worktreeBlockers.map((blocker) => `Worktree: ${blocker}`),
    ...health.handoffBlockers.map((blocker) => `Handoff: ${blocker}`),
  ];
  if (blockers.length === 0) {
    return null;
  }
  return (
    <div className="handoff-blockers">
      {blockers.map((blocker) => (
        <div className="inline-warning" key={blocker}>
          {blocker}
        </div>
      ))}
    </div>
  );
}

function SettingsForm({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: Partial<AppSettings>) => Promise<void>;
}) {
  return (
    <section className="settings-section">
      <div className="section-heading compact-heading">
        <Settings2 size={15} />
        Safety
      </div>
      <div className="settings-form">
        <label>
          <span>Default terminal</span>
          <select
            value={settings.defaultTerminalProfile}
            onChange={(event) =>
              void onChange({
                defaultTerminalProfile: event.target.value as AppSettings["defaultTerminalProfile"],
              })
            }
          >
            <option value="shell">shell</option>
            <option value="codex">codex</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.requireConfirmationDiscard}
            onChange={(event) =>
              void onChange({ requireConfirmationDiscard: event.target.checked })
            }
          />
          <span>Confirm discard</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.requireConfirmationDelete}
            onChange={(event) =>
              void onChange({ requireConfirmationDelete: event.target.checked })
            }
          />
          <span>Confirm delete</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.requireConfirmationHandoffApply}
            onChange={(event) =>
              void onChange({ requireConfirmationHandoffApply: event.target.checked })
            }
          />
          <span>Confirm handoff apply</span>
        </label>
        <label>
          <span>Terminal buffer</span>
          <input
            type="number"
            min={20000}
            max={2000000}
            step={10000}
            value={settings.maxTerminalBufferChars}
            onChange={(event) =>
              void onChange({ maxTerminalBufferChars: Number(event.target.value) })
            }
          />
        </label>
      </div>
    </section>
  );
}

function EmployeeDetails() {
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
  const startCodexTerminal = useAppStore((state) => state.startCodexTerminal);
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
  const repoHealth = workspaceInfo?.repoHealth ?? null;
  const worktreeDisabledReason = worktreeCreateDisabledReason(
    selectedEmployee.worktreePath,
    repoHealth,
  );
  const worktreeReview = worktreeReviews[selectedEmployee.id];
  const employeeCommits = worktreeCommits[selectedEmployee.id] ?? [];
  const handoff = worktreeHandoffs[selectedEmployee.id];
  const handoffResult = worktreeHandoffResults[selectedEmployee.id];
  const employeeActions = actions.filter(
    (action) => action.employeeId === selectedEmployee.id,
  );
  const employeeProcesses = processes.filter(
    (process) => !process.employeeId || process.employeeId === selectedEmployee.id,
  );
  const recentSessions = terminalSessions
    .filter((session) => session.employeeId === selectedEmployee.id)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5);
  const rolePolicy = rolePolicies.find((policy) => policy.role === selectedEmployee.role);
  const activity = employeeActivities[selectedEmployee.id] ?? null;
  const activeSessionReason = selectedEmployee.terminalSessionId
    ? "Employee already has an active terminal session"
    : null;

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
          <dt>Codex CLI</dt>
          <dd className="codex-status-line" title={codexCliStatus?.message ?? "Checking Codex CLI"}>
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
          title={activeSessionReason ?? "Start shell"}
          onClick={() => void startTerminal(selectedEmployee.id)}
        >
          Start shell
        </button>
        <button
          className="command-button primary"
          disabled={Boolean(selectedEmployee.terminalSessionId) || codexCliStatus?.available !== true}
          onClick={() => void startCodexTerminal(selectedEmployee.id)}
          title={
            activeSessionReason ??
            (codexCliStatus?.available === false
              ? codexCliStatus.message
              : codexCliStatusLoading || !codexCliStatus
                ? "Checking Codex CLI"
                : "Start Codex")
          }
        >
          Start Codex
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
  );
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

function ReviewPanel({
  employeeId,
  review,
  changedFiles,
  selectedFile,
  fileDiffs,
  commits,
  handoff,
  handoffResult,
  repoHealth,
  onRefresh,
}: {
  employeeId: string;
  review?: WorktreeReview;
  changedFiles: string[];
  selectedFile: string | null;
  fileDiffs: Record<string, string>;
  commits: WorktreeCommit[];
  handoff?: WorktreeHandoffPreflight;
  handoffResult?: WorktreeHandoffApplyResult;
  repoHealth: RepoHealth | null;
  onRefresh: () => void;
}) {
  const settings = useAppStore((state) => state.settings);
  const [commitMessage, setCommitMessage] = useState("");
  const selectReviewFile = useAppStore((state) => state.selectReviewFile);
  const stageWorktreeFile = useAppStore((state) => state.stageWorktreeFile);
  const unstageWorktreeFile = useAppStore((state) => state.unstageWorktreeFile);
  const discardWorktreeFile = useAppStore((state) => state.discardWorktreeFile);
  const deleteUntrackedWorktreeFile = useAppStore((state) => state.deleteUntrackedWorktreeFile);
  const commitWorktree = useAppStore((state) => state.commitWorktree);
  const applyWorktreeHandoff = useAppStore((state) => state.applyWorktreeHandoff);
  const abortWorktreeHandoff = useAppStore((state) => state.abortWorktreeHandoff);
  const selectedReviewFile = selectedFile
    ? review?.files.find((file) => file.path === selectedFile) ?? null
    : null;
  const fileDiff = selectedFile ? fileDiffs[reviewFileKey(employeeId, selectedFile)] ?? "" : "";
  const canStage = Boolean(selectedFile && !selectedReviewFile?.conflicted);
  const canUnstage = Boolean(
    selectedFile && selectedReviewFile?.staged && !selectedReviewFile.conflicted,
  );
  const canDiscard = Boolean(
    selectedFile && selectedReviewFile?.unstaged && !selectedReviewFile.conflicted,
  );
  const canDeleteUntracked = Boolean(selectedFile && selectedReviewFile?.untracked);
  const commitDisabledReason = review?.disabledReasons.commit ?? null;
  const canCommit = !commitDisabledReason && commitMessage.trim().length > 0;
  const reviewHandoff = review?.handoff ?? handoff;
  const latestCommit = (review?.recentCommits ?? commits)[0] ?? null;
  const commitsToApply = reviewHandoff?.commitsToApply ?? [];
  const handoffDisabledReason =
    review?.disabledReasons.handoffApply ?? handoffApplyDisabledReason(repoHealth, reviewHandoff);
  const canApplyHandoff = reviewHandoff?.canApply === true && !handoffDisabledReason;
  const canAbortHandoff = reviewHandoff?.mainOperation.canAbort === true;
  const groupedFiles = reviewFileGroups(review, changedFiles);
  const hasReviewConflicts = Boolean(
    review?.conflictedFiles.length || reviewHandoff?.mainConflictedFiles.length,
  );

  const runCommit = async () => {
    const message = commitMessage.trim();
    if (!message) {
      return;
    }
    await commitWorktree(employeeId, message);
    setCommitMessage("");
  };

  const runApplyHandoff = () => {
    if (!reviewHandoff?.canApply || handoffDisabledReason) {
      return;
    }
    const targetBranch = reviewHandoff.mainBranch ?? "main workspace";
    const confirmed =
      !settings.requireConfirmationHandoffApply ||
      window.confirm(
        `Apply ${commitsToApply.length} commit(s) to ${targetBranch} with cherry-pick?\n\nThis will not push or remove the employee worktree.`,
      );
    if (confirmed) {
      void applyWorktreeHandoff(employeeId);
    }
  };

  const runAbortHandoff = () => {
    const confirmed = window.confirm("Abort the in-progress cherry-pick in the main workspace?");
    if (confirmed) {
      void abortWorktreeHandoff(employeeId);
    }
  };

  return (
    <section className="review-panel">
      <div className="section-heading">
        <GitBranch size={15} />
        Review
        <button className="icon-button" title="Refresh review" onClick={onRefresh}>
          <ListTree size={14} />
        </button>
      </div>
      <div className="policy-grid">
        <span>Branch</span>
        <strong title={review?.branchName ?? ""}>{review?.branchName ?? "unknown"}</strong>
        <span>Base</span>
        <strong title={review?.baseBranch ?? ""}>{review?.baseBranch ?? "unknown"}</strong>
        <span>Base delta</span>
        <strong>{formatAheadBehind(review?.ahead, review?.behind)}</strong>
        <span>Upstream</span>
        <strong title={review?.upstreamBranch ?? ""}>{review?.upstreamBranch ?? "none"}</strong>
        <span>Upstream delta</span>
        <strong>{formatAheadBehind(review?.upstreamAhead, review?.upstreamBehind)}</strong>
        <span>Remote</span>
        <strong title={review?.remote.remoteUrl ?? ""}>{review?.remote.remoteName ?? "none"}</strong>
        <span>State</span>
        <strong>{review?.clean ? "clean" : "dirty"}</strong>
        <span>Operation</span>
        <strong>{review?.operation.message ?? "ready"}</strong>
        <span>Push</span>
        <strong>{review?.disabledReasons.push ?? "read-only"}</strong>
      </div>
      {review?.blockers.length ? (
        <div className="handoff-blockers">
          {review.blockers.map((blocker) => (
            <div className="inline-warning" key={blocker}>
              {blocker}
            </div>
          ))}
        </div>
      ) : null}
      {hasReviewConflicts ? (
        <div className="handoff-result warning">
          <strong>Conflict recovery</strong>
          {review?.conflictedFiles.length ? (
            <span>Worktree conflicts: {review.conflictedFiles.join(", ")}</span>
          ) : null}
          {reviewHandoff?.mainConflictedFiles.length ? (
            <span>Main workspace conflicts: {reviewHandoff.mainConflictedFiles.join(", ")}</span>
          ) : null}
          <span>{reviewHandoff?.mainOperation.canAbort ? "Abort is available below." : "Resolve conflicts manually."}</span>
        </div>
      ) : null}
      <div className="review-file-grid">
        <div className="review-file-list">
          {groupedFiles.every((group) => group.files.length === 0) ? (
            <div className="empty-panel">No changed files.</div>
          ) : (
            groupedFiles.map((group) =>
              group.files.length ? (
                <div className="review-file-group" key={group.title}>
                  <span className="review-file-group-title">{group.title}</span>
                  {group.files.map((file) => (
                    <button
                      className={file.path === selectedFile ? "review-file active" : "review-file"}
                      key={`${group.title}-${file.path}`}
                      title={file.path}
                      onClick={() => selectReviewFile(employeeId, file.path)}
                    >
                      <span>{file.path}</span>
                      <strong>{file.label}</strong>
                    </button>
                  ))}
                </div>
              ) : null,
            )
          )}
        </div>
        <div className="review-file-detail">
          <div className="approval-actions">
            <button
              className="command-button compact"
              disabled={!canStage}
              title={selectedReviewFile?.conflicted ? "Resolve conflicts before staging" : "Stage file"}
              onClick={() => selectedFile && void stageWorktreeFile(employeeId, selectedFile)}
            >
              Stage
            </button>
            <button
              className="command-button compact"
              disabled={!canUnstage}
              title={canUnstage ? "Unstage file" : (review?.disabledReasons.commit ?? "Select a staged file")}
              onClick={() => selectedFile && void unstageWorktreeFile(employeeId, selectedFile)}
            >
              Unstage
            </button>
            <button
              className="command-button compact"
              disabled={!canDiscard}
              title={canDiscard ? "Discard unstaged changes" : (review?.disabledReasons.discard ?? "Select an unstaged file")}
              onClick={() => {
                if (
                  selectedFile &&
                  (!settings.requireConfirmationDiscard ||
                    window.confirm(`Discard unstaged changes in ${selectedFile}?`))
                ) {
                  void discardWorktreeFile(employeeId, selectedFile);
                }
              }}
            >
              Discard
            </button>
            <button
              className="command-button compact danger"
              disabled={!canDeleteUntracked}
              title={canDeleteUntracked ? "Delete untracked file" : (review?.disabledReasons.deleteUntracked ?? "Select an untracked file")}
              onClick={() => {
                if (
                  selectedFile &&
                  (!settings.requireConfirmationDelete ||
                    window.confirm(`Delete untracked file ${selectedFile}?`))
                ) {
                  void deleteUntrackedWorktreeFile(employeeId, selectedFile);
                }
              }}
            >
              Delete
            </button>
          </div>
          <ReviewBlock
            title={selectedFile ?? "Selected file"}
            value={fileDiff}
            empty={selectedFile ? "No file diff." : "Select a changed file."}
          />
        </div>
      </div>
      <ReviewBlock
        title="Status"
        value={review?.status.join("\n") ?? ""}
        empty="No status changes."
      />
      <ReviewBlock
        title="Untracked"
        value={review?.untrackedFiles.join("\n") ?? ""}
        empty="No untracked files."
      />
      <div className="commit-panel">
        <input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit message"
          aria-label="Commit message"
        />
        <button
          className="command-button primary compact"
          disabled={!canCommit}
          title={commitDisabledReason ?? "Commit staged files"}
          onClick={() => void runCommit()}
        >
          Commit
        </button>
      </div>
      <div className="handoff-commits">
        {(review?.recentCommits ?? commits).length === 0 ? (
          <div className="empty-panel">No recent commits.</div>
        ) : (
          (review?.recentCommits ?? commits).map((commit) => (
            <div className="handoff-commit" key={commit.hash}>
              <code>{commit.shortHash}</code>
              <span title={commit.message}>{commit.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="handoff-panel">
        <div className="section-heading compact-heading">
          <GitBranch size={15} />
          Handoff
        </div>
        <div className="policy-grid">
          <span>Branch</span>
          <strong title={reviewHandoff?.employeeBranch ?? review?.branchName ?? ""}>
            {reviewHandoff?.employeeBranch ?? review?.branchName ?? "unknown"}
          </strong>
          <span>Main</span>
          <strong title={reviewHandoff?.mainBranch ?? ""}>{reviewHandoff?.mainBranch ?? "unknown"}</strong>
          <span>Strategy</span>
          <strong>{reviewHandoff ? formatStrategy(reviewHandoff.applyStrategy) : "unknown"}</strong>
          <span>Ahead</span>
          <strong>{reviewHandoff?.ahead ?? "unknown"}</strong>
          <span>Behind</span>
          <strong>{reviewHandoff?.behind ?? "unknown"}</strong>
          <span>Employee</span>
          <strong>{reviewHandoff ? (reviewHandoff.employeeClean ? "clean" : "dirty") : "unknown"}</strong>
          <span>Main clean</span>
          <strong>{reviewHandoff ? (reviewHandoff.mainClean ? "clean" : "dirty") : "unknown"}</strong>
          <span>State</span>
          <strong>{reviewHandoff?.mainOperation.message ?? "ready"}</strong>
          <span>Latest</span>
          <strong title={latestCommit?.message ?? ""}>
            {latestCommit ? `${latestCommit.shortHash} ${latestCommit.message}` : "none"}
          </strong>
          <span>Apply</span>
          <strong>{reviewHandoff?.message ?? "preflight pending"}</strong>
        </div>
        <div className="handoff-commits">
          {commitsToApply.length === 0 ? (
            <div className="empty-panel">No commits to apply.</div>
          ) : (
            commitsToApply.map((commit) => (
              <div className="handoff-commit" key={commit.hash}>
                <code>{commit.shortHash}</code>
                <span title={commit.message}>{commit.message}</span>
              </div>
            ))
          )}
        </div>
        {reviewHandoff?.blockers.length ? (
          <div className="handoff-blockers">
            {reviewHandoff.blockers.map((blocker) => (
              <div className="inline-warning" key={blocker}>
                {blocker}
              </div>
            ))}
          </div>
        ) : null}
        {handoffDisabledReason ? (
          <div className="inline-warning">{handoffDisabledReason}</div>
        ) : null}
        {handoffResult ? (
          <div className={handoffResult.applied ? "handoff-result" : "handoff-result warning"}>
            <strong>
              {handoffResult.applied
                ? `Applied ${handoffResult.appliedCommits.length} commit(s)`
                : handoffResult.conflict
                  ? "Stopped with conflicts"
                  : "Apply failed"}
            </strong>
            {handoffResult.error ? <span title={handoffResult.error}>{handoffResult.error}</span> : null}
          </div>
        ) : null}
        <div className="approval-actions">
          <button
            className="command-button primary compact"
            disabled={!canApplyHandoff}
            onClick={runApplyHandoff}
            title={handoffDisabledReason || reviewHandoff?.blockers.join("; ") || "Apply handoff"}
          >
            <Check size={14} />
            Apply
          </button>
          {canAbortHandoff ? (
            <button className="command-button compact danger" onClick={runAbortHandoff}>
              <X size={14} />
              Abort
            </button>
          ) : null}
        </div>
      </div>
    </section>
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
              className={filter === item ? "command-button compact active-filter" : "command-button compact"}
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
                <strong>{action.startedAt ? formatTimestamp(action.startedAt) : "not started"}</strong>
                <span>Finished</span>
                <strong>{action.finishedAt ? formatTimestamp(action.finishedAt) : "not finished"}</strong>
                <span>Approval</span>
                <strong title={action.approvalId ?? ""}>
                  {approval ? `${approval.status} ${shortId(approval.id)}` : action.approvalId ? shortId(action.approvalId) : "none"}
                </strong>
                <span>Limits</span>
                <strong>{action.timeoutSecs}s / {formatBytes(action.outputCapBytes)}</strong>
                <span>Reason</span>
                <strong>{action.failureReason ? formatLabel(action.failureReason) : action.cancellationReason ?? "none"}</strong>
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
              {action.error ? (
                <pre className="error-output">{previewText(action.error)}</pre>
              ) : null}
              {action.output ? (
                <pre>{previewText(action.output)}</pre>
              ) : null}
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type ActionPanelFilter = "all" | "pending" | "running" | "failed" | "completed";
type ActionControl = "request" | "approve" | "reject" | "run" | "cancel";

function actionMatchesPanelFilter(action: Action, filter: ActionPanelFilter): boolean {
  switch (filter) {
    case "pending":
      return action.status === "pending_approval";
    case "running":
      return action.status === "running";
    case "failed":
      return action.status === "failed";
    case "completed":
      return ["succeeded", "rejected", "cancelled"].includes(action.status);
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

function ReviewBlock({
  title,
  value,
  empty,
}: {
  title: string;
  value: string;
  empty: string;
}) {
  return (
    <div className="review-block">
      <strong>{title}</strong>
      <pre>{value.trim() || empty}</pre>
    </div>
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
            className={filter === item ? "command-button compact active-filter" : "command-button compact"}
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
                <strong title={approval.actionId ?? ""}>{approval.actionId ? shortId(approval.actionId) : "none"}</strong>
                <span>Created</span>
                <strong>{formatTimestamp(approval.createdAt)}</strong>
                <span>Resolved</span>
                <strong>{approval.resolvedAt ? formatTimestamp(approval.resolvedAt) : "pending"}</strong>
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

type ApprovalPanelFilter = "pending" | "all" | "resolved";

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

function ProcessPanel({
  processes,
  onSpawn,
}: {
  processes: Array<{
    id: string;
    title: string;
    command: string;
    status: string;
    exitCode?: number | null;
  }>;
  onSpawn: () => void;
}) {
  const processLogs = useAppStore((state) => state.processLogs);
  const killProcess = useAppStore((state) => state.killProcess);
  const loadProcessLogs = useAppStore((state) => state.loadProcessLogs);

  return (
    <section className="process-panel">
      <div className="section-heading">
        <TerminalSquare size={15} />
        Processes
        <button className="icon-button" title="Spawn sample process" onClick={onSpawn}>
          <Plus size={14} />
        </button>
      </div>
      {processes.length === 0 ? (
        <div className="empty-panel">No managed processes.</div>
      ) : (
        <div className="process-list">
          {processes.map((process) => (
            <div className="process-item" key={process.id}>
              <div className="action-title">
                <strong>{process.title}</strong>
                <span>{process.status}</span>
              </div>
              <code title={process.command}>{process.command}</code>
              <div className="approval-actions">
                <button
                  className="command-button compact"
                  onClick={() => void loadProcessLogs(process.id)}
                >
                  Logs
                </button>
                <button
                  className="command-button compact"
                  disabled={process.status !== "running"}
                  onClick={() => void killProcess(process.id)}
                >
                  Kill
                </button>
              </div>
              {processLogs[process.id]?.contents ? (
                <pre>{processLogs[process.id].contents}</pre>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function reviewFileKey(employeeId: string, path: string): string {
  return `${employeeId}:${path}`;
}

type ReviewFileListItem = { path: string; label: string };

function reviewFileGroups(
  review: WorktreeReview | undefined,
  fallbackChangedFiles: string[],
): Array<{ title: string; files: ReviewFileListItem[] }> {
  if (!review) {
    return [
      {
        title: "Changed",
        files: fallbackChangedFiles.map((path) => ({ path, label: "changed" })),
      },
    ];
  }

  const fileByPath = new Map(review.files.map((file) => [file.path, file]));
  const toItems = (paths: string[], fallbackLabel: string) =>
    paths.map((path) => {
      const file = fileByPath.get(path);
      return {
        path,
        label: file ? reviewFileLabel(file) : fallbackLabel,
      };
    });

  return [
    { title: "Conflicted", files: toItems(review.conflictedFiles, "conflicted") },
    { title: "Staged", files: toItems(review.stagedFiles, "staged") },
    { title: "Unstaged", files: toItems(review.unstagedFiles, "unstaged") },
    { title: "Untracked", files: toItems(review.untrackedFiles, "untracked") },
  ];
}

function reviewFileLabel(file: WorktreeReview["files"][number]): string {
  if (file.conflicted) {
    return "conflicted";
  }
  if (file.untracked) {
    return "untracked";
  }
  if (file.staged && file.unstaged) {
    return "staged + unstaged";
  }
  if (file.staged) {
    return file.renamed ? "renamed" : file.deleted ? "deleted" : "staged";
  }
  if (file.unstaged) {
    return file.deleted ? "deleted" : "unstaged";
  }
  return "changed";
}

function formatAheadBehind(ahead?: number | null, behind?: number | null): string {
  if (ahead == null && behind == null) {
    return "unknown";
  }
  return `+${ahead ?? 0} / -${behind ?? 0}`;
}

function nextEmployeeName(): string {
  const count = useAppStore.getState().employees.length + 1;
  return `Employee ${count}`;
}

function codexStatusLabel(
  status: { available: boolean; version?: string | null } | null,
  loading: boolean,
): string {
  if (loading || !status) {
    return "checking";
  }
  if (!status.available) {
    return "unavailable";
  }
  return status.version ?? "available";
}

function identityLabel(health: RepoHealth | null): string {
  if (!health?.isGitRepo) {
    return "unavailable";
  }
  if (health.gitUserNameConfigured && health.gitUserEmailConfigured) {
    return "configured";
  }
  if (!health.gitUserNameConfigured && !health.gitUserEmailConfigured) {
    return "missing name and email";
  }
  return health.gitUserNameConfigured ? "missing email" : "missing name";
}

function worktreeCreateDisabledReason(
  worktreePath: string | null | undefined,
  health: RepoHealth | null,
): string | null {
  if (worktreePath) {
    return "Employee already has a worktree";
  }
  return repoCapabilityDisabledReason(health);
}

function handoffApplyDisabledReason(
  health: RepoHealth | null,
  handoff: WorktreeHandoffPreflight | undefined,
): string | null {
  const repoReason = repoCapabilityDisabledReason(health);
  if (repoReason) {
    return repoReason;
  }
  if (!handoff) {
    return "Handoff preflight is not loaded";
  }
  return null;
}

function repoCapabilityDisabledReason(health: RepoHealth | null): string | null {
  if (!health) {
    return "Workspace health is not loaded";
  }
  if (!health.isGitRepo) {
    return "Open a git repository workspace to use worktrees";
  }
  if (!health.gitUserNameConfigured || !health.gitUserEmailConfigured) {
    return `Configure git user.name and user.email for this workspace (${identityLabel(health)})`;
  }
  if (!health.worktreeSupported) {
    return health.worktreeBlockers[0] ?? health.worktreeSupportMessage;
  }
  return null;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function previewText(value: string): string {
  const limit = 4000;
  return value.length > limit ? `${value.slice(0, limit)}\n[preview truncated]` : value;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function formatStrategy(value: string): string {
  return value.replaceAll("_", " ");
}
