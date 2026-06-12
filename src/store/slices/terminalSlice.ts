import * as commands from "../../lib/tauriCommands";
import { terminalSessionIsCodexActive } from "../../lib/codexPromptState";
import { appendBoundedTerminalBuffer, formatError, localLog, shortPath } from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";
import type {
  TerminalDataPayload,
  TerminalImageUploadInput,
  TerminalImageUploadPathInput,
  TerminalImageUploadResult,
  TerminalSessionRecord,
} from "../../types";
import { refreshWorktreeReviewForEmployee } from "./reviewSlice";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

type TerminalSlice = Pick<
  AppStore,
  | "terminalBuffers"
  | "terminalSessions"
  | "startTerminal"
  | "submitCodexTask"
  | "stopTerminal"
  | "stopTerminalSession"
  | "renameTerminalSession"
  | "loadTerminalSessions"
  | "loadTerminalBuffer"
  | "writeTerminal"
  | "insertTerminalImage"
  | "insertTerminalImagePath"
  | "resizeTerminal"
  | "appendTerminalData"
  | "upsertTerminalSession"
>;

export const createTerminalSlice: AppStoreSlice<TerminalSlice> = (set, get) => {
  const pendingTerminalData = new Map<string, TerminalDataPayload>();
  let terminalDataFlushTimer: number | null = null;

  const flushPendingTerminalData = () => {
    if (terminalDataFlushTimer !== null) {
      window.clearTimeout(terminalDataFlushTimer);
      terminalDataFlushTimer = null;
    }

    if (pendingTerminalData.size === 0) {
      return;
    }

    const pendingPayloads = Array.from(pendingTerminalData.values());
    pendingTerminalData.clear();
    const receivedAt = Date.now();

    set((state) => {
      let terminalBuffers = state.terminalBuffers;
      let terminalSessions = state.terminalSessions;
      let terminalBuffersChanged = false;
      let terminalSessionsChanged = false;

      for (const { employeeId, sessionId, data } of pendingPayloads) {
        const employee = state.employees.find((item) => item.id === employeeId);
        if (!employee || employee.terminalSessionId !== sessionId) {
          continue;
        }

        if (!terminalBuffersChanged) {
          terminalBuffers = { ...terminalBuffers };
          terminalBuffersChanged = true;
        }
        const previousBuffer = terminalBuffers[sessionId] ?? "";
        const nextBuffer = appendBoundedTerminalBuffer(
          previousBuffer,
          data,
          state.settings.maxTerminalBufferChars,
        );
        terminalBuffers[sessionId] = nextBuffer;

        let sessionChanged = false;
        const nextTerminalSessions = terminalSessions.map((session) => {
          if (session.sessionId !== sessionId || session.employeeId !== employeeId) {
            return session;
          }
          sessionChanged = true;
          return mergeTerminalOutputTimestamp(session, data, receivedAt);
        });
        if (sessionChanged) {
          terminalSessions = nextTerminalSessions;
          terminalSessionsChanged = true;
        }
      }

      if (!terminalBuffersChanged && !terminalSessionsChanged) {
        return {};
      }

      return {
        ...(terminalBuffersChanged ? { terminalBuffers } : {}),
        ...(terminalSessionsChanged ? { terminalSessions } : {}),
      };
    });
  };

  const queueTerminalData = (payload: TerminalDataPayload) => {
    const pendingKey = `${payload.employeeId}:${payload.sessionId}`;
    const pending = pendingTerminalData.get(pendingKey);
    pendingTerminalData.set(
      pendingKey,
      pending
        ? { ...pending, data: `${pending.data}${payload.data}` }
        : payload,
    );

    if (terminalDataFlushTimer === null) {
      terminalDataFlushTimer = window.setTimeout(flushPendingTerminalData, 80);
    }
  };

  return {
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

  submitCodexTask: async (input) => {
    try {
      const session = await commands.codexTaskSubmit(input);
      set((state) => ({
        employees: state.employees.map((employee) =>
          employee.id === input.employeeId
            ? {
                ...employee,
                status: "running",
                currentCommand: "codex",
                terminalSessionId: session.sessionId,
                updatedAt: Date.now(),
              }
            : employee,
        ),
      }));
      get().upsertTerminalSession(session);
      void get().loadTerminalSessions(input.employeeId);
      void get().refreshEmployeeActivity(input.employeeId);
    } catch (error) {
      get().addLog(localLog("error", `Codex task failed: ${formatError(error)}`));
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

  loadTerminalBuffer: async (employeeId, sessionId) => {
    try {
      flushPendingTerminalData();
      const output = await commands.terminalSessionOutput(employeeId, sessionId);
      if (!output) {
        return;
      }
      set((state) => ({
        terminalBuffers: {
          ...state.terminalBuffers,
          [sessionId]:
            output.length > (state.terminalBuffers[sessionId]?.length ?? 0)
              ? output
              : state.terminalBuffers[sessionId] ?? output,
        },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `terminal output replay failed: ${formatError(error)}`));
    }
  },

  writeTerminal: async (employeeId, sessionId, input) => {
    try {
      await commands.terminalWrite(employeeId, sessionId, input);
    } catch (error) {
      get().addLog(localLog("error", `terminal write failed: ${formatError(error)}`));
    }
  },

  insertTerminalImage: async (
    employeeId: string,
    sessionId: string,
    image: TerminalImageUploadInput,
  ) => {
    try {
      const uploaded = await commands.terminalImageUpload(image);
      return await insertUploadedTerminalImage(get, employeeId, sessionId, uploaded);
    } catch (error) {
      get().addLog(localLog("error", `terminal image upload failed: ${formatError(error)}`));
      return false;
    }
  },

  insertTerminalImagePath: async (
    employeeId: string,
    sessionId: string,
    image: TerminalImageUploadPathInput,
  ) => {
    try {
      const uploaded = await commands.terminalImageUploadPath(image);
      return await insertUploadedTerminalImage(get, employeeId, sessionId, uploaded);
    } catch (error) {
      get().addLog(localLog("error", `terminal image drop failed: ${formatError(error)}`));
      return false;
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

    queueTerminalData({ employeeId, sessionId, data });
  },

  upsertTerminalSession: (session) => {
    const previous = get().terminalSessions.find((item) => item.sessionId === session.sessionId);
    const nextSession = session;
    set((state) => {
      const exists = state.terminalSessions.some((item) => item.sessionId === session.sessionId);
      const terminalSessions = exists
        ? state.terminalSessions.map((item) =>
            item.sessionId === session.sessionId ? nextSession : item,
          )
        : [...state.terminalSessions, nextSession];
      terminalSessions.sort((a, b) => a.startedAt - b.startedAt);
      return { terminalSessions };
    });

    if (
      terminalSessionIsCodexActive(nextSession) &&
      nextSession.status !== "running" &&
      previous?.status !== session.status
    ) {
      void refreshWorktreeReviewForEmployee(get, nextSession.employeeId);
      void refreshPinnedFolderChangesForEmployee(get, nextSession.employeeId);
    }

    if (
      terminalSessionIsCodexActive(nextSession) &&
      nextSession.status === "running" &&
      nextSession.lastPromptReadyAt &&
      nextSession.lastPromptReadyAt !== previous?.lastPromptReadyAt
    ) {
      void refreshPinnedFolderChangesForEmployee(get, nextSession.employeeId);
    }
  },
  };
};

async function refreshPinnedFolderChangesForEmployee(
  get: () => AppStore,
  employeeId: string,
): Promise<void> {
  const employee = get().employees.find((item) => item.id === employeeId);
  if (employee?.cwd) {
    await get().loadGitChangesForPath(employee.cwd);
  }
}

async function insertUploadedTerminalImage(
  get: () => AppStore,
  employeeId: string,
  sessionId: string,
  uploaded: TerminalImageUploadResult,
): Promise<boolean> {
  const session = get().terminalSessions.find(
    (session) => session.employeeId === employeeId && session.sessionId === sessionId,
  );
  if (session?.runtime === "codex_app_server") {
    get().addLog(localLog("warn", "Codex app-server image attachments are not supported yet."));
    return false;
  }

  const input = terminalImageInput(uploaded.path, session);
  await commands.terminalWrite(employeeId, sessionId, input);
  get().addLog(
    localLog("info", terminalImageLogMessage(uploaded.path, session)),
  );
  return true;
}

function terminalImageInput(path: string, session: TerminalSessionRecord | undefined): string {
  if (session && terminalSessionIsCodexActive(session)) {
    return `${BRACKETED_PASTE_START}${path}${BRACKETED_PASTE_END}`;
  }
  return `${terminalPathLiteral(path)} `;
}

function terminalImageLogMessage(
  path: string,
  session: TerminalSessionRecord | undefined,
): string {
  if (session && terminalSessionIsCodexActive(session)) {
    return `attached image to Codex terminal: ${shortPath(path)}`;
  }
  return `inserted image path into terminal: ${shortPath(path)}`;
}

function terminalPathLiteral(path: string): string {
  if (looksLikeWindowsPath(path)) {
    return `"${path.replaceAll('"', '\\"')}"`;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function looksLikeWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path) || path.startsWith("\\\\");
}

function mergeTerminalOutputTimestamp(
  session: TerminalSessionRecord,
  data: string,
  receivedAt: number,
): TerminalSessionRecord {
  if (data.length === 0) {
    return session;
  }
  return {
    ...session,
    lastOutputAt: receivedAt,
  };
}
