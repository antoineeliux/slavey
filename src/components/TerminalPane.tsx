import { useMemo, useState } from "react";
import { History, Pencil, Play, RefreshCw, Square, SquareTerminal } from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { TerminalSessionRecord } from "../types";
import { EmployeeTerminalSurface } from "./EmployeeTerminalSurface";
import { terminalStartDisabledReason } from "./terminalControls";

export function TerminalPane() {
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const startTerminal = useAppStore((state) => state.startTerminal);
  const stopTerminalSession = useAppStore((state) => state.stopTerminalSession);
  const renameTerminalSession = useAppStore((state) => state.renameTerminalSession);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const sessionId = selectedEmployee?.terminalSessionId ?? null;
  const [renderRepairSignal, setRenderRepairSignal] = useState(0);
  const activeSession = useMemo(
    () =>
      sessionId
        ? terminalSessions.find((session) => session.sessionId === sessionId) ?? null
        : null,
    [sessionId, terminalSessions],
  );
  const sessionHistory = useMemo(
    () =>
      selectedEmployee
        ? terminalSessions
            .filter((session) => session.employeeId === selectedEmployee.id)
            .sort((a, b) => b.startedAt - a.startedAt)
            .filter((session) => session.sessionId !== sessionId)
            .slice(0, 7)
        : [],
    [selectedEmployee?.id, sessionId, terminalSessions],
  );

  const shellDisabledReason = terminalStartDisabledReason(selectedEmployee, sessionId);

  return (
    <div className="terminal-pane">
      <div className="pane-toolbar">
        <div className="toolbar-title">
          <SquareTerminal size={16} />
          {selectedEmployee ? selectedEmployee.name : "Terminal"}
          {activeSession ? (
            <span
              className="toolbar-muted"
              title={activeSession.currentCwd ?? activeSession.cwd}
            >
              {formatTerminalContext(activeSession)}
            </span>
          ) : null}
        </div>
        <div className="toolbar-actions">
          <button
            className="command-button compact"
            disabled={Boolean(shellDisabledReason)}
            aria-label={
              shellDisabledReason
                ? `Start shell unavailable: ${shellDisabledReason}`
                : "Start shell"
            }
            title={shellDisabledReason ?? "Start shell"}
            onClick={() => {
              if (selectedEmployee) {
                void startTerminal(selectedEmployee.id);
              }
            }}
          >
            <Play size={14} />
            Start shell
          </button>
          <button
            className="command-button compact"
            disabled={!selectedEmployee || !sessionId}
            title={sessionId ? "Stop active session" : "No active session"}
            onClick={() =>
              selectedEmployee &&
              sessionId &&
              void stopTerminalSession(selectedEmployee.id, sessionId)
            }
          >
            <Square size={13} />
            Stop
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh terminal rendering"
            disabled={!selectedEmployee}
            title="Refresh terminal rendering"
            onClick={() => setRenderRepairSignal((value) => value + 1)}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      {sessionId && !activeSession ? (
        <div className="terminal-empty-banner">Loading terminal session...</div>
      ) : !sessionId ? (
        <div className="terminal-empty-banner">No active terminal session.</div>
      ) : null}
      <EmployeeTerminalSurface
        employee={selectedEmployee}
        repairSignal={renderRepairSignal}
      />
      <TerminalSessionPanel
        sessions={sessionHistory}
        onStop={(session) => void stopTerminalSession(session.employeeId, session.sessionId)}
        onRename={(session) => {
          const label = prompt("Session label", session.label);
          if (label?.trim()) {
            void renameTerminalSession(session.employeeId, session.sessionId, label);
          }
        }}
      />
    </div>
  );
}

function TerminalSessionPanel({
  sessions,
  onStop,
  onRename,
}: {
  sessions: TerminalSessionRecord[];
  onStop: (session: TerminalSessionRecord) => void;
  onRename: (session: TerminalSessionRecord) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <details className="terminal-session-panel">
      <summary className="compact-panel-heading">
        <span>
          <History size={14} />
          Session history
        </span>
        <span className="terminal-session-count">{sessions.length}</span>
      </summary>
      <div className="terminal-session-list">
        {sessions.map((session) => (
          <div className={`terminal-session-item ${session.status}`} key={session.sessionId}>
            <div className="terminal-session-title">
              <strong title={session.sessionId}>{session.label}</strong>
              <span>{session.status.replaceAll("_", " ")}</span>
            </div>
            <div className="terminal-session-meta">
              <span>{formatLabel(session.profile)}</span>
              <span>{formatSessionRange(session)}</span>
              {session.exitCode !== null && session.exitCode !== undefined ? (
                <span>exit {session.exitCode}</span>
              ) : null}
            </div>
            <code title={session.cwd}>{session.cwd}</code>
            {session.message ? <p>{session.message}</p> : null}
            <div className="session-actions">
              <button
                className="icon-button mini"
                title="Rename session"
                onClick={() => onRename(session)}
              >
                <Pencil size={12} />
              </button>
              <button
                className="icon-button mini"
                disabled={session.status !== "running"}
                title={session.status === "running" ? "Stop session" : "Session is not running"}
                onClick={() => onStop(session)}
              >
                <Square size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatSessionRange(session: TerminalSessionRecord): string {
  const end = session.stoppedAt ?? session.endedAt;
  return `${formatTimestamp(session.startedAt)} - ${end ? formatTimestamp(end) : "active"}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTerminalContext(session: TerminalSessionRecord): string {
  const cwd = session.currentCwd ?? session.cwd;
  const path = shortPath(cwd);
  return path ? `${session.label} · ${path}` : session.label;
}

function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}
