import { Plus, TerminalSquare } from "lucide-react";

import { useAppStore } from "../store/appStore";

type ProcessPanelItem = {
  id: string;
  title: string;
  command: string;
  status: string;
  exitCode?: number | null;
  employeeId?: string | null;
};

export function ProcessPanel({
  processes,
  onSpawn,
}: {
  processes: ProcessPanelItem[];
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
              <div className="process-owner">
                {process.employeeId ? "employee-owned" : "workspace process"}
              </div>
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
                  title={process.status === "running" ? "Kill process" : "Process is not running"}
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
