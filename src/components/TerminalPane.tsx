import { useEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { History, Pencil, Play, Square, SquareTerminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { uiTheme } from "../lib/uiTheme";
import { useAppStore } from "../store/appStore";
import type { CodexCliStatus, Employee, TerminalSessionRecord } from "../types";

export function TerminalPane() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastBufferRef = useRef("");
  const lastSessionRef = useRef<string | null>(null);
  const selectedEmployee = useAppStore((state) => state.selectedEmployee());
  const terminalBuffers = useAppStore((state) => state.terminalBuffers);
  const writeTerminal = useAppStore((state) => state.writeTerminal);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const startTerminal = useAppStore((state) => state.startTerminal);
  const startCodexTerminal = useAppStore((state) => state.startCodexTerminal);
  const stopTerminalSession = useAppStore((state) => state.stopTerminalSession);
  const renameTerminalSession = useAppStore((state) => state.renameTerminalSession);
  const settings = useAppStore((state) => state.settings);
  const codexCliStatus = useAppStore((state) => state.codexCliStatus);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const sessionId = selectedEmployee?.terminalSessionId ?? null;
  const activeSession = useMemo(
    () =>
      sessionId
        ? terminalSessions.find((session) => session.sessionId === sessionId) ?? null
        : null,
    [sessionId, terminalSessions],
  );
  const recentSessions = useMemo(
    () =>
      selectedEmployee
        ? terminalSessions
            .filter((session) => session.employeeId === selectedEmployee.id)
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 8)
        : [],
    [selectedEmployee?.id, terminalSessions],
  );
  const buffer = useMemo(
    () => (sessionId ? terminalBuffers[sessionId] ?? "" : ""),
    [sessionId, terminalBuffers],
  );

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: uiTheme.app,
        foreground: uiTheme.text,
        cursor: uiTheme.accent,
        selectionBackground: uiTheme.selection,
        black: uiTheme.panelSubtle,
        red: uiTheme.danger,
        green: uiTheme.accent,
        yellow: uiTheme.warning,
        blue: uiTheme.textMuted,
        magenta: uiTheme.textMuted,
        cyan: uiTheme.textMuted,
        white: uiTheme.text,
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;

    const dataSubscription = terminal.onData((input) => {
      const currentEmployee = useAppStore.getState().selectedEmployee();
      const currentSession = currentEmployee?.terminalSessionId;
      if (currentEmployee && currentSession) {
        void writeTerminal(currentEmployee.id, currentSession, input);
      }
    });

    const resize = () => {
      fit.fit();
      const currentEmployee = useAppStore.getState().selectedEmployee();
      const currentSession = currentEmployee?.terminalSessionId;
      if (currentEmployee && currentSession) {
        void resizeTerminal(currentEmployee.id, currentSession, terminal.cols, terminal.rows);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [resizeTerminal, writeTerminal]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (lastSessionRef.current !== sessionId) {
      terminal.clear();
      if (!sessionId) {
        terminal.writeln("No terminal session attached.");
      } else if (buffer) {
        terminal.write(buffer);
      }
      lastSessionRef.current = sessionId;
      lastBufferRef.current = buffer;
      return;
    }

    const previous = lastBufferRef.current;
    if (buffer.startsWith(previous)) {
      terminal.write(buffer.slice(previous.length));
    } else {
      terminal.clear();
      terminal.write(buffer);
    }
    lastBufferRef.current = buffer;
  }, [buffer, sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit || !selectedEmployee || !sessionId) {
      return;
    }
    fit.fit();
    void resizeTerminal(selectedEmployee.id, sessionId, terminal.cols, terminal.rows);
  }, [resizeTerminal, selectedEmployee?.id, sessionId]);

  const defaultProfile = settings.defaultTerminalProfile;
  const defaultTerminalDisabledReason = terminalStartDisabledReason(
    selectedEmployee,
    sessionId,
    defaultProfile,
    codexCliStatus,
  );

  return (
    <div className="terminal-pane">
      <div className="pane-toolbar">
        <div className="toolbar-title">
          <SquareTerminal size={16} />
          {selectedEmployee ? selectedEmployee.name : "Terminal"}
          {activeSession ? <span className="toolbar-muted">{activeSession.label}</span> : null}
        </div>
        <div className="toolbar-actions">
          <button
            className="command-button compact"
            disabled={Boolean(defaultTerminalDisabledReason)}
            title={defaultTerminalDisabledReason ?? `Start ${defaultProfile}`}
            onClick={() => {
              if (!selectedEmployee) {
                return;
              }
              if (defaultProfile === "codex") {
                void startCodexTerminal(selectedEmployee.id);
              } else {
                void startTerminal(selectedEmployee.id);
              }
            }}
          >
            <Play size={14} />
            Start {defaultProfile}
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
        </div>
      </div>
      {activeSession ? (
        <ActiveSessionSummary session={activeSession} />
      ) : sessionId ? (
        <div className="terminal-session-bar pending">
          <strong title={sessionId}>{sessionId}</strong>
          <span>loading session record</span>
        </div>
      ) : (
        <div className="terminal-empty-banner">No active terminal session.</div>
      )}
      {defaultTerminalDisabledReason ? (
        <div className="terminal-disabled-reason">{defaultTerminalDisabledReason}</div>
      ) : null}
      <div className="terminal-host" ref={hostRef} />
      <TerminalSessionPanel
        activeSessionId={sessionId}
        sessions={recentSessions}
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

function ActiveSessionSummary({ session }: { session: TerminalSessionRecord }) {
  return (
    <div className="terminal-session-bar">
      <strong>{session.label}</strong>
      <span>{formatLabel(session.profile)}</span>
      <span>{session.status.replaceAll("_", " ")}</span>
      <span title={session.cwd}>{session.cwd}</span>
      <span>started {formatTimestamp(session.startedAt)}</span>
      {session.exitCode !== null && session.exitCode !== undefined ? (
        <span>exit {session.exitCode}</span>
      ) : session.lastOutputAt ? (
        <span>output {formatTimestamp(session.lastOutputAt)}</span>
      ) : (
        <span>{session.stopReason?.replaceAll("_", " ") ?? "active"}</span>
      )}
    </div>
  );
}

function TerminalSessionPanel({
  activeSessionId,
  sessions,
  onStop,
  onRename,
}: {
  activeSessionId: string | null;
  sessions: TerminalSessionRecord[];
  onStop: (session: TerminalSessionRecord) => void;
  onRename: (session: TerminalSessionRecord) => void;
}) {
  return (
    <section className="terminal-session-panel">
      <div className="compact-panel-heading">
        <span>
          <History size={14} />
          Sessions
        </span>
      </div>
      {sessions.length === 0 ? (
        <div className="empty-line compact">No terminal sessions</div>
      ) : (
        <div className="terminal-session-list">
          {sessions.map((session) => (
            <div
              className={
                session.sessionId === activeSessionId
                  ? `terminal-session-item active ${session.status}`
                  : `terminal-session-item ${session.status}`
              }
              key={session.sessionId}
            >
              <div className="terminal-session-title">
                <strong title={session.sessionId}>{session.label}</strong>
                <span>{session.status.replaceAll("_", " ")}</span>
              </div>
              <div className="terminal-session-meta">
                <span>{formatLabel(session.profile)}</span>
                <span>{formatSessionRange(session)}</span>
                <span>{session.stopReason?.replaceAll("_", " ") ?? "active"}</span>
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
      )}
    </section>
  );
}

function terminalStartDisabledReason(
  employee: Employee | null,
  sessionId: string | null,
  profile: "shell" | "codex",
  codexCliStatus: CodexCliStatus | null,
): string | null {
  if (!employee) {
    return "Select an employee before starting a terminal";
  }
  if (sessionId) {
    return "Employee already has an active terminal session";
  }
  if (profile === "codex" && codexCliStatus?.available !== true) {
    return codexCliStatus?.message ?? "Codex CLI availability is unknown";
  }
  return null;
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
