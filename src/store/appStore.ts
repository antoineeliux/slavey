import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import type {
  Action,
  ActionKind,
  ActionUpdatedPayload,
  AppLog,
  AppStateSnapshot,
  AppTab,
  ApprovalRequest,
  ApprovalUpdatedPayload,
  CodexCliStatus,
  Employee,
  EmployeeRole,
  EmployeeUpdatedPayload,
  FilePayload,
  FsEntry,
  FsSearchResult,
  ManagedProcess,
  ProcessLogs,
  ProcessUpdatedPayload,
  RolePolicy,
  TerminalDataPayload,
  WorktreeReview,
  WorktreeStatus,
} from "../types";

const MAX_TERMINAL_BUFFER_CHARS = 250_000;
const TERMINAL_TRUNCATION_MARKER = "\n[... earlier output truncated ...]\n";

type OpenFile = {
  path: string;
  contents: string;
  dirty: boolean;
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
  selectedEmployeeId: string | null;
  workspaceRoot: string | null;
  terminalBuffers: Record<string, string>;
  logs: AppLog[];
  approvals: ApprovalRequest[];
  actions: Action[];
  processes: ManagedProcess[];
  processLogs: Record<string, ProcessLogs>;
  codexCliStatus: CodexCliStatus | null;
  rolePolicies: RolePolicy[];
  worktreeStatuses: Record<string, WorktreeStatus>;
  worktreeDiffs: Record<string, string>;
  worktreeReviews: Record<string, WorktreeReview>;
  worktreeChangedFiles: Record<string, string[]>;
  worktreeFileDiffs: Record<string, string>;
  selectedReviewFiles: Record<string, string | null>;
  recentFiles: string[];
  activeTab: AppTab;
  fileEntries: FsEntry[];
  currentDir: string | null;
  openFile: OpenFile | null;
  backendReady: boolean;
  setActiveTab: (tab: AppTab) => void;
  selectedEmployee: () => Employee | null;
  bootstrap: () => Promise<void>;
  connectEvents: () => Promise<UnlistenFn[]>;
  createEmployee: (input: CreateEmployeeInput) => Promise<void>;
  removeEmployee: (employeeId: string) => Promise<void>;
  selectEmployee: (employeeId: string) => Promise<void>;
  startTerminal: (employeeId: string) => Promise<void>;
  startCodexTerminal: (employeeId: string) => Promise<void>;
  stopTerminal: (employeeId: string) => Promise<void>;
  loadCodexCliStatus: () => Promise<void>;
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
  loadWorktreeChangedFiles: (employeeId: string) => Promise<void>;
  loadWorktreeFileDiff: (employeeId: string, path: string) => Promise<void>;
  stageWorktreeFile: (employeeId: string, path: string) => Promise<void>;
  unstageWorktreeFile: (employeeId: string, path: string) => Promise<void>;
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
  writeTerminal: (employeeId: string, sessionId: string, input: string) => Promise<void>;
  resizeTerminal: (employeeId: string, sessionId: string, cols: number, rows: number) => Promise<void>;
  appendTerminalData: (payload: TerminalDataPayload) => void;
  upsertEmployee: (employee: Employee) => void;
  upsertApproval: (approval: ApprovalRequest) => void;
  upsertAction: (action: Action) => void;
  loadDir: (path?: string | null) => Promise<void>;
  readFile: (path: string) => Promise<void>;
  updateOpenFileContents: (contents: string) => void;
  saveOpenFile: () => Promise<void>;
  addLog: (log: AppLog) => void;
  persistUiState: () => Promise<void>;
};

export const useAppStore = create<AppStore>((set, get) => ({
  employees: [],
  selectedEmployeeId: null,
  workspaceRoot: null,
  terminalBuffers: {},
  logs: [],
  approvals: [],
  actions: [],
  processes: [],
  processLogs: {},
  codexCliStatus: null,
  rolePolicies: [],
  worktreeStatuses: {},
  worktreeDiffs: {},
  worktreeReviews: {},
  worktreeChangedFiles: {},
  worktreeFileDiffs: {},
  selectedReviewFiles: {},
  recentFiles: [],
  activeTab: "terminal",
  fileEntries: [],
  currentDir: null,
  openFile: null,
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
      const approvals = await invoke<ApprovalRequest[]>("approval_list");
      const actions = await invoke<Action[]>("action_list");
      const processes = await invoke<ManagedProcess[]>("process_list");
      const rolePolicies = await invoke<RolePolicy[]>("employee_role_policies");
      const codexCliStatus = await invoke<CodexCliStatus>("codex_cli_status");
      const selectedEmployeeId =
        snapshot.selectedEmployeeId &&
        snapshot.employees.some((employee) => employee.id === snapshot.selectedEmployeeId)
          ? snapshot.selectedEmployeeId
          : snapshot.employees[0]?.id ?? null;
      set({
        employees: snapshot.employees,
        selectedEmployeeId,
        workspaceRoot: snapshot.workspaceRoot,
        activeTab: snapshot.activeTab ?? "terminal",
        recentFiles: snapshot.recentFiles ?? [],
        approvals,
        actions,
        processes,
        codexCliStatus,
        rolePolicies,
        backendReady: true,
      });
      const selected = snapshot.employees.find((employee) => employee.id === selectedEmployeeId);
      const targetDir = selected?.cwd ?? snapshot.workspaceRoot;
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
    const employeeUnlisten = await listen<EmployeeUpdatedPayload>(
      "employee:updated",
      (event) => get().upsertEmployee(event.payload.employee),
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
      employeeUnlisten,
      approvalUnlisten,
      actionUnlisten,
      processUnlisten,
      processLogUnlisten,
      logUnlisten,
    ];
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
        const selectedEmployeeId =
          state.selectedEmployeeId === employeeId
            ? employees[0]?.id ?? null
            : state.selectedEmployeeId;
        return { employees, selectedEmployeeId };
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
    } catch (error) {
      get().addLog(localLog("error", `start terminal failed: ${formatError(error)}`));
    }
  },

  startCodexTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_start_codex_terminal", { employeeId });
      get().upsertEmployee(employee);
    } catch (error) {
      get().addLog(localLog("error", `start Codex failed: ${formatError(error)}`));
      void get().loadCodexCliStatus();
    }
  },

  stopTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_stop_terminal", { employeeId });
      get().upsertEmployee(employee);
    } catch (error) {
      get().addLog(localLog("error", `stop terminal failed: ${formatError(error)}`));
    }
  },

  loadCodexCliStatus: async () => {
    try {
      const codexCliStatus = await invoke<CodexCliStatus>("codex_cli_status");
      set({ codexCliStatus });
    } catch (error) {
      get().addLog(localLog("warn", `Codex status failed: ${formatError(error)}`));
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
    try {
      const file = await invoke<FilePayload>("fs_create_file", { path, contents });
      await get().loadDir(parentDir(file.path));
    } catch (error) {
      get().addLog(localLog("error", `create file failed: ${formatError(error)}`));
    }
  },

  createDir: async (path) => {
    try {
      const entry = await invoke<FsEntry>("fs_create_dir", { path });
      await get().loadDir(parentDir(entry.path));
    } catch (error) {
      get().addLog(localLog("error", `create directory failed: ${formatError(error)}`));
    }
  },

  renamePath: async (from, to) => {
    try {
      const entry = await invoke<FsEntry>("fs_rename", { from, to });
      await get().loadDir(parentDir(entry.path));
    } catch (error) {
      get().addLog(localLog("error", `rename failed: ${formatError(error)}`));
    }
  },

  deletePath: async (path) => {
    try {
      await invoke("fs_delete", { path });
      await get().loadDir(parentDir(path));
    } catch (error) {
      get().addLog(localLog("error", `delete failed: ${formatError(error)}`));
    }
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
        [sessionId]: appendBoundedTerminalBuffer(state.terminalBuffers[sessionId] ?? "", data),
      },
    }));
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
      set({ fileEntries, currentDir: targetPath ?? null });
    } catch (error) {
      get().addLog(localLog("error", `list directory failed: ${formatError(error)}`));
    }
  },

  readFile: async (path) => {
    try {
      const file = await invoke<FilePayload>("fs_read_file", { path });
      const recentFiles = [file.path, ...get().recentFiles.filter((item) => item !== file.path)].slice(
        0,
        12,
      );
      set({ openFile: { path: file.path, contents: file.contents, dirty: false }, recentFiles });
      void get().persistUiState();
    } catch (error) {
      get().addLog(localLog("error", `read file failed: ${formatError(error)}`));
    }
  },

  updateOpenFileContents: (contents) => {
    set((state) => ({
      openFile: state.openFile
        ? { ...state.openFile, contents, dirty: contents !== state.openFile.contents || state.openFile.dirty }
        : null,
    }));
  },

  saveOpenFile: async () => {
    const openFile = get().openFile;
    if (!openFile) {
      return;
    }
    try {
      await invoke("fs_write_file", {
        path: openFile.path,
        contents: openFile.contents,
      });
      set({ openFile: { ...openFile, dirty: false } });
      get().addLog(localLog("info", `saved ${shortPath(openFile.path)}`));
    } catch (error) {
      get().addLog(localLog("error", `save file failed: ${formatError(error)}`));
    }
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

function reviewFileKey(employeeId: string, path: string): string {
  return `${employeeId}:${path}`;
}

function appendBoundedTerminalBuffer(previous: string, chunk: string): string {
  const next = `${previous}${chunk}`;
  if (next.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return next;
  }

  const tailLength = MAX_TERMINAL_BUFFER_CHARS - TERMINAL_TRUNCATION_MARKER.length;
  return `${TERMINAL_TRUNCATION_MARKER}${next.slice(-tailLength)}`;
}
