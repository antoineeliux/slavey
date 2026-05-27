import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Clipboard, FolderOpen, History, RefreshCw, Settings2, ShieldCheck } from "lucide-react";

import * as commands from "../lib/tauriCommands";
import { useAppStore } from "../store/appStore";
import type { AppSettings, DiagnosticsSummary, RepoHealth } from "../types";
import { codexStatusLabel, identityLabel } from "./panelUtils";

export function WorkspaceSettingsPanel() {
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
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);

  useEffect(() => {
    setPathInput(workspaceRoot ?? "");
  }, [workspaceRoot]);

  useEffect(() => {
    void loadDiagnostics();
  }, []);

  const health = workspaceInfo?.repoHealth ?? null;

  const loadDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsMessage(null);
    try {
      setDiagnostics(await commands.diagnosticsSummary());
    } catch (error) {
      const message = String(error);
      setDiagnosticsMessage(message);
      addLog({
        id: crypto.randomUUID(),
        level: "warn",
        message: `diagnostics failed: ${message}`,
        timestamp: Date.now(),
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const copyDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsMessage(null);
    try {
      const bundle = await commands.diagnosticsExportBundle();
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setDiagnostics(bundle.summary);
      setDiagnosticsMessage("Diagnostics copied.");
    } catch (error) {
      const message = String(error);
      setDiagnosticsMessage(message);
      addLog({
        id: crypto.randomUUID(),
        level: "warn",
        message: `copy diagnostics failed: ${message}`,
        timestamp: Date.now(),
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

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
            <strong>{health ? (health.isExistingDirectory ? "exists" : "missing") : "unknown"}</strong>
            <span>Git repo</span>
            <strong>{health ? (health.isGitRepo ? "available" : "unavailable") : "unknown"}</strong>
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

          {workspaceError ? <div className="inline-warning">{workspaceError}</div> : null}

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
                    title={
                      recent === workspaceRoot
                        ? "Current workspace"
                        : workspaceLoading
                          ? "Workspace change in progress"
                          : recent
                    }
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

          <DiagnosticsSection
            diagnostics={diagnostics}
            loading={diagnosticsLoading}
            message={diagnosticsMessage}
            onRefresh={loadDiagnostics}
            onCopy={copyDiagnostics}
          />
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
                defaultTerminalProfile:
                  event.target.value as AppSettings["defaultTerminalProfile"],
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

function DiagnosticsSection({
  diagnostics,
  loading,
  message,
  onRefresh,
  onCopy,
}: {
  diagnostics: DiagnosticsSummary | null;
  loading: boolean;
  message: string | null;
  onRefresh: () => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  const counts = diagnostics?.counts;
  return (
    <section className="settings-section diagnostics-section">
      <div className="section-heading compact-heading">
        <ShieldCheck size={15} />
        Diagnostics
      </div>
      <div className="settings-grid diagnostics-grid">
        <span>App</span>
        <strong>
          {diagnostics ? `${diagnostics.appVersion} (${diagnostics.os}/${diagnostics.arch})` : "not loaded"}
        </strong>
        <span>Workspace</span>
        <strong title={diagnostics?.workspacePath ?? ""}>
          {diagnostics?.workspacePath ?? "unknown"}
        </strong>
        <span>Repo</span>
        <strong>
          {diagnostics
            ? diagnostics.workspaceIsGitRepo
              ? "git repo"
              : "not a git repo"
            : "not loaded"}
        </strong>
        <span>Employees</span>
        <strong>{counts?.employees ?? 0}</strong>
        <span>Terminals</span>
        <strong>
          {counts ? `${counts.activeTerminalSessions} active / ${counts.recentTerminalSessions} recent` : "0"}
        </strong>
        <span>Recent files</span>
        <strong>{counts?.recentFiles ?? 0}</strong>
        <span>Actions</span>
        <strong>{counts ? countSummary(counts.actionsByStatus) : "not loaded"}</strong>
        <span>Approvals</span>
        <strong>{counts ? countSummary(counts.approvalsByStatus) : "not loaded"}</strong>
        <span>Processes</span>
        <strong>{counts ? countSummary(counts.managedProcessesByStatus) : "not loaded"}</strong>
        <span>Codex CLI</span>
        <strong title={diagnostics?.codexCliMessage ?? ""}>
          {diagnostics?.codexCliAvailable
            ? diagnostics.codexCliVersion ?? "available"
            : "unavailable"}
        </strong>
      </div>
      {diagnostics?.healthFlags.length ? (
        <div className="diagnostics-flags">
          {diagnostics.healthFlags.map((flag) => (
            <span key={flag}>{flag}</span>
          ))}
        </div>
      ) : null}
      {diagnostics?.blockers.length ? (
        <div className="handoff-blockers">
          {diagnostics.blockers.map((blocker) => (
            <div className="inline-warning" key={blocker}>
              {blocker}
            </div>
          ))}
        </div>
      ) : null}
      <div className="diagnostics-actions">
        <button
          className="command-button compact"
          disabled={loading}
          title={loading ? "Diagnostics request in progress" : "Refresh diagnostics"}
          onClick={() => void onRefresh()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
        <button
          className="command-button compact"
          disabled={loading}
          title={loading ? "Diagnostics request in progress" : "Copy diagnostics JSON"}
          onClick={() => void onCopy()}
        >
          <Clipboard size={14} />
          Copy diagnostics JSON
        </button>
      </div>
      <p className="diagnostics-note">
        Local-only export. Secrets, terminal output, environment variables, raw logs, and file-write contents are excluded.
      </p>
      {message ? <div className="inline-warning subtle-warning">{message}</div> : null}
    </section>
  );
}

function countSummary(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([status, count]) => `${status.replaceAll("_", " ")} ${count}`).join(", ");
}
