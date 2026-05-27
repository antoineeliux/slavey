import { lazy, Suspense } from "react";
import { FileCode2, Settings2, TerminalSquare } from "lucide-react";

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
  const setActiveTab = useAppStore((state) => state.setActiveTab);

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

function WorkspacePanelFallback() {
  return (
    <div className="panel-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}
