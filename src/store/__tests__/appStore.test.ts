import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import { mockTauriInvoke, mockTauriListen } from "../../test/setup";
import { presentEmployeeActivity } from "../../components/employee-scene/activityPresentation";
import { createEmployeeFloorViewModel } from "../../components/employee-floor/employeeFloorViewModel";
import type {
  AppStateSnapshot,
  Employee,
  EmployeeActivity,
  TerminalSessionRecord,
  WorkspaceInfo,
} from "../../types";
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

function terminalSession(overrides: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord {
  return {
    sessionId: "codex-session",
    employeeId: "employee-1",
    profile: "codex",
    runtime: "pty",
    cwd: "/workspace",
    status: "running",
    startedAt: 1,
    label: "Codex",
    turnState: "codex_starting",
    ...overrides,
  };
}

describe("app store smoke behavior", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("starts with the expected default state shape", () => {
    const state = useAppStore.getState();

    expect(state.activeTab).toBe("office");
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

  it("appends bounded terminal output only for the active employee session", async () => {
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
    await flushTerminalDataBatch();

    const buffers = useAppStore.getState().terminalBuffers;
    expect(buffers["session-1"]).toContain("[... earlier output truncated ...]");
    expect(buffers["session-1"]?.endsWith("b".repeat(10))).toBe(true);
    expect(buffers["session-2"]).toBeUndefined();
  });

  it("keeps Codex prompt-waiting sessions queued through control-only terminal redraw output", async () => {
    const staleOutputAt = Date.now() - 20_000;
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: staleOutputAt,
            lastPromptReadyAt: staleOutputAt + 1,
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 50 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "\x1b[?25l\x1b[2K\r",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBe(staleOutputAt);

    act(() => {
      useAppStore.setState({
        terminalSessions: [
          terminalSession({
            lastOutputAt: staleOutputAt,
            lastPromptSubmittedAt: staleOutputAt + 1,
          }),
        ],
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "agent output",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBeGreaterThan(staleOutputAt);
  });

  it("keeps Codex prompt-waiting state while owner draft input is echoed", async () => {
    const staleOutputAt = Date.now() - 20_000;
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: staleOutputAt,
            lastPromptReadyAt: staleOutputAt + 1,
            turnState: "owner_prompt_ready",
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
    });

    await act(async () => {
      await useAppStore
        .getState()
        .writeTerminal("employee-1", "codex-session", "Improve documentation");
    });

    expect(useAppStore.getState().terminalSessions[0]?.turnState).toBe("owner_composing");

    act(() => {
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "Improve documentation",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBe(staleOutputAt);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBe(staleOutputAt + 1);
    expect(useAppStore.getState().terminalSessions[0]?.turnState).toBe("owner_composing");
  });

  it("recovers shell-launched Codex owner prompt state when working output arrives", async () => {
    const staleOutputAt = Date.now() - 20_000;
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "shell-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "codex",
            lastOutputAt: staleOutputAt,
            lastPromptReadyAt: staleOutputAt + 1,
            lastPromptSubmittedAt: null,
            lastApprovalPromptAt: null,
            turnState: "owner_composing",
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "shell-session",
        data: "\r\n› Implement feature\r\n\r\n• Working (2s • esc to interrupt)",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      profile: "shell",
      activeProfile: "codex",
      lastPromptReadyAt: null,
      lastApprovalPromptAt: null,
      turnState: "agent_working",
    });
    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBeGreaterThan(staleOutputAt);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptSubmittedAt).toBeGreaterThan(staleOutputAt);
  });

  it("marks Codex agent-working state when generation output arrives after submission", async () => {
    const staleOutputAt = Date.now() - 20_000;
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: staleOutputAt,
            lastPromptSubmittedAt: staleOutputAt + 1,
            turnState: "prompt_submitted",
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "I will inspect the project now.",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBeGreaterThan(staleOutputAt);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
    expect(useAppStore.getState().terminalSessions[0]?.turnState).toBe("agent_working");
  });

  it("recovers Codex agent-working state from active status output after startup", async () => {
    const staleOutputAt = Date.now() - 20_000;
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: staleOutputAt,
            lastPromptSubmittedAt: null,
            turnState: "codex_starting",
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "\r\n• Working (10s • esc to interrupt)",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBeGreaterThan(staleOutputAt);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
    expect(useAppStore.getState().terminalSessions[0]?.turnState).toBe("agent_working");
  });

  it("marks Codex sessions prompt-ready when the prompt returns", async () => {
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: Date.now(),
            lastPromptSubmittedAt: Date.now() - 1_000,
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "\r\n› ",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeGreaterThan(0);
  });

  it("detects Codex prompts inside shell-launched sessions", async () => {
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "shell-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
            lastOutputAt: Date.now(),
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "shell-session",
        data: "\r\n› ",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.profile).toBe("shell");
    expect(useAppStore.getState().terminalSessions[0]?.activeProfile).toBe("codex");
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeGreaterThan(0);
  });

  it("marks Codex sessions approval-ready when terminal approval prompts appear", async () => {
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: Date.now(),
            lastPromptSubmittedAt: Date.now() - 1_000,
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "Allow command to run?\n› Yes / No",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastApprovalPromptAt).toBeGreaterThan(0);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
  });

  it("detects terminal approval prompts split across terminal data batches", async () => {
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            lastOutputAt: Date.now(),
            lastPromptSubmittedAt: Date.now() - 1_000,
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "Allow ",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastApprovalPromptAt).toBeNull();

    act(() => {
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "codex-session",
        data: "command to run?\n› Yes / No",
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]?.lastApprovalPromptAt).toBeGreaterThan(0);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
  });

  it("tracks submitted Codex prompts without treating every terminal write as output", async () => {
    act(() => {
      useAppStore.setState({
        terminalSessions: [terminalSession({ lastOutputAt: 1_000 })],
      });
    });

    await act(async () => {
      await useAppStore.getState().writeTerminal("employee-1", "codex-session", "draft text");
    });

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBe(1_000);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptSubmittedAt).toBeUndefined();

    await act(async () => {
      await useAppStore.getState().writeTerminal("employee-1", "codex-session", "\r");
    });

    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBe(1_000);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptSubmittedAt).toBeGreaterThan(1_000);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
    expect(useAppStore.getState().terminalSessions[0]?.lastApprovalPromptAt).toBeNull();
  });

  it("tracks submitted Codex prompts when a shell session is visibly at a Codex prompt", async () => {
    act(() => {
      useAppStore.setState({
        terminalBuffers: {
          "shell-session": "shell output\n› Explain this codebase",
        },
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
            lastOutputAt: 1_000,
          }),
        ],
      });
    });

    await act(async () => {
      await useAppStore.getState().writeTerminal("employee-1", "shell-session", "\r");
    });

    expect(useAppStore.getState().terminalSessions[0]?.profile).toBe("shell");
    expect(useAppStore.getState().terminalSessions[0]?.activeProfile).toBe("codex");
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptSubmittedAt).toBeGreaterThan(1_000);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
  });

  it("uploads terminal images and writes a quoted path into the PTY", async () => {
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "terminal_image_upload") {
          return {
            path: "/workspace/.slavey/terminal-images/ada's-screen.png",
            fileName: "ada's-screen.png",
            bytes: 128,
            mimeType: "image/png",
          };
        }
        if (command === "terminal_write") {
          return null;
        }
        return args ?? null;
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "shell-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
          }),
        ],
      });
    });

    await act(async () => {
      await useAppStore.getState().insertTerminalImage("employee-1", "shell-session", {
        fileName: "screen.png",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
      });
    });

    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_image_upload", {
      payload: {
        fileName: "screen.png",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
      },
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_write", {
      employeeId: "employee-1",
      sessionId: "shell-session",
      input: "'/workspace/.slavey/terminal-images/ada'\\''s-screen.png' ",
    });
  });

  it("uploads dropped terminal image paths and writes the copied path into the PTY", async () => {
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "terminal_image_upload_path") {
          return {
            path: "/workspace/.slavey/terminal-images/dropped-screen.png",
            fileName: "dropped-screen.png",
            bytes: 128,
            mimeType: "image/png",
          };
        }
        if (command === "terminal_write") {
          return null;
        }
        return args ?? null;
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "shell-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
          }),
        ],
      });
    });

    await act(async () => {
      await useAppStore
        .getState()
        .insertTerminalImagePath("employee-1", "shell-session", {
          path: "/Users/ada/Desktop/screen.png",
        });
    });

    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_image_upload_path", {
      payload: {
        path: "/Users/ada/Desktop/screen.png",
      },
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_write", {
      employeeId: "employee-1",
      sessionId: "shell-session",
      input: "'/workspace/.slavey/terminal-images/dropped-screen.png' ",
    });
  });

  it("tracks prompt submission for sessions already marked prompt-ready", async () => {
    act(() => {
      useAppStore.setState({
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
            lastOutputAt: 1_000,
            lastPromptReadyAt: 1_500,
          }),
        ],
      });
    });

    await act(async () => {
      await useAppStore.getState().writeTerminal("employee-1", "shell-session", "\r");
    });

    expect(useAppStore.getState().terminalSessions[0]?.activeProfile).toBe("codex");
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptSubmittedAt).toBeGreaterThan(1_500);
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeNull();
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

  it("refreshes desk activity after submitting a Codex app-server task", async () => {
    const workingSession = codexAppServerWorkingSession();
    const workingActivity = codexDeskWorkingActivity("employee-1", {
      activeTerminalSessionId: workingSession.sessionId,
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "codex_task_submit":
            return workingSession;
          case "terminal_session_list":
            return [workingSession];
          case "employee_activity_get":
            expect(args).toEqual({ employeeId: "employee-1" });
            return workingActivity;
          default:
            return null;
        }
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [employee()],
        selectedEmployeeId: "employee-1",
      });
    });

    await act(async () => {
      await useAppStore.getState().submitCodexTask({
        employeeId: "employee-1",
        sessionId: null,
        prompt: "Implement the activity contract refresh",
      });
    });

    await waitFor(() => {
      expect(
        useAppStore.getState().employeeActivities["employee-1"]?.contract.render.placement,
      ).toBe("desk");
    });

    const state = useAppStore.getState();
    expect(state.employees.find((item) => item.id === "employee-1")?.terminalSessionId).toBe(
      workingSession.sessionId,
    );
    expect(state.terminalSessions.find((session) => session.sessionId === workingSession.sessionId))
      .toMatchObject({
        runtime: "codex_app_server",
        turnState: "prompt_submitted",
      });
    expect(state.employeeActivities["employee-1"]?.contract).toMatchObject({
      render: { placement: "desk", posture: "sitting", activity: "working" },
      work: { kind: "codex", phase: "working" },
      source: { runtime: "codex_app_server", confidence: "structured" },
    });

    const { presentation, model } = floorModelFromStore("employee-1");
    expect(presentation.state).toBe("codex_running");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
  });

  it("refreshes desk activity from live session and activity events", async () => {
    const workingSession = codexAppServerWorkingSession({
      sessionId: "codex-event-session",
      turnState: "agent_working",
    });
    const workingActivity = codexDeskWorkingActivity("employee-1", {
      activeTerminalSessionId: workingSession.sessionId,
    });
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "employee_activity_get":
            expect(args).toEqual({ employeeId: "employee-1" });
            return workingActivity;
          default:
            return null;
        }
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [
          employee({
            terminalSessionId: workingSession.sessionId,
          }),
        ],
        selectedEmployeeId: "employee-1",
      });
    });

    const unlisten = await useAppStore.getState().connectEvents();
    expect(unlisten).toHaveLength(9);
    expect(handlers["terminal:session-updated"]).toBeDefined();
    expect(handlers["employee:activity-updated"]).toBeDefined();

    act(() => {
      handlers["terminal:session-updated"]?.({
        payload: { session: workingSession },
      });
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: "employee-1" },
      });
    });

    await waitFor(() => {
      expect(
        useAppStore.getState().employeeActivities["employee-1"]?.contract.render.placement,
      ).toBe("desk");
    });

    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      sessionId: workingSession.sessionId,
      runtime: "codex_app_server",
      turnState: "agent_working",
    });

    const { presentation, model } = floorModelFromStore("employee-1");
    expect(presentation.state).toBe("codex_running");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
  });

  it("bootstrap starts on office when the user has not changed tabs", async () => {
    mockBootstrapCommands({ activeTab: "editor" });

    await act(async () => {
      await useAppStore.getState().bootstrap();
    });

    expect(useAppStore.getState().activeTab).toBe("office");
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

async function flushTerminalDataBatch(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 90));
  });
}

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
  mockImplementation: (
    implementation: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) => void;
};

type CapturedTauriEventHandler = (event: { payload: unknown }) => void;

type ListenMock = {
  mockImplementation: (
    implementation: (
      eventName: string,
      handler: CapturedTauriEventHandler,
    ) => Promise<() => void>,
  ) => void;
};

function codexAppServerWorkingSession(
  overrides: Partial<TerminalSessionRecord> = {},
): TerminalSessionRecord {
  return terminalSession({
    sessionId: "codex-app-session",
    profile: "codex",
    runtime: "codex_app_server",
    activeProfile: "codex",
    label: "Codex app-server",
    lastPromptSubmittedAt: 1_000,
    turnState: "prompt_submitted",
    ...overrides,
  });
}

function codexDeskWorkingActivity(
  employeeId: string,
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
  return {
    employeeId,
    status: "codex_running",
    contract: {
      lifecycle: "active",
      work: {
        kind: "codex",
        phase: "working",
        turnOwner: "agent",
      },
      render: {
        placement: "desk",
        posture: "sitting",
        activity: "working",
      },
      attention: {
        required: false,
        reason: null,
        priority: "none",
      },
      source: {
        runtime: "codex_app_server",
        confidence: "structured",
      },
    },
    label: "Codex running",
    details: "Working on task",
    lastActivityAt: 1_000,
    activeTerminalSessionId: null,
    activeActionId: null,
    activeProcessIds: [],
    reviewCounts: {
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
    },
    blockers: [],
    ...overrides,
  };
}

function floorModelFromStore(employeeId: string) {
  const state = useAppStore.getState();
  const nextEmployee = state.employees.find((item) => item.id === employeeId);
  if (!nextEmployee) {
    throw new Error(`Missing employee ${employeeId}`);
  }
  const presentation = presentEmployeeActivity({
    employee: nextEmployee,
    activity: state.employeeActivities[employeeId] ?? null,
    terminalSessions: state.terminalSessions,
    approvals: state.approvals,
    actions: state.actions,
    processes: state.processes,
    review: null,
    handoff: null,
  });
  return {
    presentation,
    model: createEmployeeFloorViewModel({
      employee: nextEmployee,
      presentation,
      selected: false,
      deskIndex: 0,
    }),
  };
}

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
    activeTab: "office",
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
