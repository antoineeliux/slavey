import * as commands from "../../lib/tauriCommands";
import { appendBoundedTerminalBuffer, formatError, localLog } from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";
import { refreshWorktreeReviewForEmployee } from "./reviewSlice";

type TerminalSlice = Pick<
  AppStore,
  | "terminalBuffers"
  | "terminalSessions"
  | "startTerminal"
  | "startCodexTerminal"
  | "stopTerminal"
  | "stopTerminalSession"
  | "renameTerminalSession"
  | "loadTerminalSessions"
  | "writeTerminal"
  | "resizeTerminal"
  | "appendTerminalData"
  | "upsertTerminalSession"
>;

export const createTerminalSlice: AppStoreSlice<TerminalSlice> = (set, get) => ({
  terminalBuffers: {},
  terminalSessions: [],

  startTerminal: async (employeeId) => {
    try {
      const employee = await commands.employeeStartTerminal(employeeId);
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `start terminal failed: ${formatError(error)}`));
    }
  },

  startCodexTerminal: async (employeeId) => {
    try {
      const employee = await commands.employeeStartCodexTerminal(employeeId);
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `start Codex failed: ${formatError(error)}`));
      void get().loadCodexCliStatus();
    }
  },

  stopTerminal: async (employeeId) => {
    try {
      const employee = await commands.employeeStopTerminal(employeeId);
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `stop terminal failed: ${formatError(error)}`));
    }
  },

  stopTerminalSession: async (employeeId, sessionId) => {
    try {
      const session = await commands.terminalSessionStop(employeeId, sessionId);
      get().upsertTerminalSession(session);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `stop terminal session failed: ${formatError(error)}`));
    }
  },

  renameTerminalSession: async (employeeId, sessionId, label) => {
    try {
      const session = await commands.terminalSessionRename(employeeId, sessionId, label);
      get().upsertTerminalSession(session);
    } catch (error) {
      get().addLog(localLog("error", `rename terminal session failed: ${formatError(error)}`));
    }
  },

  loadTerminalSessions: async (employeeId = null) => {
    try {
      const terminalSessions = await commands.terminalSessionList(employeeId);
      set((state) => ({
        terminalSessions: employeeId
          ? [
              ...state.terminalSessions.filter(
                (session) => session.employeeId !== employeeId,
              ),
              ...terminalSessions,
            ].sort((a, b) => a.startedAt - b.startedAt)
          : terminalSessions,
      }));
    } catch (error) {
      get().addLog(localLog("warn", `terminal sessions failed: ${formatError(error)}`));
    }
  },

  writeTerminal: async (employeeId, sessionId, input) => {
    try {
      await commands.terminalWrite(employeeId, sessionId, input);
    } catch (error) {
      get().addLog(localLog("error", `terminal write failed: ${formatError(error)}`));
    }
  },

  resizeTerminal: async (employeeId, sessionId, cols, rows) => {
    try {
      await commands.terminalResize(employeeId, sessionId, cols, rows);
    } catch (error) {
      get().addLog(localLog("warn", `terminal resize failed: ${formatError(error)}`));
    }
  },

  appendTerminalData: ({ employeeId, sessionId, data }) => {
    const employee = get().employees.find((employee) => employee.id === employeeId);
    if (!employee || employee.terminalSessionId !== sessionId) {
      return;
    }

    set((state) => ({
      terminalBuffers: {
        ...state.terminalBuffers,
        [sessionId]: appendBoundedTerminalBuffer(
          state.terminalBuffers[sessionId] ?? "",
          data,
          state.settings.maxTerminalBufferChars,
        ),
      },
    }));
  },

  upsertTerminalSession: (session) => {
    const previous = get().terminalSessions.find((item) => item.sessionId === session.sessionId);
    set((state) => {
      const exists = state.terminalSessions.some((item) => item.sessionId === session.sessionId);
      const terminalSessions = exists
        ? state.terminalSessions.map((item) =>
            item.sessionId === session.sessionId ? session : item,
          )
        : [...state.terminalSessions, session];
      terminalSessions.sort((a, b) => a.startedAt - b.startedAt);
      return { terminalSessions };
    });

    if (
      session.profile === "codex" &&
      session.status !== "running" &&
      previous?.status !== session.status
    ) {
      void refreshWorktreeReviewForEmployee(get, session.employeeId);
    }
  },
});
