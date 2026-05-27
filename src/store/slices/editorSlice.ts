import * as commands from "../../lib/tauriCommands";
import type { FileMetadata } from "../../types";
import {
  confirmDiscardIfNeeded,
  formatError,
  hasFileChangedOnDisk,
  isMissingPathError,
  localLog,
  movedPathAfterRename,
  openFileFromPayload,
  parentDir,
  pathIsSameOrChild,
  shortPath,
} from "../helpers";
import type { AppStore, AppStoreSet, AppStoreSlice } from "../types";

type EditorSlice = Pick<
  AppStore,
  | "recentFiles"
  | "fileEntries"
  | "currentDir"
  | "openFile"
  | "editorError"
  | "fileOperationError"
  | "searchFiles"
  | "createFile"
  | "createDir"
  | "renamePath"
  | "deletePath"
  | "clearRecentFiles"
  | "removeRecentFile"
  | "loadDir"
  | "readFile"
  | "updateOpenFileContents"
  | "saveOpenFile"
  | "closeOpenFile"
>;

export const createEditorSlice: AppStoreSlice<EditorSlice> = (set, get) => ({
  recentFiles: [],
  fileEntries: [],
  currentDir: null,
  openFile: null,
  editorError: null,
  fileOperationError: null,

  searchFiles: async (mode, query, root) => {
    try {
      return await commands.fsSearchFiles(mode, query, root);
    } catch (error) {
      get().addLog(localLog("error", `${mode} failed: ${formatError(error)}`));
      return [];
    }
  },

  createFile: async (path, contents = "") => {
    set({ fileOperationError: null });
    try {
      const file = await commands.fsCreateFile(path, contents);
      await get().loadDir(parentDir(file.path));
    } catch (error) {
      const message = formatError(error);
      set({ fileOperationError: message });
      get().addLog(localLog("error", `create file failed: ${message}`));
    }
  },

  createDir: async (path) => {
    set({ fileOperationError: null });
    try {
      const entry = await commands.fsCreateDir(path);
      await get().loadDir(parentDir(entry.path));
    } catch (error) {
      const message = formatError(error);
      set({ fileOperationError: message });
      get().addLog(localLog("error", `create directory failed: ${message}`));
    }
  },

  renamePath: async (from, to) => {
    const openFile = get().openFile;
    const affectsOpenFile = Boolean(openFile && pathIsSameOrChild(openFile.path, from));
    if (
      affectsOpenFile &&
      openFile?.dirty &&
      get().settings.requireConfirmationDiscard &&
      !confirm(`Rename ${shortPath(openFile.path)} while it has unsaved changes?`)
    ) {
      set({ fileOperationError: `Rename canceled; ${shortPath(openFile.path)} has unsaved changes.` });
      return;
    }

    set({ fileOperationError: null });
    try {
      const entry = await commands.fsRename(from, to);
      await get().loadDir(parentDir(entry.path));
      const nextOpenPath = openFile ? movedPathAfterRename(openFile.path, from, entry.path) : null;
      if (nextOpenPath) {
        const metadata = await fetchFileMetadata(nextOpenPath).catch(() => null);
        set((state) => ({
          openFile:
            state.openFile && state.openFile.path === openFile?.path
              ? {
                  ...state.openFile,
                  path: nextOpenPath,
                  metadata,
                  openedModified: metadata?.modified ?? state.openFile.openedModified,
                }
              : state.openFile,
          recentFiles: state.recentFiles.map((item) =>
            movedPathAfterRename(item, from, entry.path) ?? item,
          ),
        }));
        void get().persistUiState();
      }
    } catch (error) {
      const message = formatError(error);
      set({ fileOperationError: message });
      get().addLog(localLog("error", `rename failed: ${message}`));
    }
  },

  deletePath: async (path) => {
    const openFile = get().openFile;
    const affectsOpenFile = Boolean(openFile && pathIsSameOrChild(openFile.path, path));
    if (get().settings.requireConfirmationDelete && !confirm(`Delete ${shortPath(path)}?`)) {
      return;
    }
    if (
      affectsOpenFile &&
      !confirmDiscardIfNeeded(openFile, get().settings, "deleting it")
    ) {
      set({ fileOperationError: `Delete canceled; ${shortPath(path)} has unsaved changes.` });
      return;
    }

    set({ fileOperationError: null });
    try {
      await commands.fsDelete(path);
      await get().loadDir(parentDir(path));
      set((state) => ({
        openFile: affectsOpenFile ? null : state.openFile,
        recentFiles: state.recentFiles.filter((item) => !pathIsSameOrChild(item, path)),
      }));
      void get().persistUiState();
    } catch (error) {
      const message = formatError(error);
      set({ fileOperationError: message });
      get().addLog(localLog("error", `delete failed: ${message}`));
    }
  },

  clearRecentFiles: async () => {
    set({ recentFiles: [] });
    await get().persistUiState();
  },

  removeRecentFile: async (path) => {
    set((state) => ({
      recentFiles: state.recentFiles.filter((item) => item !== path),
    }));
    await get().persistUiState();
  },

  loadDir: async (path) => {
    try {
      const targetPath = path ?? get().selectedEmployee()?.cwd ?? get().workspaceRoot;
      const fileEntries = await commands.fsListDir(targetPath);
      set({ fileEntries, currentDir: targetPath ?? null, fileOperationError: null });
    } catch (error) {
      const message = formatError(error);
      set({ fileOperationError: message });
      get().addLog(localLog("error", `list directory failed: ${message}`));
    }
  },

  readFile: async (path) => {
    const openFile = get().openFile;
    if (!confirmDiscardIfNeeded(openFile, get().settings, "opening another file")) {
      if (openFile) {
        set({ editorError: `Open canceled; ${shortPath(openFile.path)} has unsaved changes.` });
      }
      return;
    }

    set({ editorError: null });
    try {
      const file = await commands.fsReadFile(path);
      const metadata = await fetchFileMetadata(file.path);
      const recentFiles = [file.path, ...get().recentFiles.filter((item) => item !== file.path)].slice(
        0,
        12,
      );
      set({ openFile: openFileFromPayload(file, metadata), recentFiles, editorError: null });
      void get().persistUiState();
    } catch (error) {
      const message = formatError(error);
      const nextState: Partial<AppStore> = { editorError: message };
      if (isMissingPathError(message)) {
        nextState.recentFiles = get().recentFiles.filter((item) => item !== path);
      }
      set(nextState);
      if (nextState.recentFiles) {
        void get().persistUiState();
      }
      get().addLog(localLog("error", `read file failed: ${message}`));
    }
  },

  updateOpenFileContents: (contents) => {
    set((state) => ({
      openFile: state.openFile
        ? {
            ...state.openFile,
            contents,
            dirty: contents !== state.openFile.savedContents,
            saveError: null,
          }
        : null,
      editorError: null,
    }));
  },

  saveOpenFile: async () => {
    const openFile = get().openFile;
    if (!openFile) {
      return;
    }
    set((state) => ({
      openFile: state.openFile
        ? { ...state.openFile, saveError: null }
        : state.openFile,
      editorError: null,
    }));
    try {
      const diskMetadata = await fetchFileMetadata(openFile.path);
      if (hasFileChangedOnDisk(openFile, diskMetadata)) {
        const confirmed = confirm(
          `${shortPath(openFile.path)} changed on disk since it was opened. Overwrite it?`,
        );
        if (!confirmed) {
          const message = "Save canceled because the file changed on disk.";
          setOpenFileSaveError(set, openFile.path, message);
          return;
        }
      }

      await commands.fsWriteFile(openFile.path, openFile.contents);
      const metadata = await fetchFileMetadata(openFile.path);
      const savedAt = Date.now();
      set((state) => {
        if (!state.openFile || state.openFile.path !== openFile.path) {
          return {};
        }
        return {
          openFile: {
            ...state.openFile,
            savedContents: openFile.contents,
            dirty: state.openFile.contents !== openFile.contents,
            lastSavedAt: savedAt,
            saveError: null,
            metadata,
            openedModified: metadata.modified ?? null,
          },
        };
      });
      get().addLog(localLog("info", `saved ${shortPath(openFile.path)}`));
    } catch (error) {
      const message = formatError(error);
      setOpenFileSaveError(set, openFile.path, message);
      get().addLog(localLog("error", `save file failed: ${message}`));
    }
  },

  closeOpenFile: () => {
    const openFile = get().openFile;
    if (!confirmDiscardIfNeeded(openFile, get().settings, "closing it")) {
      if (openFile) {
        set({ editorError: `Close canceled; ${shortPath(openFile.path)} has unsaved changes.` });
      }
      return;
    }
    set({ openFile: null, editorError: null });
  },
});

async function fetchFileMetadata(path: string): Promise<FileMetadata> {
  return commands.fsFileMetadata(path);
}

function setOpenFileSaveError(
  setState: AppStoreSet,
  path: string,
  message: string,
): void {
  setState((state) => ({
    openFile:
      state.openFile && state.openFile.path === path
        ? { ...state.openFile, saveError: message }
        : state.openFile,
    editorError: message,
  }));
}
