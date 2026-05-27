import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import { mockTauriInvoke } from "../../test/setup";
import type { AppStateSnapshot, Employee, WorkspaceInfo } from "../../types";
import { DEFAULT_SETTINGS } from "../helpers";
import { useAppStore } from "../appStore";

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    name: "Ada",
    role: "general",
    status: "running",
    cwd: "/workspace",
    worktreePath: null,
    branchName: null,
    terminalSessionId: null,
    currentCommand: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("app store smoke behavior", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("starts with the expected default state shape", () => {
    const state = useAppStore.getState();

    expect(state.activeTab).toBe("terminal");
    expect(state.employees).toEqual([]);
    expect(state.terminalBuffers).toEqual({});
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.backendReady).toBe(false);
  });

  it("caps event logs at the latest 200 entries", () => {
    act(() => {
      for (let index = 0; index < 205; index += 1) {
        useAppStore.getState().addLog({
          id: `log-${index}`,
          level: "info",
          message: `message-${index}`,
          timestamp: index,
        });
      }
    });

    const logs = useAppStore.getState().logs;
    expect(logs).toHaveLength(200);
    expect(logs[0]?.id).toBe("log-5");
    expect(logs.at(-1)?.id).toBe("log-204");
  });

  it("appends bounded terminal output only for the active employee session", () => {
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "session-1" })],
        selectedEmployeeId: "employee-1",
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 50 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "session-1",
        data: "a".repeat(40),
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "session-2",
        data: "ignored",
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "session-1",
        data: "b".repeat(40),
      });
    });

    const buffers = useAppStore.getState().terminalBuffers;
    expect(buffers["session-1"]).toContain("[... earlier output truncated ...]");
    expect(buffers["session-1"]?.endsWith("b".repeat(10))).toBe(true);
    expect(buffers["session-2"]).toBeUndefined();
  });

  it("returns the selected employee from store state", () => {
    act(() => {
      useAppStore.setState({
        employees: [employee(), employee({ id: "employee-2", name: "Grace" })],
        selectedEmployeeId: "employee-2",
      });
    });

    expect(useAppStore.getState().selectedEmployee()?.name).toBe("Grace");
  });

  it("bootstrap applies the persisted active tab when the user has not changed tabs", async () => {
    mockBootstrapCommands({ activeTab: "editor" });

    await act(async () => {
      await useAppStore.getState().bootstrap();
    });

    expect(useAppStore.getState().activeTab).toBe("editor");
    expect(useAppStore.getState().backendReady).toBe(true);
  });

  it("bootstrap preserves a user-selected tab while restore is in flight", async () => {
    const appStateLoad = deferred<AppStateSnapshot>();
    const workspaceInfoLoad = deferred<WorkspaceInfo>();
    mockBootstrapCommands({ activeTab: "editor", appStateLoad, workspaceInfoLoad });

    const bootstrapPromise = useAppStore.getState().bootstrap();
    appStateLoad.resolve(snapshot({ activeTab: "editor" }));
    act(() => {
      useAppStore.getState().setActiveTab("settings");
    });
    workspaceInfoLoad.resolve(workspaceInfo());

    await act(async () => {
      await bootstrapPromise;
    });

    expect(useAppStore.getState().activeTab).toBe("settings");
    expect(useAppStore.getState().backendReady).toBe(true);
  });
});

function mockBootstrapCommands({
  activeTab,
  appStateLoad,
  workspaceInfoLoad,
}: {
  activeTab: AppStateSnapshot["activeTab"];
  appStateLoad?: Deferred<AppStateSnapshot>;
  workspaceInfoLoad?: Deferred<WorkspaceInfo>;
}): void {
  const workspace = workspaceInfo();
  (mockTauriInvoke as InvokeMock).mockImplementation(async (command: string) => {
    switch (command) {
      case "app_state_load":
        return appStateLoad ? appStateLoad.promise : snapshot({ activeTab });
      case "workspace_info":
        return workspaceInfoLoad ? workspaceInfoLoad.promise : workspace;
      case "approval_list":
      case "action_list":
      case "process_list":
      case "employee_activity_list":
      case "employee_role_policies":
      case "fs_list_dir":
        return [];
      case "codex_cli_status":
        return workspace.repoHealth.codexCliStatus;
      case "app_state_save":
        return null;
      default:
        return null;
    }
  });
}

type InvokeMock = {
  mockImplementation: (implementation: (command: string) => Promise<unknown>) => void;
};

function snapshot(overrides: Partial<AppStateSnapshot> = {}): AppStateSnapshot {
  return {
    workspaceRoot: "/workspace",
    employees: [],
    terminalSessions: [],
    actions: [],
    approvals: [],
    processes: [],
    processLogs: [],
    selectedEmployeeId: null,
    activeTab: "terminal",
    recentFiles: [],
    recentWorkspaces: ["/workspace"],
    settings: DEFAULT_SETTINGS,
    updatedAt: 1,
    ...overrides,
  };
}

function workspaceInfo(): WorkspaceInfo {
  return {
    workspaceRoot: "/workspace",
    recentWorkspaces: ["/workspace"],
    settings: DEFAULT_SETTINGS,
    repoHealth: {
      isExistingDirectory: true,
      isGitRepo: true,
      repoRoot: "/workspace",
      currentBranch: "main",
      dirty: false,
      gitUserNameConfigured: true,
      gitUserEmailConfigured: true,
      worktreeSupported: true,
      worktreeSupportMessage: "available",
      worktreeBlockers: [],
      handoffBlockers: [],
      codexCliStatus: {
        available: false,
        version: null,
        message: "Codex CLI unavailable in store tests",
      },
    },
    switchBlockers: [],
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
