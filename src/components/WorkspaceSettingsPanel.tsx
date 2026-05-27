import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, History, RefreshCw, Settings2 } from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { AppSettings, RepoHealth } from "../types";
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
