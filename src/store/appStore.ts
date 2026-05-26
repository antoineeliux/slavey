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
  Employee,
  EmployeeRole,
  EmployeeUpdatedPayload,
  FilePayload,
  FsEntry,
  RolePolicy,
  TerminalDataPayload,
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
};

type AppStore = {
  employees: Employee[];
  selectedEmployeeId: string | null;
  workspaceRoot: string | null;
  terminalBuffers: Record<string, string>;
  logs: AppLog[];
  approvals: ApprovalRequest[];
  actions: Action[];
  rolePolicies: RolePolicy[];
  worktreeStatuses: Record<string, WorktreeStatus>;
  worktreeDiffs: Record<string, string>;
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
  stopTerminal: (employeeId: string) => Promise<void>;
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
  loadWorktreeStatus: (employeeId: string) => Promise<void>;
  loadWorktreeDiff: (employeeId: string) => Promise<void>;
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
  rolePolicies: [],
  worktreeStatuses: {},
  worktreeDiffs: {},
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
      const rolePolicies = await invoke<RolePolicy[]>("employee_role_policies");
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
    const logUnlisten = await listen<AppLog>("app:log", (event) =>
      get().addLog(event.payload),
    );
    return [terminalUnlisten, employeeUnlisten, approvalUnlisten, actionUnlisten, logUnlisten];
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

  stopTerminal: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("employee_stop_terminal", { employeeId });
      get().upsertEmployee(employee);
    } catch (error) {
      get().addLog(localLog("error", `stop terminal failed: ${formatError(error)}`));
    }
  },

  createWorktree: async (employeeId) => {
    try {
      const employee = await invoke<Employee>("git_worktree_create_for_employee", {
        employeeId,
      });
      get().upsertEmployee(employee);
      await get().loadWorktreeStatus(employee.id);
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
        return { worktreeStatuses, worktreeDiffs };
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

function appendBoundedTerminalBuffer(previous: string, chunk: string): string {
  const next = `${previous}${chunk}`;
  if (next.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return next;
  }

  const tailLength = MAX_TERMINAL_BUFFER_CHARS - TERMINAL_TRUNCATION_MARKER.length;
  return `${TERMINAL_TRUNCATION_MARKER}${next.slice(-tailLength)}`;
}
