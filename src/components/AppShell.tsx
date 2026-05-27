import { Code2, FileCode2, Plus, Settings2, TerminalSquare } from "lucide-react";

import { useAppStore } from "../store/appStore";
import { EditorPane } from "./EditorPane";
import { EmployeeDashboard } from "./EmployeeDashboard";
import { EmployeeDetailsPanel } from "./EmployeeDetailsPanel";
import { EmployeeScene } from "./EmployeeScene";
import { EventLogPanel } from "./EventLogPanel";
import { nextEmployeeName } from "./panelUtils";
import { TerminalPane } from "./TerminalPane";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";

export function AppShell() {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const createEmployee = useAppStore((state) => state.createEmployee);
  const backendReady = useAppStore((state) => state.backendReady);

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
        <EmployeeScene>
          <EmployeeDashboard />
        </EmployeeScene>
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
