import { ListTree } from "lucide-react";

import { useAppStore } from "../store/appStore";

export function EventLogPanel() {
  const logs = useAppStore((state) => state.logs);
  const warnCount = logs.filter((log) => log.level === "warn").length;
  const errorCount = logs.filter((log) => log.level === "error").length;

  return (
    <section className="event-log">
      <div className="log-header">
        <ListTree size={15} />
        Events
        {errorCount > 0 ? <span className="log-count error">{errorCount} errors</span> : null}
        {warnCount > 0 ? <span className="log-count warn">{warnCount} warnings</span> : null}
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <div className="empty-line">No events yet</div>
        ) : (
          logs.map((log) => (
            <div className={`log-line ${log.level}`} key={log.id}>
              <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
              <strong>{log.level}</strong>
              <p title={log.message}>{log.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
