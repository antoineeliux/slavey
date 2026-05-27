import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import type {
  Action,
  ActionKind,
  ActionUpdatedPayload,
  AppLog,
  AppSettings,
  AppSettingsUpdate,
  AppStateSnapshot,
  AppTab,
  ApprovalRequest,
  ApprovalUpdatedPayload,
  CodexCliStatus,
  Employee,
  EmployeeActivity,
  EmployeeActivityUpdatedPayload,
  EmployeeRole,
  EmployeeUpdatedPayload,
  FileMetadata,
  FilePayload,
  FsEntry,
  FsSearchResult,
  ManagedProcess,
  ProcessLogs,
  ProcessUpdatedPayload,
  RolePolicy,
  TerminalDataPayload,
  TerminalSessionRecord,
  TerminalSessionUpdatedPayload,
  WorktreeCommit,
  WorktreeHandoffApplyResult,
  WorktreeHandoffPreflight,
  WorktreeReview,
  WorktreeStatus,
  WorkspaceInfo,
} from "../types";

const MAX_TERMINAL_BUFFER_CHARS = 250_000;
const TERMINAL_TRUNCATION_MARKER = "\n[... earlier output truncated ...]\n";
const DEFAULT_SETTINGS: AppSettings = {
  defaultTerminalProfile: "shell",
  requireConfirmationDiscard: true,
  requireConfirmationDelete: true,
  requireConfirmationHandoffApply: true,
  maxTerminalBufferChars: MAX_TERMINAL_BUFFER_CHARS,
};

type OpenFile = {
  path: string;
  savedContents: string;
  contents: string;
  dirty: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  metadata: FileMetadata | null;
  openedModified: number | null;
};

type CreateEmployeeInput = {
  name: string;
  role: EmployeeRole;
  cwd?: string;
};

type CreateApprovalInput = {
  employeeId: string;
  actionId?: string | null;
  kind: ApprovalRequest["kind"];
  title: string;
  description: string;
  command?: string | null;
  path?: string | null;
  cwd?: string | null;
};

type CreateActionInput = {
  employeeId: string;
  kind: ActionKind;
  title: string;
  description: string;
  cwd?: string | null;
  command?: string | null;
  path?: string | null;
  contents?: string | null;
  timeoutSecs?: number | null;
};

type AppStore = {
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
  selectEmployee: (employeeId: string) => Promise<void>;
  startTerminal: (employeeId: string) => Promise<void>;
  startCodexTerminal: (employeeId: string) => Promise<void>;
  stopTerminal: (employeeId: string) => Promise<void>;
  stopTerminalSession: (employeeId: string, sessionId: string) => Promise<void>;
  renameTerminalSession: (employeeId: string, sessionId: string, label: string) => Promise<void>;
  loadCodexCliStatus: () => Promise<void>;
  loadTerminalSessions: (employeeId?: string | null) => Promise<void>;
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

export const useAppStore = create<AppStore>((set, get) => ({
  employees: [],
  employeeActivities: {},
  selectedEmployeeId: null,
  workspaceRoot: null,
  workspaceInfo: null,
  recentWorkspaces: [],
  settings: DEFAULT_SETTINGS,
  workspaceLoading: false,
  workspaceError: null,
  terminalBuffers: {},
  terminalSessions: [],
  logs: [],
  approvals: [],
  actions: [],
  processes: [],
  processLogs: {},
  codexCliStatus: null,
  codexCliStatusLoading: false,
  rolePolicies: [],
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
  currentDir: null,
  openFile: null,
  editorError: null,
  fileOperationError: null,
  backendReady: false,

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    void get().persistUiState();
  },

  selectedEmployee: () => {
    const { employees, selectedEmployeeId } = get();
    return employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  },

  bootstrap: async () => {
    try {
      const snapshot = await invoke<AppStateSnapshot>("app_state_load");
      const workspaceInfo = await invoke<WorkspaceInfo>("workspace_info");
      const approvals = await invoke<ApprovalRequest[]>("approval_list");
      const actions = await invoke<Action[]>("action_list");
      const processes = await invoke<ManagedProcess[]>("process_list");
      const employeeActivities = await invoke<EmployeeActivity[]>("employee_activity_list");
      const rolePolicies = await invoke<RolePolicy[]>("employee_role_policies");
      const workspaceRoot = workspaceInfo.workspaceRoot || snapshot.workspaceRoot;
      const settings = normalizeSettings(workspaceInfo.settings ?? snapshot.settings);
      const selectedEmployeeId =
        snapshot.selectedEmployeeId &&
        snapshot.employees.some((employee) => employee.id === snapshot.selectedEmployeeId)
          ? snapshot.selectedEmployeeId
          : snapshot.employees[0]?.id ?? null;
      set({
        employees: snapshot.employees,
        employeeActivities: activitiesByEmployee(employeeActivities),
        terminalSessions: snapshot.terminalSessions ?? [],
        selectedEmployeeId,
        workspaceRoot,
        workspaceInfo,
        recentWorkspaces: workspaceInfo.recentWorkspaces ?? snapshot.recentWorkspaces ?? [],
        settings,
        codexCliStatus: workspaceInfo.repoHealth.codexCliStatus,
        workspaceError: null,
        activeTab: snapshot.activeTab ?? "terminal",
        recentFiles: snapshot.recentFiles ?? [],
        approvals,
        actions,
        processes,
        rolePolicies,
        backendReady: true,
      });
      void get().loadCodexCliStatus();
      const selected = snapshot.employees.find((employee) => employee.id === selectedEmployeeId);
      const targetDir = selected?.cwd ?? workspaceRoot;
      if (targetDir) {
        await get().loadDir(targetDir);
      }
    } catch (error) {
      get().addLog(localLog("error", `backend unavailable: ${formatError(error)}`));
    }
  },

  connectEvents: async () => {
    const terminalUnlisten = await listen<TerminalDataPayload>(
      "terminal:data",
      (event) => get().appendTerminalData(event.payload),
    );
    const terminalSessionUnlisten = await listen<TerminalSessionUpdatedPayload>(
      "terminal:session-updated",
      (event) => get().upsertTerminalSession(event.payload.session),
    );
    const employeeUnlisten = await listen<EmployeeUpdatedPayload>(
      "employee:updated",
      (event) => get().upsertEmployee(event.payload.employee),
    );
    const employeeActivityUnlisten = await listen<EmployeeActivityUpdatedPayload>(
      "employee:activity-updated",
      (event) => {
        const employeeId = event.payload.employeeId;
        if (employeeId) {
          void get().refreshEmployeeActivity(employeeId);
        } else {
          void get().loadEmployeeActivities();
        }
      },
    );
    const approvalUnlisten = await listen<ApprovalUpdatedPayload>(
      "approval:updated",
      (event) => get().upsertApproval(event.payload.approval),
    );
    const actionUnlisten = await listen<ActionUpdatedPayload>(
      "action:updated",
      (event) => get().upsertAction(event.payload.action),
    );
    const processUnlisten = await listen<ProcessUpdatedPayload>(
      "process:updated",
      (event) => get().upsertProcess(event.payload.process),
    );
    const processLogUnlisten = await listen<ProcessLogs>(
      "process:log",
      (event) => get().appendProcessLog(event.payload),
    );
    const logUnlisten = await listen<AppLog>("app:log", (event) =>
      get().addLog(event.payload),
    );
    return [
      terminalUnlisten,
      terminalSessionUnlisten,
      employeeUnlisten,
      employeeActivityUnlisten,
      approvalUnlisten,
      actionUnlisten,
      processUnlisten,
      processLogUnlisten,
      logUnlisten,
    ];
  },

  loadWorkspaceInfo: async () => {
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const workspaceInfo = await invoke<WorkspaceInfo>("workspace_info");
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

  loadEmployeeActivities: async () => {
    try {
      const activities = await invoke<EmployeeActivity[]>("employee_activity_list");
      set({ employeeActivities: activitiesByEmployee(activities) });
    } catch (error) {
      get().addLog(localLog("warn", `employee activity failed: ${formatError(error)}`));
    }
  },

  refreshEmployeeActivity: async (employeeId) => {
    try {
      const activity = await invoke<EmployeeActivity>("employee_activity_get", { employeeId });
      set((state) => ({
        employeeActivities: {
          ...state.employeeActivities,
          [activity.employeeId]: activity,
        },
      }));
    } catch {
      set((state) => {
        const { [employeeId]: _removed, ...employeeActivities } = state.employeeActivities;
        return { employeeActivities };
      });
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
      const workspaceInfo = await invoke<WorkspaceInfo>("workspace_set_root", { path: trimmed });
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
      const recentWorkspaces = await invoke<string[]>("workspace_recent_clear");
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
      const settings = normalizeSettings(
        await invoke<AppSettings>("settings_update", { payload: settingsUpdate }),
      );
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

  createEmployee: async (input) => {
    try {
      const employee = await invoke<Employee>("employee_create", { payload: input });
      get().upsertEmployee(employee);
      set({ selectedEmployeeId: employee.id });
      await get().loadDir(employee.cwd);
      await get().persistUiState();
    } catch (error) {
      get().addLog(localLog("error", `create employee failed: ${formatError(error)}`));
    }
  },

  removeEmployee: async (employeeId) => {
    try {
      await invoke("employee_remove", { employeeId });
      set((state) => {
        const employees = state.employees.filter((employee) => employee.id !== employeeId);
        const { [employeeId]: _activity, ...employeeActivities } = state.employeeActivities;
        const selectedEmployeeId =
          state.selectedEmployeeId === employeeId
            ? employees[0]?.id ?? null
            : state.selectedEmployeeId;
        return { employees, employeeActivities, selectedEmployeeId };
      });
      await get().persistUiState();
      const selected = get().selectedEmployee();
      await get().loadDir(selected?.cwd ?? get().workspaceRoot);
    } catch (error) {
      get().addLog(localLog("error", `remove employee failed: ${formatError(error)}`));
    }
  },

  selectEmployee: async (employeeId) => {
    set({ selectedEmployeeId: employeeId });
    const employee = get().employees.find((item) => item.id === employeeId);
    if (employee) {
      await get().loadDir(employee.cwd);
    }
    await get().persistUiState();
  },

  startTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_start_terminal", { employeeId });
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `start terminal failed: ${formatError(error)}`));
    }
  },

  startCodexTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_start_codex_terminal", { employeeId });
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `start Codex failed: ${formatError(error)}`));
      void get().loadCodexCliStatus();
    }
  },

  stopTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_stop_terminal", { employeeId });
      get().upsertEmployee(employee);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `stop terminal failed: ${formatError(error)}`));
    }
  },

  stopTerminalSession: async (employeeId, sessionId) => {
    try {
      const session = await invoke<TerminalSessionRecord>("terminal_session_stop", {
        employeeId,
        sessionId,
      });
      get().upsertTerminalSession(session);
      void get().loadTerminalSessions();
    } catch (error) {
      get().addLog(localLog("error", `stop terminal session failed: ${formatError(error)}`));
    }
  },

  renameTerminalSession: async (employeeId, sessionId, label) => {
    try {
      const session = await invoke<TerminalSessionRecord>("terminal_session_rename", {
        employeeId,
        sessionId,
        label,
      });
      get().upsertTerminalSession(session);
    } catch (error) {
      get().addLog(localLog("error", `rename terminal session failed: ${formatError(error)}`));
    }
  },

  loadCodexCliStatus: async () => {
    set({ codexCliStatus: null, codexCliStatusLoading: true });
    try {
      const codexCliStatus = await invoke<CodexCliStatus>("codex_cli_status");
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

  loadTerminalSessions: async (employeeId = null) => {
    try {
      const terminalSessions = await invoke<TerminalSessionRecord[]>("terminal_session_list", {
        employeeId,
      });
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

  createWorktree: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("git_worktree_create_for_employee", {
        employeeId,
      });
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
      const employee = await invoke<Employee>("git_worktree_remove_for_employee", {
        employeeId,
      });
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

  createApproval: async (input) => {
    try {
      const approval = await invoke<ApprovalRequest>("approval_create", { payload: input });
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `create approval failed: ${formatError(error)}`));
    }
  },

  approveApproval: async (approvalId) => {
    try {
      const approval = await invoke<ApprovalRequest>("approval_approve", { approvalId });
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `approve request failed: ${formatError(error)}`));
    }
  },

  rejectApproval: async (approvalId) => {
    try {
      const approval = await invoke<ApprovalRequest>("approval_reject", { approvalId });
      get().upsertApproval(approval);
    } catch (error) {
      get().addLog(localLog("error", `reject request failed: ${formatError(error)}`));
    }
  },

  createAction: async (input) => {
    try {
      const action = await invoke<Action>("action_create", { payload: input });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `create action failed: ${formatError(error)}`));
    }
  },

  requestActionApproval: async (actionId) => {
    try {
      const action = await invoke<Action>("action_request_approval", { actionId });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `request approval failed: ${formatError(error)}`));
    }
  },

  approveAction: async (actionId) => {
    try {
      const action = await invoke<Action>("action_approve", { actionId });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `approve action failed: ${formatError(error)}`));
    }
  },

  rejectAction: async (actionId) => {
    try {
      const action = await invoke<Action>("action_reject", { actionId });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `reject action failed: ${formatError(error)}`));
    }
  },

  runAction: async (actionId) => {
    try {
      const action = await invoke<Action>("action_run", { actionId });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `run action failed: ${formatError(error)}`));
    }
  },

  cancelAction: async (actionId) => {
    try {
      const action = await invoke<Action>("action_cancel", { actionId });
      get().upsertAction(action);
    } catch (error) {
      get().addLog(localLog("error", `cancel action failed: ${formatError(error)}`));
    }
  },

  loadWorktreeStatus: async (employeeId) => {
    try {
      const status = await invoke<WorktreeStatus>("git_worktree_status_for_employee", {
        employeeId,
      });
      set((state) => ({
        worktreeStatuses: { ...state.worktreeStatuses, [employeeId]: status },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree status failed: ${formatError(error)}`));
    }
  },

  loadWorktreeDiff: async (employeeId) => {
    try {
      const diff = await invoke<string>("git_worktree_diff_for_employee", { employeeId });
      set((state) => ({
        worktreeDiffs: { ...state.worktreeDiffs, [employeeId]: diff },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree diff failed: ${formatError(error)}`));
    }
  },

  loadWorktreeReview: async (employeeId) => {
    try {
      const review = await invoke<WorktreeReview>("git_worktree_review_for_employee", {
        employeeId,
      });
      set((state) => ({
        worktreeReviews: { ...state.worktreeReviews, [employeeId]: review },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree review failed: ${formatError(error)}`));
    }
  },

  loadWorktreeCommits: async (employeeId) => {
    try {
      const commits = await invoke<WorktreeCommit[]>("git_worktree_log_for_employee", {
        employeeId,
        limit: 5,
      });
      set((state) => ({
        worktreeCommits: { ...state.worktreeCommits, [employeeId]: commits },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `worktree log failed: ${formatError(error)}`));
    }
  },

  loadWorktreeHandoff: async (employeeId) => {
    try {
      const handoff = await invoke<WorktreeHandoffPreflight>(
        "git_worktree_handoff_preflight_for_employee",
        { employeeId },
      );
      set((state) => ({
        worktreeHandoffs: { ...state.worktreeHandoffs, [employeeId]: handoff },
      }));
    } catch (error) {
      get().addLog(localLog("warn", `handoff preflight failed: ${formatError(error)}`));
    }
  },

  loadWorktreeChangedFiles: async (employeeId) => {
    try {
      const files = await invoke<string[]>("git_worktree_changed_files_for_employee", {
        employeeId,
      });
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
      const diff = await invoke<string>("git_worktree_file_diff_for_employee", {
        employeeId,
        path,
      });
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
      const review = await invoke<WorktreeReview>("git_worktree_stage_file", {
        employeeId,
        path,
      });
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
      const review = await invoke<WorktreeReview>("git_worktree_unstage_file", {
        employeeId,
        path,
      });
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
      const review = await invoke<WorktreeReview>("git_worktree_discard_file_for_employee", {
        employeeId,
        path,
      });
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
      const review = await invoke<WorktreeReview>(
        "git_worktree_delete_untracked_file_for_employee",
        {
          employeeId,
          path,
        },
      );
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
      const commit = await invoke<WorktreeCommit>("git_worktree_commit_for_employee", {
        payload: { employeeId, message },
      });
      set((state) => ({
        worktreeCommits: {
          ...state.worktreeCommits,
          [employeeId]: [commit, ...(state.worktreeCommits[employeeId] ?? [])].filter(
            (item, index, commits) =>
              commits.findIndex((candidate) => candidate.hash === item.hash) === index,
          ).slice(0, 5),
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
      const result = await invoke<WorktreeHandoffApplyResult>(
        "git_worktree_apply_handoff_for_employee",
        {
          payload: { employeeId, confirmed: true },
        },
      );
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
      const result = await invoke<{
        employeeId: string;
        aborted: boolean;
        operation?: string | null;
        stdout: string;
        stderr: string;
        message: string;
      }>("git_worktree_abort_handoff_for_employee", { employeeId });
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

  spawnProcess: async (employeeId, command, cwd, title) => {
    try {
      const process = await invoke<ManagedProcess>("process_spawn", {
        payload: {
          employeeId,
          title: title ?? command,
          command,
          cwd,
        },
      });
      get().upsertProcess(process);
    } catch (error) {
      get().addLog(localLog("error", `spawn process failed: ${formatError(error)}`));
    }
  },

  killProcess: async (processId) => {
    try {
      const process = await invoke<ManagedProcess>("process_kill", { processId });
      get().upsertProcess(process);
    } catch (error) {
      get().addLog(localLog("error", `kill process failed: ${formatError(error)}`));
    }
  },

  loadProcessLogs: async (processId, offset) => {
    try {
      const logs = await invoke<ProcessLogs>("process_logs", { processId, offset });
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

  searchFiles: async (mode, query, root) => {
    try {
      const command =
        mode === "grep" ? "fs_grep" : mode === "glob" ? "fs_glob" : "fs_search";
      const payload =
        mode === "search"
          ? { query, root, limit: 100 }
          : { pattern: query, root, limit: 100 };
      return await invoke<FsSearchResult[]>(command, payload);
    } catch (error) {
      get().addLog(localLog("error", `${mode} failed: ${formatError(error)}`));
      return [];
    }
  },

  createFile: async (path, contents = "") => {
    set({ fileOperationError: null });
    try {
      const file = await invoke<FilePayload>("fs_create_file", { path, contents });
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
      const entry = await invoke<FsEntry>("fs_create_dir", { path });
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
      const entry = await invoke<FsEntry>("fs_rename", { from, to });
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
      await invoke("fs_delete", { path });
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

  writeTerminal: async (employeeId, sessionId, input) => {
    try {
      await invoke("terminal_write", { employeeId, sessionId, input });
    } catch (error) {
      get().addLog(localLog("error", `terminal write failed: ${formatError(error)}`));
    }
  },

  resizeTerminal: async (employeeId, sessionId, cols, rows) => {
    try {
      await invoke("terminal_resize", { employeeId, sessionId, cols, rows });
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

  upsertEmployee: (employee) => {
    set((state) => {
      const exists = state.employees.some((item) => item.id === employee.id);
      const employees = exists
        ? state.employees.map((item) => (item.id === employee.id ? employee : item))
        : [...state.employees, employee];
      employees.sort((a, b) => a.createdAt - b.createdAt);
      return {
        employees,
        selectedEmployeeId: state.selectedEmployeeId ?? employee.id,
      };
    });
  },

  upsertApproval: (approval) => {
    set((state) => {
      const exists = state.approvals.some((item) => item.id === approval.id);
      const approvals = exists
        ? state.approvals.map((item) => (item.id === approval.id ? approval : item))
        : [...state.approvals, approval];
      approvals.sort((a, b) => a.createdAt - b.createdAt);
      return { approvals };
    });
  },

  upsertAction: (action) => {
    set((state) => {
      const exists = state.actions.some((item) => item.id === action.id);
      const actions = exists
        ? state.actions.map((item) => (item.id === action.id ? action : item))
        : [...state.actions, action];
      actions.sort((a, b) => a.createdAt - b.createdAt);
      return { actions };
    });
  },

  loadDir: async (path) => {
    try {
      const targetPath = path ?? get().selectedEmployee()?.cwd ?? get().workspaceRoot;
      const fileEntries = await invoke<FsEntry[]>("fs_list_dir", { path: targetPath });
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
      const file = await invoke<FilePayload>("fs_read_file", { path });
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

      await invoke("fs_write_file", {
        path: openFile.path,
        contents: openFile.contents,
      });
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

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs.slice(-199), log],
    })),

  persistUiState: async () => {
    try {
      await invoke("app_state_save", {
        payload: {
          selectedEmployeeId: get().selectedEmployeeId,
          activeTab: get().activeTab,
          recentFiles: get().recentFiles,
        },
      });
    } catch (error) {
      get().addLog(localLog("warn", `persist UI state failed: ${formatError(error)}`));
    }
  },
}));

function localLog(level: AppLog["level"], message: string): AppLog {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    timestamp: Date.now(),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

function parentDir(path: string): string | null {
  const trimmed = path.replace(/[\\/]$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) {
    return null;
  }
  return trimmed.slice(0, index);
}

function openFileFromPayload(file: FilePayload, metadata: FileMetadata): OpenFile {
  return {
    path: file.path,
    savedContents: file.contents,
    contents: file.contents,
    dirty: false,
    lastSavedAt: null,
    saveError: null,
    metadata,
    openedModified: metadata.modified ?? null,
  };
}

async function fetchFileMetadata(path: string): Promise<FileMetadata> {
  return invoke<FileMetadata>("fs_file_metadata", { path });
}

function hasFileChangedOnDisk(openFile: OpenFile, metadata: FileMetadata): boolean {
  const openedModified = openFile.openedModified;
  const diskModified = metadata.modified ?? null;
  return openedModified !== null && diskModified !== null && openedModified !== diskModified;
}

function confirmDiscardIfNeeded(
  openFile: OpenFile | null,
  settings: AppSettings,
  action: string,
): boolean {
  if (!openFile?.dirty || !settings.requireConfirmationDiscard) {
    return true;
  }
  return confirm(`Discard unsaved changes in ${shortPath(openFile.path)} before ${action}?`);
}

function setOpenFileSaveError(
  setState: (
    partial:
      | Partial<AppStore>
      | ((state: AppStore) => Partial<AppStore>),
  ) => void,
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

function pathIsSameOrChild(path: string, parent: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedParent = normalizePathForCompare(parent);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function movedPathAfterRename(path: string, from: string, to: string): string | null {
  if (!pathIsSameOrChild(path, from)) {
    return null;
  }
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFrom = normalizePathForCompare(from);
  const normalizedTo = normalizePathForCompare(to);
  return `${normalizedTo}${normalizedPath.slice(normalizedFrom.length)}`;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isMissingPathError(message: string): boolean {
  return /no such file|not found|cannot find/i.test(message);
}

function reviewFileKey(employeeId: string, path: string): string {
  return `${employeeId}:${path}`;
}

function resetWorkspaceFrontendState(
  setState: (
    partial:
      | Partial<AppStore>
      | ((state: AppStore) => Partial<AppStore>),
  ) => void,
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

function activitiesByEmployee(activities: EmployeeActivity[]): Record<string, EmployeeActivity> {
  return Object.fromEntries(activities.map((activity) => [activity.employeeId, activity]));
}

async function refreshWorktreeReviewForEmployee(
  get: () => AppStore,
  employeeId: string,
): Promise<void> {
  const employee = get().employees.find((item) => item.id === employeeId);
  if (!employee?.worktreePath) {
    return;
  }

  await Promise.all([
    get().loadWorktreeStatus(employeeId),
    get().loadWorktreeReview(employeeId),
    get().loadWorktreeChangedFiles(employeeId),
  ]);
}

function normalizeSettings(settings?: AppSettings | null): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    maxTerminalBufferChars:
      typeof settings?.maxTerminalBufferChars === "number"
        ? settings.maxTerminalBufferChars
        : DEFAULT_SETTINGS.maxTerminalBufferChars,
  };
}

function appendBoundedTerminalBuffer(
  previous: string,
  chunk: string,
  maxChars: number,
): string {
  const next = `${previous}${chunk}`;
  const limit = Math.max(TERMINAL_TRUNCATION_MARKER.length + 1, maxChars);
  if (next.length <= limit) {
    return next;
  }

  const tailLength = limit - TERMINAL_TRUNCATION_MARKER.length;
  return `${TERMINAL_TRUNCATION_MARKER}${next.slice(-tailLength)}`;
}
