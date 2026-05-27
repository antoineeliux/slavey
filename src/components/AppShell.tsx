import { FileCode2, Settings2, TerminalSquare } from "lucide-react";

import { useAppStore } from "../store/appStore";
import { EditorPane } from "./EditorPane";
import { EmployeeDetailsPanel } from "./EmployeeDetailsPanel";
import { EventLogPanel } from "./EventLogPanel";
import { TerminalPane } from "./TerminalPane";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";

export function AppShell() {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  return (
    <div className="app-shell">
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
