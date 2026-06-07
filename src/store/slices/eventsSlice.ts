import * as commands from "../../lib/tauriCommands";
import { formatError, localLog } from "../helpers";
import type { AppStore, AppStoreSlice } from "../types";

type EventsSlice = Pick<
  AppStore,
  "activeTab" | "logs" | "setActiveTab" | "addLog" | "persistUiState"
>;

export const createEventsSlice: AppStoreSlice<EventsSlice> = (set, get) => ({
  activeTab: "office",
  logs: [],

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    void get().persistUiState();
  },

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs.slice(-199), log],
    })),

  persistUiState: async () => {
    try {
      await commands.appStateSave({
        selectedEmployeeId: get().selectedEmployeeId,
        activeTab: get().activeTab,
        recentFiles: get().recentFiles,
      });
    } catch (error) {
      get().addLog(localLog("warn", `persist UI state failed: ${formatError(error)}`));
    }
  },
});
