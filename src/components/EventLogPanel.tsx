import { ListTree } from "lucide-react";

import { useAppStore } from "../store/appStore";

export function EventLogPanel() {
  const logs = useAppStore((state) => state.logs);

  return (
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
  );
}
