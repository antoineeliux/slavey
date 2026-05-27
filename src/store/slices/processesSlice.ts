import * as commands from "../../lib/tauriCommands";
import { formatError, localLog } from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";

type ProcessesSlice = Pick<
  AppStore,
  | "processes"
  | "processLogs"
  | "spawnProcess"
  | "killProcess"
  | "loadProcessLogs"
  | "upsertProcess"
  | "appendProcessLog"
>;

export const createProcessesSlice: AppStoreSlice<ProcessesSlice> = (set, get) => ({
  processes: [],
  processLogs: {},

  spawnProcess: async (employeeId, command, cwd, title) => {
    try {
      const process = await commands.processSpawn({
        employeeId,
        title: title ?? command,
        command,
        cwd,
      });
      get().upsertProcess(process);
    } catch (error) {
      get().addLog(localLog("error", `spawn process failed: ${formatError(error)}`));
    }
  },

  killProcess: async (processId) => {
    try {
      const process = await commands.processKill(processId);
      get().upsertProcess(process);
    } catch (error) {
      get().addLog(localLog("error", `kill process failed: ${formatError(error)}`));
    }
  },

  loadProcessLogs: async (processId, offset) => {
    try {
      const logs = await commands.processLogs(processId, offset);
      set((state) => ({
        processLogs: { ...state.processLogs, [processId]: logs },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `load process logs failed: ${formatError(error)}`));
    }
  },

  upsertProcess: (process) => {
    set((state) => {
      const exists = state.processes.some((item) => item.id === process.id);
      const processes = exists
        ? state.processes.map((item) => (item.id === process.id ? process : item))
        : [...state.processes, process];
      processes.sort((a, b) => a.createdAt - b.createdAt);
      return { processes };
    });
  },

  appendProcessLog: (payload) => {
    set((state) => {
      const existing = state.processLogs[payload.processId];
      const contents =
        existing && payload.baseOffset === existing.baseOffset
          ? `${existing.contents}${payload.contents}`.slice(-1_000_000)
          : payload.contents;
      return {
        processLogs: {
          ...state.processLogs,
          [payload.processId]: { ...payload, contents },
        },
      };
    });
  },
});
