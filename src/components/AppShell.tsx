import { lazy, Suspense } from "react";
import {
  Building2,
  CircleAlert,
  FileCode2,
  FileWarning,
  Settings2,
  TerminalSquare,
} from "lucide-react";

import { useAppStore } from "../store/appStore";
import { EventLogPanel } from "./EventLogPanel";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";

const TerminalPane = lazy(() =>
  import("./TerminalPane").then((module) => ({ default: module.TerminalPane })),
);
const EditorPane = lazy(() =>
  import("./EditorPane").then((module) => ({ default: module.EditorPane })),
);
const OfficePane = lazy(() =>
  import("./OfficePane").then((module) => ({ default: module.OfficePane })),
);

export function AppShell() {
  const activeTab = useAppStore((state) => state.activeTab);
  const backendReady = useAppStore((state) => state.backendReady);
  const workspaceInfo = useAppStore((state) => state.workspaceInfo);
  const openFile = useAppStore((state) => state.openFile);
  const logs = useAppStore((state) => state.logs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const officeActive = activeTab === "office";
  const blockerCount = workspaceBlockerCount(workspaceInfo);
  const showWorkspaceStatus = !officeActive && (!backendReady || Boolean(openFile?.dirty) || blockerCount > 0);
  const showEventLog = !officeActive && logs.some((log) => log.level === "warn" || log.level === "error");
  const shellClassName = [
    "app-shell",
    officeActive ? "office-active" : "",
    showEventLog ? "has-event-log" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={shellClassName}
      data-backend-ready={backendReady}
      aria-busy={!backendReady}
    >
      <main className="workbench">
        <div className="tab-strip" role="tablist" aria-label="Workspace">
          <button
            className={activeTab === "office" ? "tab active" : "tab"}
            onClick={() => setActiveTab("office")}
          >
            <Building2 size={16} />
            Office
          </button>
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
        {showWorkspaceStatus ? (
          <WorkspaceStatusStrip
            backendReady={backendReady}
            dirtyFilePath={openFile?.dirty ? openFile.path : null}
            blockerCount={blockerCount}
          />
        ) : null}
        <section className="workspace-panel">
          {activeTab === "office" ? (
            <Suspense fallback={<WorkspacePanelFallback />}>
              <OfficePane />
            </Suspense>
          ) : activeTab === "terminal" ? (
            <Suspense fallback={<WorkspacePanelFallback />}>
              <TerminalPane />
            </Suspense>
          ) : activeTab === "editor" ? (
            <Suspense fallback={<WorkspacePanelFallback />}>
              <EditorPane />
            </Suspense>
          ) : (
            <WorkspaceSettingsPanel />
          )}
        </section>
      </main>

      {showEventLog ? <EventLogPanel /> : null}
    </div>
  );
}

function WorkspaceStatusStrip({
  backendReady,
  dirtyFilePath,
  blockerCount,
}: {
  backendReady: boolean;
  dirtyFilePath: string | null;
  blockerCount: number;
}) {
  return (
    <div className="workspace-status-strip" role="status" aria-live="polite">
      {!backendReady ? (
        <span className="status-chip pending">
          <CircleAlert size={13} />
          Bootstrapping
        </span>
      ) : null}
      {dirtyFilePath ? (
        <span className="status-chip warning" title={dirtyFilePath}>
          <FileWarning size={13} />
          Unsaved changes
        </span>
      ) : null}
      {blockerCount > 0 ? (
        <span className="status-chip warning">
          <CircleAlert size={13} />
          {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function WorkspacePanelFallback() {
  return (
    <div className="panel-loading" role="status" aria-live="polite">
      Loading workspace panel...
    </div>
  );
}

function workspaceBlockerCount(
  workspaceInfo: ReturnType<typeof useAppStore.getState>["workspaceInfo"],
): number {
  const health = workspaceInfo?.repoHealth;
  return (
    (workspaceInfo?.switchBlockers.length ?? 0) +
    (health?.worktreeBlockers.length ?? 0) +
    (health?.handoffBlockers.length ?? 0) +
    (health && (!health.gitUserNameConfigured || !health.gitUserEmailConfigured) ? 1 : 0)
  );
}
