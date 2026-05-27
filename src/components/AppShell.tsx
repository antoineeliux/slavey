import { lazy, Suspense } from "react";
import {
  CircleAlert,
  CircleCheck,
  FileCode2,
  FileWarning,
  GitBranch,
  Settings2,
  TerminalSquare,
  UserRound,
} from "lucide-react";

import { useAppStore } from "../store/appStore";
import { EmployeeDetailsPanel } from "./EmployeeDetailsPanel";
import { EventLogPanel } from "./EventLogPanel";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";

const TerminalPane = lazy(() =>
  import("./TerminalPane").then((module) => ({ default: module.TerminalPane })),
);
const EditorPane = lazy(() =>
  import("./EditorPane").then((module) => ({ default: module.EditorPane })),
);

export function AppShell() {
  const activeTab = useAppStore((state) => state.activeTab);
  const backendReady = useAppStore((state) => state.backendReady);
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const workspaceInfo = useAppStore((state) => state.workspaceInfo);
  const openFile = useAppStore((state) => state.openFile);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const activeSession = selectedEmployee?.terminalSessionId
    ? terminalSessions.find(
        (session) => session.sessionId === selectedEmployee.terminalSessionId,
      ) ?? null
    : null;

  return (
    <div className="app-shell" data-backend-ready={backendReady} aria-busy={!backendReady}>
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
        <WorkspaceStatusStrip
          backendReady={backendReady}
          employeeName={selectedEmployee?.name ?? null}
          employeeStatus={selectedEmployee?.status ?? null}
          sessionLabel={activeSession?.label ?? null}
          workspaceRoot={workspaceInfo?.workspaceRoot ?? null}
          branchName={workspaceInfo?.repoHealth.currentBranch ?? null}
          dirtyFilePath={openFile?.dirty ? openFile.path : null}
          blockerCount={workspaceBlockerCount(workspaceInfo)}
        />
        <section className="workspace-panel">
          {activeTab === "terminal" ? (
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

      <aside className="details-panel">
        <EmployeeDetailsPanel />
      </aside>

      <EventLogPanel />
    </div>
  );
}

function WorkspaceStatusStrip({
  backendReady,
  employeeName,
  employeeStatus,
  sessionLabel,
  workspaceRoot,
  branchName,
  dirtyFilePath,
  blockerCount,
}: {
  backendReady: boolean;
  employeeName: string | null;
  employeeStatus: string | null;
  sessionLabel: string | null;
  workspaceRoot: string | null;
  branchName: string | null;
  dirtyFilePath: string | null;
  blockerCount: number;
}) {
  return (
    <div className="workspace-status-strip" role="status" aria-live="polite">
      <span className={backendReady ? "status-chip ready" : "status-chip pending"}>
        {backendReady ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
        {backendReady ? "Backend ready" : "Bootstrapping"}
      </span>
      <span className="status-chip" title={workspaceRoot ?? "No workspace selected"}>
        <GitBranch size={13} />
        {branchName ?? "No branch"}
      </span>
      <span className="status-chip" title={workspaceRoot ?? "No workspace selected"}>
        {workspaceRoot ? shortPath(workspaceRoot) : "No workspace"}
      </span>
      <span className="status-chip" title={employeeName ?? "No employee selected"}>
        <UserRound size={13} />
        {employeeName ? `${employeeName} · ${employeeStatus ?? "unknown"}` : "No employee selected"}
      </span>
      <span className={sessionLabel ? "status-chip ready" : "status-chip"}>
        <TerminalSquare size={13} />
        {sessionLabel ?? "No active session"}
      </span>
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

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || path;
}
