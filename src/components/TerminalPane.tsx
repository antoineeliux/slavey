import { useEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, SquareTerminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useAppStore } from "../store/appStore";

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
  const sessionId = selectedEmployee?.terminalSessionId ?? null;
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
        background: "#101114",
        foreground: "#d7dde8",
        cursor: "#f2c14e",
        selectionBackground: "#2f4058",
        black: "#101114",
        red: "#ef476f",
        green: "#5dd39e",
        yellow: "#f2c14e",
        blue: "#6aa8ff",
        magenta: "#c77dff",
        cyan: "#4ecdc4",
        white: "#d7dde8",
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

  return (
    <div className="terminal-pane">
      <div className="pane-toolbar">
        <div className="toolbar-title">
          <SquareTerminal size={16} />
          {selectedEmployee ? selectedEmployee.name : "Terminal"}
        </div>
        <button
          className="command-button compact"
          disabled={!selectedEmployee || Boolean(sessionId)}
          onClick={() => selectedEmployee && void startTerminal(selectedEmployee.id)}
        >
          <Play size={14} />
          Start shell
        </button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  );
}
