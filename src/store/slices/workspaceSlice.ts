import * as commands from "../../lib/tauriCommands";
import type { WorkspaceInfo } from "../../types";
import {
  DEFAULT_SETTINGS,
  confirmDiscardIfNeeded,
  formatError,
  localLog,
  normalizeSettings,
  shortPath,
} from "../helpers";
import type { AppStore, AppStoreSet, AppStoreSlice } from "../types";

type WorkspaceSlice = Pick<
  AppStore,
  | "workspaceRoot"
  | "workspaceInfo"
  | "recentWorkspaces"
  | "settings"
  | "workspaceLoading"
  | "workspaceError"
  | "codexCliStatus"
  | "codexCliStatusLoading"
  | "rolePolicies"
  | "loadWorkspaceInfo"
  | "setWorkspaceRoot"
  | "clearRecentWorkspaces"
  | "updateSettings"
  | "loadCodexCliStatus"
>;

export const createWorkspaceSlice: AppStoreSlice<WorkspaceSlice> = (set, get) => ({
  workspaceRoot: null,
  workspaceInfo: null,
  recentWorkspaces: [],
  settings: DEFAULT_SETTINGS,
  workspaceLoading: false,
  workspaceError: null,
  codexCliStatus: null,
  codexCliStatusLoading: false,
  rolePolicies: [],

  loadWorkspaceInfo: async () => {
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspaceInfo = await commands.workspaceInfo();
      set({
        workspaceInfo,
        workspaceRoot: workspaceInfo.workspaceRoot,
        recentWorkspaces: workspaceInfo.recentWorkspaces,
        settings: normalizeSettings(workspaceInfo.settings),
        codexCliStatus: workspaceInfo.repoHealth.codexCliStatus,
        workspaceLoading: false,
        workspaceError: null,
      });
    } catch (error) {
      const message = formatError(error);
      set({ workspaceLoading: false, workspaceError: message });
      get().addLog(localLog("warn", `workspace info failed: ${message}`));
    }
  },

  setWorkspaceRoot: async (path) => {
    const trimmed = path.trim();
    if (!trimmed) {
      get().addLog(localLog("warn", "workspace path is required"));
      return;
    }
    const openFile = get().openFile;
    if (!confirmDiscardIfNeeded(openFile, get().settings, "switching workspace")) {
      const message = openFile
        ? `Workspace switch canceled; ${shortPath(openFile.path)} has unsaved changes.`
        : "Workspace switch canceled.";
      set({ workspaceError: message });
      return;
    }
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspaceInfo = await commands.workspaceSetRoot(trimmed);
      resetWorkspaceFrontendState(set, workspaceInfo);
      await get().loadDir(workspaceInfo.workspaceRoot);
    } catch (error) {
      const message = formatError(error);
      set({ workspaceLoading: false, workspaceError: message });
      get().addLog(localLog("error", `open workspace failed: ${message}`));
    }
  },

  clearRecentWorkspaces: async () => {
    try {
      const recentWorkspaces = await commands.workspaceRecentClear();
      set((state) => ({
        recentWorkspaces,
        workspaceInfo: state.workspaceInfo
          ? { ...state.workspaceInfo, recentWorkspaces }
          : state.workspaceInfo,
      }));
    } catch (error) {
      get().addLog(localLog("warn", `clear recent workspaces failed: ${formatError(error)}`));
    }
  },

  updateSettings: async (settingsUpdate) => {
    try {
      const settings = normalizeSettings(await commands.settingsUpdate(settingsUpdate));
      set((state) => ({
        settings,
        workspaceInfo: state.workspaceInfo
          ? { ...state.workspaceInfo, settings }
          : state.workspaceInfo,
      }));
    } catch (error) {
      get().addLog(localLog("error", `update settings failed: ${formatError(error)}`));
    }
  },

  loadCodexCliStatus: async () => {
    set({ codexCliStatus: null, codexCliStatusLoading: true });
    try {
      const codexCliStatus = await commands.codexCliStatus();
      set((state) => ({
        codexCliStatus,
        codexCliStatusLoading: false,
        workspaceInfo: state.workspaceInfo
          ? {
              ...state.workspaceInfo,
              repoHealth: { ...state.workspaceInfo.repoHealth, codexCliStatus },
            }
          : state.workspaceInfo,
      }));
    } catch (error) {
      const codexCliStatus = {
        available: false,
        version: null,
        message: `Codex status failed: ${formatError(error)}`,
      };
      set((state) => ({
        codexCliStatus,
        codexCliStatusLoading: false,
        workspaceInfo: state.workspaceInfo
          ? {
              ...state.workspaceInfo,
              repoHealth: { ...state.workspaceInfo.repoHealth, codexCliStatus },
            }
          : state.workspaceInfo,
      }));
      get().addLog(localLog("warn", `Codex status failed: ${formatError(error)}`));
    }
  },
});

function resetWorkspaceFrontendState(
  setState: AppStoreSet,
  workspaceInfo: WorkspaceInfo,
): void {
  setState({
    employees: [],
    employeeActivities: {},
    selectedEmployeeId: null,
    workspaceRoot: workspaceInfo.workspaceRoot,
    workspaceInfo,
    recentWorkspaces: workspaceInfo.recentWorkspaces,
    settings: normalizeSettings(workspaceInfo.settings),
    workspaceLoading: false,
    workspaceError: null,
    terminalBuffers: {},
    terminalSessions: [],
    approvals: [],
    actions: [],
    processes: [],
    processLogs: {},
    codexCliStatus: workspaceInfo.repoHealth.codexCliStatus,
    worktreeStatuses: {},
    worktreeDiffs: {},
    worktreeReviews: {},
    worktreeCommits: {},
    worktreeHandoffs: {},
    worktreeHandoffResults: {},
    worktreeChangedFiles: {},
    worktreeFileDiffs: {},
    selectedReviewFiles: {},
    recentFiles: [],
    activeTab: "terminal",
    fileEntries: [],
    currentDir: workspaceInfo.workspaceRoot,
    openFile: null,
    editorError: null,
    fileOperationError: null,
  });
}
