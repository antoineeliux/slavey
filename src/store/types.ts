import type { UnlistenFn } from "@tauri-apps/api/event";
import type { StateCreator } from "zustand";

import type {
  CreateActionInput,
  CreateApprovalInput,
  CreateEmployeeInput,
} from "../lib/tauriCommands";
import type {
  Action,
  AppLog,
  AppSettings,
  AppSettingsUpdate,
  AppTab,
  ApprovalRequest,
  CodexCliStatus,
  CodexTaskSubmitInput,
  Employee,
  EmployeeActivity,
  FileMetadata,
  FsEntry,
  FsSearchResult,
  GitPathChanges,
  ManagedProcess,
  ProcessLogs,
  RolePolicy,
  TerminalDataPayload,
  TerminalImageUploadInput,
  TerminalImageUploadPathInput,
  TerminalSessionRecord,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
  WorktreeStatus,
  WorkspaceInfo,
} from "../types";
import type { OpenFile } from "./helpers";

export type AppStore = {
  employees: Employee[];
  employeeActivities: Record<string, EmployeeActivity>;
  selectedEmployeeId: string | null;
  workspaceRoot: string | null;
  workspaceInfo: WorkspaceInfo | null;
  recentWorkspaces: string[];
  settings: AppSettings;
  workspaceLoading: boolean;
  workspaceError: string | null;
  terminalBuffers: Record<string, string>;
  terminalSessions: TerminalSessionRecord[];
  logs: AppLog[];
  approvals: ApprovalRequest[];
  actions: Action[];
  processes: ManagedProcess[];
  processLogs: Record<string, ProcessLogs>;
  codexCliStatus: CodexCliStatus | null;
  codexCliStatusLoading: boolean;
  rolePolicies: RolePolicy[];
  worktreeStatuses: Record<string, WorktreeStatus>;
  worktreeDiffs: Record<string, string>;
  worktreeReviews: Record<string, WorktreeReview>;
  worktreeCommits: Record<string, WorktreeCommit[]>;
  worktreeHandoffs: Record<string, WorktreeHandoffPreflight>;
  worktreeHandoffResults: Record<string, WorktreeHandoffApplyResult>;
  worktreeChangedFiles: Record<string, string[]>;
  worktreeFileDiffs: Record<string, string>;
  selectedReviewFiles: Record<string, string | null>;
  gitPathChanges: Record<string, GitPathChanges>;
  gitPathFileDiffs: Record<string, string>;
  selectedGitChangedFiles: Record<string, string | null>;
  recentFiles: string[];
  activeTab: AppTab;
  fileEntries: FsEntry[];
  currentDir: string | null;
  openFile: OpenFile | null;
  editorError: string | null;
  fileOperationError: string | null;
  backendReady: boolean;
  setActiveTab: (tab: AppTab) => void;
  selectedEmployee: () => Employee | null;
  bootstrap: () => Promise<void>;
  connectEvents: () => Promise<UnlistenFn[]>;
  loadWorkspaceInfo: () => Promise<void>;
  loadEmployeeActivities: () => Promise<void>;
  refreshEmployeeActivity: (employeeId: string) => Promise<void>;
  setWorkspaceRoot: (path: string) => Promise<void>;
  clearRecentWorkspaces: () => Promise<void>;
  updateSettings: (settings: AppSettingsUpdate) => Promise<void>;
  createEmployee: (input: CreateEmployeeInput) => Promise<void>;
  removeEmployee: (employeeId: string) => Promise<void>;
  selectEmployee: (employeeId: string | null) => Promise<void>;
  setEmployeeWorkingFolder: (employeeId: string, path: string) => Promise<void>;
  startTerminal: (employeeId: string) => Promise<void>;
  submitCodexTask: (input: CodexTaskSubmitInput) => Promise<void>;
  setEmployeeStandby: (employeeId: string) => Promise<void>;
  resumeEmployeeFromStandby: (employeeId: string) => Promise<void>;
  stopTerminal: (employeeId: string) => Promise<void>;
  stopTerminalSession: (employeeId: string, sessionId: string) => Promise<void>;
  renameTerminalSession: (employeeId: string, sessionId: string, label: string) => Promise<void>;
  loadCodexCliStatus: () => Promise<void>;
  loadTerminalSessions: (employeeId?: string | null) => Promise<void>;
  loadTerminalBuffer: (employeeId: string, sessionId: string) => Promise<void>;
  createWorktree: (employeeId: string) => Promise<void>;
  removeWorktree: (employeeId: string) => Promise<void>;
  createApproval: (input: CreateApprovalInput) => Promise<void>;
  approveApproval: (approvalId: string) => Promise<void>;
  rejectApproval: (approvalId: string) => Promise<void>;
  createAction: (input: CreateActionInput) => Promise<void>;
  requestActionApproval: (actionId: string) => Promise<void>;
  approveAction: (actionId: string) => Promise<void>;
  rejectAction: (actionId: string) => Promise<void>;
  runAction: (actionId: string) => Promise<void>;
  cancelAction: (actionId: string) => Promise<void>;
  loadWorktreeStatus: (employeeId: string) => Promise<void>;
  loadWorktreeDiff: (employeeId: string) => Promise<void>;
  loadWorktreeReview: (employeeId: string) => Promise<void>;
  loadWorktreeCommits: (employeeId: string) => Promise<void>;
  loadWorktreeHandoff: (employeeId: string) => Promise<void>;
  loadWorktreeChangedFiles: (employeeId: string) => Promise<void>;
  loadWorktreeFileDiff: (employeeId: string, path: string) => Promise<void>;
  stageWorktreeFile: (employeeId: string, path: string) => Promise<void>;
  unstageWorktreeFile: (employeeId: string, path: string) => Promise<void>;
  discardWorktreeFile: (employeeId: string, path: string) => Promise<void>;
  deleteUntrackedWorktreeFile: (employeeId: string, path: string) => Promise<void>;
  commitWorktree: (employeeId: string, message: string) => Promise<void>;
  applyWorktreeHandoff: (employeeId: string) => Promise<void>;
  abortWorktreeHandoff: (employeeId: string) => Promise<void>;
  selectReviewFile: (employeeId: string, path: string | null) => void;
  loadGitChangesForPath: (path: string) => Promise<void>;
  loadGitFileDiffForPath: (root: string, path: string) => Promise<void>;
  selectGitChangedFile: (root: string, path: string | null) => void;
  spawnProcess: (employeeId: string | null, command: string, cwd: string, title?: string) => Promise<void>;
  killProcess: (processId: string) => Promise<void>;
  loadProcessLogs: (processId: string, offset?: number | null) => Promise<void>;
  upsertProcess: (process: ManagedProcess) => void;
  appendProcessLog: (payload: ProcessLogs) => void;
  searchFiles: (mode: "search" | "grep" | "glob", query: string, root?: string | null) => Promise<FsSearchResult[]>;
  createFile: (path: string, contents?: string) => Promise<void>;
  createDir: (path: string) => Promise<void>;
  renamePath: (from: string, to: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  removeRecentFile: (path: string) => Promise<void>;
  writeTerminal: (employeeId: string, sessionId: string, input: string) => Promise<void>;
  insertTerminalImage: (
    employeeId: string,
    sessionId: string,
    image: TerminalImageUploadInput,
  ) => Promise<boolean>;
  insertTerminalImagePath: (
    employeeId: string,
    sessionId: string,
    image: TerminalImageUploadPathInput,
  ) => Promise<boolean>;
  resizeTerminal: (employeeId: string, sessionId: string, cols: number, rows: number) => Promise<void>;
  appendTerminalData: (payload: TerminalDataPayload) => void;
  upsertTerminalSession: (session: TerminalSessionRecord) => void;
  upsertEmployee: (employee: Employee) => void;
  upsertApproval: (approval: ApprovalRequest) => void;
  upsertAction: (action: Action) => void;
  loadDir: (path?: string | null) => Promise<void>;
  readFile: (path: string) => Promise<void>;
  updateOpenFileContents: (contents: string) => void;
  saveOpenFile: () => Promise<void>;
  closeOpenFile: () => void;
  addLog: (log: AppLog) => void;
  persistUiState: () => Promise<void>;
};

type AppStoreCreator = StateCreator<AppStore, [], [], AppStore>;

export type AppStoreSet = Parameters<AppStoreCreator>[0];
export type AppStoreGet = Parameters<AppStoreCreator>[1];
export type AppStoreSlice<T extends Partial<AppStore>> = (
  set: AppStoreSet,
  get: AppStoreGet,
) => T;
