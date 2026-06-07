import * as commands from "../../lib/tauriCommands";
import { formatError, localLog, reviewFileKey } from "../helpers";
import type { AppStore, AppStoreGet, AppStoreSlice } from "../types";

type ReviewSlice = Pick<
  AppStore,
  | "worktreeStatuses"
  | "worktreeDiffs"
  | "worktreeReviews"
  | "worktreeCommits"
  | "worktreeHandoffs"
  | "worktreeHandoffResults"
  | "worktreeChangedFiles"
  | "worktreeFileDiffs"
  | "selectedReviewFiles"
  | "gitPathChanges"
  | "gitPathFileDiffs"
  | "selectedGitChangedFiles"
  | "createWorktree"
  | "removeWorktree"
  | "loadWorktreeStatus"
  | "loadWorktreeDiff"
  | "loadWorktreeReview"
  | "loadWorktreeCommits"
  | "loadWorktreeHandoff"
  | "loadWorktreeChangedFiles"
  | "loadWorktreeFileDiff"
  | "stageWorktreeFile"
  | "unstageWorktreeFile"
  | "discardWorktreeFile"
  | "deleteUntrackedWorktreeFile"
  | "commitWorktree"
  | "applyWorktreeHandoff"
  | "abortWorktreeHandoff"
  | "selectReviewFile"
  | "loadGitChangesForPath"
  | "loadGitFileDiffForPath"
  | "selectGitChangedFile"
>;

export const createReviewSlice: AppStoreSlice<ReviewSlice> = (set, get) => ({
  worktreeStatuses: {},
  worktreeDiffs: {},
  worktreeReviews: {},
  worktreeCommits: {},
  worktreeHandoffs: {},
  worktreeHandoffResults: {},
  worktreeChangedFiles: {},
  worktreeFileDiffs: {},
  selectedReviewFiles: {},
  gitPathChanges: {},
  gitPathFileDiffs: {},
  selectedGitChangedFiles: {},

  createWorktree: async (employeeId) => {
    try {
      const employee = await commands.gitWorktreeCreateForEmployee(employeeId);
      get().upsertEmployee(employee);
      await get().loadWorktreeStatus(employee.id);
      await get().loadWorktreeChangedFiles(employee.id);
      await get().loadDir(employee.cwd);
    } catch (error) {
      get().addLog(localLog("error", `create worktree failed: ${formatError(error)}`));
    }
  },

  removeWorktree: async (employeeId) => {
    try {
      const employee = await commands.gitWorktreeRemoveForEmployee(employeeId);
      get().upsertEmployee(employee);
      set((state) => {
        const { [employeeId]: _status, ...worktreeStatuses } = state.worktreeStatuses;
        const { [employeeId]: _diff, ...worktreeDiffs } = state.worktreeDiffs;
        const { [employeeId]: _review, ...worktreeReviews } = state.worktreeReviews;
        const { [employeeId]: _commits, ...worktreeCommits } = state.worktreeCommits;
        const { [employeeId]: _handoff, ...worktreeHandoffs } = state.worktreeHandoffs;
        const { [employeeId]: _handoffResult, ...worktreeHandoffResults } =
          state.worktreeHandoffResults;
        const { [employeeId]: _changed, ...worktreeChangedFiles } = state.worktreeChangedFiles;
        const { [employeeId]: _selected, ...selectedReviewFiles } = state.selectedReviewFiles;
        const worktreeFileDiffs = Object.fromEntries(
          Object.entries(state.worktreeFileDiffs).filter(
            ([key]) => !key.startsWith(`${employeeId}:`),
          ),
        );
        return {
          worktreeStatuses,
          worktreeDiffs,
          worktreeReviews,
          worktreeCommits,
          worktreeHandoffs,
          worktreeHandoffResults,
          worktreeChangedFiles,
          selectedReviewFiles,
          worktreeFileDiffs,
        };
      });
      await get().loadDir(employee.cwd);
    } catch (error) {
      get().addLog(localLog("error", `remove worktree failed: ${formatError(error)}`));
    }
  },

  loadWorktreeStatus: async (employeeId) => {
    try {
      const status = await commands.gitWorktreeStatusForEmployee(employeeId);
      set((state) => ({
        worktreeStatuses: { ...state.worktreeStatuses, [employeeId]: status },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree status failed: ${formatError(error)}`));
    }
  },

  loadGitChangesForPath: async (path) => {
    try {
      const changes = await commands.gitChangesForPath(path);
      const requestedKey = gitPathKey(path);
      const key = gitPathKey(changes.root);
      const selected = get().selectedGitChangedFiles[key];
      const nextSelected =
        selected && changes.changedFiles.includes(selected)
          ? selected
          : changes.changedFiles[0] ?? null;
      set((state) => ({
        gitPathChanges: {
          ...state.gitPathChanges,
          [requestedKey]: changes,
          [key]: changes,
        },
        selectedGitChangedFiles: {
          ...state.selectedGitChangedFiles,
          [requestedKey]: nextSelected,
          [key]: nextSelected,
        },
      }));
      if (nextSelected) {
        await get().loadGitFileDiffForPath(changes.root, nextSelected);
      }
    } catch (error) {
      get().addLog(localLog("warn", `git changes failed: ${formatError(error)}`));
    }
  },

  loadGitFileDiffForPath: async (root, path) => {
    try {
      const diff = await commands.gitFileDiffForPath(root, path);
      const key = gitPathKey(root);
      set((state) => ({
        selectedGitChangedFiles: { ...state.selectedGitChangedFiles, [key]: path },
        gitPathFileDiffs: {
          ...state.gitPathFileDiffs,
          [gitPathFileKey(root, path)]: diff,
        },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `git file diff failed: ${formatError(error)}`));
    }
  },

  loadWorktreeDiff: async (employeeId) => {
    try {
      const diff = await commands.gitWorktreeDiffForEmployee(employeeId);
      set((state) => ({
        worktreeDiffs: { ...state.worktreeDiffs, [employeeId]: diff },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree diff failed: ${formatError(error)}`));
    }
  },

  loadWorktreeReview: async (employeeId) => {
    try {
      const review = await commands.gitWorktreeReviewForEmployee(employeeId);
      const selected = get().selectedReviewFiles[employeeId];
      const nextSelected =
        selected && review.changedFiles.includes(selected)
          ? selected
          : review.changedFiles[0] ?? null;
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
        worktreeChangedFiles: { ...state.worktreeChangedFiles, [employeeId]: review.changedFiles },
        worktreeCommits: { ...state.worktreeCommits, [employeeId]: review.recentCommits },
        worktreeHandoffs: review.handoff
          ? { ...state.worktreeHandoffs, [employeeId]: review.handoff }
          : Object.fromEntries(
              Object.entries(state.worktreeHandoffs).filter(([key]) => key !== employeeId),
            ),
        selectedReviewFiles: { ...state.selectedReviewFiles, [employeeId]: nextSelected },
      }));
      if (nextSelected) {
        await get().loadWorktreeFileDiff(employeeId, nextSelected);
      }
    } catch (error) {
      get().addLog(localLog("warn", `worktree review failed: ${formatError(error)}`));
    }
  },

  loadWorktreeCommits: async (employeeId) => {
    try {
      const commits = await commands.gitWorktreeLogForEmployee(employeeId, 5);
      set((state) => ({
        worktreeCommits: { ...state.worktreeCommits, [employeeId]: commits },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree log failed: ${formatError(error)}`));
    }
  },

  loadWorktreeHandoff: async (employeeId) => {
    try {
      const handoff = await commands.gitWorktreeHandoffPreflightForEmployee(employeeId);
      set((state) => ({
        worktreeHandoffs: { ...state.worktreeHandoffs, [employeeId]: handoff },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `handoff preflight failed: ${formatError(error)}`));
    }
  },

  loadWorktreeChangedFiles: async (employeeId) => {
    try {
      const files = await commands.gitWorktreeChangedFilesForEmployee(employeeId);
      const selected = get().selectedReviewFiles[employeeId];
      const nextSelected = selected && files.includes(selected) ? selected : files[0] ?? null;
      set((state) => ({
        worktreeChangedFiles: { ...state.worktreeChangedFiles, [employeeId]: files },
        selectedReviewFiles: { ...state.selectedReviewFiles, [employeeId]: nextSelected },
      }));
      if (nextSelected) {
        await get().loadWorktreeFileDiff(employeeId, nextSelected);
      }
    } catch (error) {
      get().addLog(localLog("warn", `changed files failed: ${formatError(error)}`));
    }
  },

  loadWorktreeFileDiff: async (employeeId, path) => {
    try {
      const diff = await commands.gitWorktreeFileDiffForEmployee(employeeId, path);
      set((state) => ({
        selectedReviewFiles: { ...state.selectedReviewFiles, [employeeId]: path },
        worktreeFileDiffs: {
          ...state.worktreeFileDiffs,
          [reviewFileKey(employeeId, path)]: diff,
        },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `file diff failed: ${formatError(error)}`));
    }
  },

  stageWorktreeFile: async (employeeId, path) => {
    try {
      const review = await commands.gitWorktreeStageFile(employeeId, path);
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
      }));
      await get().loadWorktreeChangedFiles(employeeId);
      await get().loadWorktreeStatus(employeeId);
      await get().loadWorktreeFileDiff(employeeId, path);
    } catch (error) {
      get().addLog(localLog("error", `stage file failed: ${formatError(error)}`));
    }
  },

  unstageWorktreeFile: async (employeeId, path) => {
    try {
      const review = await commands.gitWorktreeUnstageFile(employeeId, path);
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
      }));
      await get().loadWorktreeChangedFiles(employeeId);
      await get().loadWorktreeStatus(employeeId);
      await get().loadWorktreeFileDiff(employeeId, path);
    } catch (error) {
      get().addLog(localLog("error", `unstage file failed: ${formatError(error)}`));
    }
  },

  discardWorktreeFile: async (employeeId, path) => {
    try {
      const review = await commands.gitWorktreeDiscardFileForEmployee(employeeId, path);
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
      }));
      await get().loadWorktreeChangedFiles(employeeId);
      await get().loadWorktreeStatus(employeeId);
    } catch (error) {
      get().addLog(localLog("error", `discard file failed: ${formatError(error)}`));
    }
  },

  deleteUntrackedWorktreeFile: async (employeeId, path) => {
    try {
      const review = await commands.gitWorktreeDeleteUntrackedFileForEmployee(employeeId, path);
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
      }));
      await get().loadWorktreeChangedFiles(employeeId);
      await get().loadWorktreeStatus(employeeId);
    } catch (error) {
      get().addLog(localLog("error", `delete untracked file failed: ${formatError(error)}`));
    }
  },

  commitWorktree: async (employeeId, message) => {
    try {
      const commit = await commands.gitWorktreeCommitForEmployee(employeeId, message);
      set((state) => ({
        worktreeCommits: {
          ...state.worktreeCommits,
          [employeeId]: [commit, ...(state.worktreeCommits[employeeId] ?? [])]
            .filter(
              (item, index, commits) =>
                commits.findIndex((candidate) => candidate.hash === item.hash) === index,
            )
            .slice(0, 5),
        },
      }));
      get().addLog(localLog("info", `committed ${commit.shortHash}: ${commit.message}`));
      await refreshWorktreeReviewForEmployee(get, employeeId);
      await get().loadWorktreeCommits(employeeId);
      await get().loadWorktreeHandoff(employeeId);
    } catch (error) {
      get().addLog(localLog("error", `commit failed: ${formatError(error)}`));
    }
  },

  applyWorktreeHandoff: async (employeeId) => {
    try {
      const result = await commands.gitWorktreeApplyHandoffForEmployee(employeeId);
      set((state) => ({
        worktreeHandoffResults: { ...state.worktreeHandoffResults, [employeeId]: result },
      }));
      if (result.applied) {
        get().addLog(
          localLog("info", `applied ${result.appliedCommits.length} handoff commit(s)`),
        );
      } else if (result.conflict) {
        get().addLog(localLog("warn", "handoff stopped with conflicts in main workspace"));
      } else {
        get().addLog(localLog("error", `handoff apply failed: ${result.error ?? "unknown error"}`));
      }
      await refreshWorktreeReviewForEmployee(get, employeeId);
      await get().loadWorktreeCommits(employeeId);
      await get().loadWorktreeHandoff(employeeId);
    } catch (error) {
      get().addLog(localLog("error", `handoff apply failed: ${formatError(error)}`));
      await get().loadWorktreeHandoff(employeeId);
    }
  },

  abortWorktreeHandoff: async (employeeId) => {
    try {
      const result = await commands.gitWorktreeAbortHandoffForEmployee(employeeId);
      get().addLog(
        localLog(result.aborted ? "info" : "warn", result.message || "handoff abort checked"),
      );
      await refreshWorktreeReviewForEmployee(get, employeeId);
      await get().loadWorktreeHandoff(employeeId);
    } catch (error) {
      get().addLog(localLog("error", `handoff abort failed: ${formatError(error)}`));
      await get().loadWorktreeHandoff(employeeId);
    }
  },

  selectReviewFile: (employeeId, path) => {
    set((state) => ({
      selectedReviewFiles: { ...state.selectedReviewFiles, [employeeId]: path },
    }));
    if (path) {
      void get().loadWorktreeFileDiff(employeeId, path);
    }
  },

  selectGitChangedFile: (root, path) => {
    const key = gitPathKey(root);
    set((state) => ({
      selectedGitChangedFiles: { ...state.selectedGitChangedFiles, [key]: path },
    }));
    if (path) {
      void get().loadGitFileDiffForPath(root, path);
    }
  },
});

export function gitPathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function gitPathFileKey(root: string, path: string): string {
  return `${gitPathKey(root)}:${path}`;
}

export async function refreshWorktreeReviewForEmployee(
  get: AppStoreGet,
  employeeId: string,
): Promise<void> {
  const employee = get().employees.find((item) => item.id === employeeId);
  if (!employee?.worktreePath) {
    return;
  }

  await Promise.all([
    get().loadWorktreeStatus(employeeId),
    get().loadWorktreeReview(employeeId),
  ]);
}
