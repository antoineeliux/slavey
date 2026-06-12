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

  it("appends raw terminal output without deriving Codex turn state or prompt timestamps", async () => {
    const staleOutputAt = Date.now() - 20_000;
    const rawCodexSignals =
      "\r\n› Implement feature\r\nAllow command to run?\n› Yes / No\r\n• Working (2s • esc to interrupt)";
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: "shell-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "shell-session",
            profile: "shell",
            activeProfile: "shell",
            lastOutputAt: staleOutputAt,
            lastPromptSubmittedAt: null,
            lastPromptReadyAt: null,
            lastApprovalPromptAt: null,
            turnState: "shell",
          }),
        ],
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
      useAppStore.getState().appendTerminalData({
        employeeId: "employee-1",
        sessionId: "shell-session",
        data: rawCodexSignals,
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalBuffers["shell-session"]).toContain(rawCodexSignals);
    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      profile: "shell",
      activeProfile: "shell",
      lastPromptSubmittedAt: null,
      lastPromptReadyAt: null,
      lastApprovalPromptAt: null,
      turnState: "shell",
    });
    expect(useAppStore.getState().terminalSessions[0]?.lastOutputAt).toBeGreaterThan(staleOutputAt);
  });

  it("uses backend terminal session updates for Codex turn state and prompt timestamps", async () => {
    const backendSession = terminalSession({
      activeProfile: "codex",
      lastPromptSubmittedAt: 1_000,
      lastPromptReadyAt: null,
      lastApprovalPromptAt: 2_000,
      turnState: "waiting_approval",
    });
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });

    await useAppStore.getState().connectEvents();

    act(() => {
      handlers["terminal:session-updated"]?.({
        payload: { session: backendSession },
      });
    });

    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      sessionId: "codex-session",
      activeProfile: "codex",
      lastPromptSubmittedAt: 1_000,
      lastPromptReadyAt: null,
      lastApprovalPromptAt: 2_000,
      turnState: "waiting_approval",
    });
  });

  it("loads backend terminal sessions without preserving stale local prompt fields", async () => {
    const staleSession = terminalSession({
      lastPromptSubmittedAt: 100,
      lastPromptReadyAt: 200,
      lastApprovalPromptAt: 300,
      turnState: "owner_prompt_ready",
    });
    const backendSession = terminalSession({
      lastPromptSubmittedAt: 1_000,
      lastPromptReadyAt: null,
      lastApprovalPromptAt: null,
      turnState: "agent_working",
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "terminal_session_list") {
          expect(args).toEqual({ employeeId: "employee-1" });
          return [backendSession];
        }
        return null;
      },
    );

    act(() => {
      useAppStore.setState({
        terminalSessions: [staleSession],
      });
    });

    await act(async () => {
      await useAppStore.getState().loadTerminalSessions("employee-1");
    });

    expect(useAppStore.getState().terminalSessions).toEqual([backendSession]);
  });

  it("does not optimistically parse terminal writes into Codex turn state", async () => {
    const initialSession = terminalSession({
      activeProfile: "codex",
      lastOutputAt: 1_000,
      lastPromptSubmittedAt: null,
      lastPromptReadyAt: 1_500,
      lastApprovalPromptAt: null,
      turnState: "owner_prompt_ready",
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string) => (command === "terminal_write" ? null : null),
    );
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });

    act(() => {
      useAppStore.setState({
        terminalSessions: [initialSession],
      });
    });
    await useAppStore.getState().connectEvents();

    await act(async () => {
      await useAppStore
        .getState()
        .writeTerminal("employee-1", "codex-session", "Improve documentation\r");
    });

    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_write", {
      employeeId: "employee-1",
      sessionId: "codex-session",
      input: "Improve documentation\r",
    });
    expect(useAppStore.getState().terminalSessions[0]).toEqual(initialSession);

    const backendSession = terminalSession({
      activeProfile: "codex",
      lastOutputAt: 1_000,
      lastPromptSubmittedAt: 2_000,
      lastPromptReadyAt: null,
      lastApprovalPromptAt: null,
      turnState: "prompt_submitted",
    });
    act(() => {
      handlers["terminal:session-updated"]?.({
        payload: { session: backendSession },
      });
    });

    expect(useAppStore.getState().terminalSessions[0]).toEqual(backendSession);
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

  it("uploads terminal images and sends a bracketed paste to active Codex sessions", async () => {
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "terminal_image_upload") {
          return {
            path: "/workspace/.slavey/terminal-images/screen.png",
            fileName: "screen.png",
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
        employees: [employee({ terminalSessionId: "codex-session" })],
        terminalSessions: [
          terminalSession({
            sessionId: "codex-session",
            profile: "codex",
            activeProfile: "codex",
          }),
        ],
      });
    });

    await act(async () => {
      await useAppStore.getState().insertTerminalImage("employee-1", "codex-session", {
        fileName: "screen.png",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
      });
    });

    expect(mockTauriInvoke).toHaveBeenCalledWith("terminal_write", {
      employeeId: "employee-1",
      sessionId: "codex-session",
      input: "\x1b[200~/workspace/.slavey/terminal-images/screen.png\x1b[201~",
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

  it("returns the selected employee from store state", () => {
    act(() => {
      useAppStore.setState({
        employees: [employee(), employee({ id: "employee-2", name: "Grace" })],
        selectedEmployeeId: "employee-2",
      });
    });

    expect(useAppStore.getState().selectedEmployee()?.name).toBe("Grace");
  });

  it("creates and removes employees while keeping selection and activity state in sync", async () => {
    const createdEmployee = employee({
      id: "employee-2",
      name: "Grace",
      role: "frontend",
      cwd: "/workspace/frontend",
      createdAt: 2,
      updatedAt: 2,
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "employee_create":
            expect(args).toEqual({
              payload: { name: "Grace", role: "frontend", cwd: "/workspace/frontend" },
            });
            return createdEmployee;
          case "employee_remove":
            expect(args).toEqual({ employeeId: "employee-2" });
            return null;
          case "fs_list_dir":
            return [];
          case "app_state_save":
            return null;
          default:
            return null;
        }
      },
    );
    act(() => {
      useAppStore.setState({
        workspaceRoot: "/workspace",
        employees: [employee()],
      });
    });

    await act(async () => {
      await useAppStore.getState().createEmployee({
        name: "Grace",
        role: "frontend",
        cwd: "/workspace/frontend",
      });
    });

    expect(useAppStore.getState().selectedEmployee()).toMatchObject({
      id: "employee-2",
      name: "Grace",
    });

    act(() => {
      useAppStore.setState({
        employeeActivities: {
          "employee-2": codexDeskWorkingActivity("employee-2"),
        },
      });
    });

    await act(async () => {
      await useAppStore.getState().removeEmployee("employee-2");
    });

    expect(useAppStore.getState().employees.map((item) => item.id)).toEqual(["employee-1"]);
    expect(useAppStore.getState().selectedEmployeeId).toBeNull();
    expect(useAppStore.getState().employeeActivities["employee-2"]).toBeUndefined();
  });

  it("refreshes employee activity after standby and resume transitions", async () => {
    let activityCalls = 0;
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "employee_set_standby":
            expect(args).toEqual({ employeeId: "employee-1" });
            return employee({ status: "standby", updatedAt: 2 });
          case "employee_resume_from_standby":
            expect(args).toEqual({ employeeId: "employee-1" });
            return employee({ status: "running", updatedAt: 3 });
          case "employee_activity_get":
            expect(args).toEqual({ employeeId: "employee-1" });
            activityCalls += 1;
            return activityCalls === 1
              ? codexWaitingInstructionActivity("employee-1", { lastActivityAt: 2_000 })
              : codexDeskWorkingActivity("employee-1", { lastActivityAt: 3_000 });
          default:
            return null;
        }
      },
    );
    act(() => {
      useAppStore.setState({
        employees: [employee()],
      });
    });

    await act(async () => {
      await useAppStore.getState().setEmployeeStandby("employee-1");
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(2_000);
    });
    expect(useAppStore.getState().employees[0]).toMatchObject({ status: "standby" });

    await act(async () => {
      await useAppStore.getState().resumeEmployeeFromStandby("employee-1");
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(3_000);
    });
    expect(useAppStore.getState().employees[0]).toMatchObject({ status: "running" });
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

  it("only lets the latest rapid employee activity event update the store", async () => {
    const staleActivity = deferred<EmployeeActivity>();
    const freshActivity = deferred<EmployeeActivity>();
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    let getCalls = 0;
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "employee_activity_get") {
          expect(args).toEqual({ employeeId: "employee-1" });
          getCalls += 1;
          return getCalls === 1 ? staleActivity.promise : freshActivity.promise;
        }
        return null;
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [employee()],
        selectedEmployeeId: "employee-1",
      });
    });
    await useAppStore.getState().connectEvents();

    act(() => {
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: "employee-1" },
      });
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: "employee-1" },
      });
    });
    expect(getCalls).toBe(2);

    await act(async () => {
      freshActivity.resolve(codexWaitingInstructionActivity("employee-1"));
      await freshActivity.promise;
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.status).toBe(
        "codex_waiting_instruction",
      );
    });

    await act(async () => {
      staleActivity.resolve(codexDeskWorkingActivity("employee-1"));
      await staleActivity.promise;
    });

    expect(useAppStore.getState().employeeActivities["employee-1"]?.status).toBe(
      "codex_waiting_instruction",
    );
  });

  it("prevents a slower stale employee activity response from overwriting a newer one", async () => {
    const staleActivity = deferred<EmployeeActivity>();
    const freshActivity = deferred<EmployeeActivity>();
    let getCalls = 0;
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "employee_activity_get") {
          expect(args).toEqual({ employeeId: "employee-1" });
          getCalls += 1;
          return getCalls === 1 ? staleActivity.promise : freshActivity.promise;
        }
        return null;
      },
    );

    await act(async () => {
      void useAppStore.getState().refreshEmployeeActivity("employee-1");
      void useAppStore.getState().refreshEmployeeActivity("employee-1");
    });
    expect(getCalls).toBe(2);

    await act(async () => {
      freshActivity.resolve(codexDeskWorkingActivity("employee-1", { lastActivityAt: 2_000 }));
      await freshActivity.promise;
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(2_000);
    });

    await act(async () => {
      staleActivity.resolve(codexWaitingInstructionActivity("employee-1", { lastActivityAt: 1_000 }));
      await staleActivity.promise;
    });

    expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(2_000);
    expect(useAppStore.getState().employeeActivities["employee-1"]?.status).toBe("codex_running");
  });

  it("reloads all employee activities from a global activity update", async () => {
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string) => {
        if (command === "employee_activity_list") {
          return [
            codexDeskWorkingActivity("employee-1"),
            codexWaitingInstructionActivity("employee-2"),
          ];
        }
        return null;
      },
    );

    await useAppStore.getState().connectEvents();

    act(() => {
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: null },
      });
    });

    await waitFor(() => {
      expect(Object.keys(useAppStore.getState().employeeActivities)).toEqual([
        "employee-1",
        "employee-2",
      ]);
    });
    expect(useAppStore.getState().employeeActivities["employee-2"]?.status).toBe(
      "codex_waiting_instruction",
    );
  });

  it("preserves a newer employee activity refresh over an older full-list response", async () => {
    const staleList = deferred<EmployeeActivity[]>();
    const freshEmployeeActivity = deferred<EmployeeActivity>();
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "employee_activity_list") {
          return staleList.promise;
        }
        if (command === "employee_activity_get") {
          expect(args).toEqual({ employeeId: "employee-1" });
          return freshEmployeeActivity.promise;
        }
        return null;
      },
    );

    await act(async () => {
      void useAppStore.getState().loadEmployeeActivities();
      void useAppStore.getState().refreshEmployeeActivity("employee-1");
    });

    await act(async () => {
      freshEmployeeActivity.resolve(
        codexWaitingInstructionActivity("employee-1", { lastActivityAt: 2_000 }),
      );
      await freshEmployeeActivity.promise;
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(2_000);
    });

    await act(async () => {
      staleList.resolve([codexDeskWorkingActivity("employee-1", { lastActivityAt: 1_000 })]);
      await staleList.promise;
    });

    expect(useAppStore.getState().employeeActivities["employee-1"]).toMatchObject({
      status: "codex_waiting_instruction",
      lastActivityAt: 2_000,
    });
  });

  it("ignores an older full-list response after a newer full-list refresh wins", async () => {
    const staleList = deferred<EmployeeActivity[]>();
    const freshList = deferred<EmployeeActivity[]>();
    let listCalls = 0;
    (mockTauriInvoke as InvokeMock).mockImplementation(async (command: string) => {
      if (command === "employee_activity_list") {
        listCalls += 1;
        return listCalls === 1 ? staleList.promise : freshList.promise;
      }
      return null;
    });

    await act(async () => {
      void useAppStore.getState().loadEmployeeActivities();
      void useAppStore.getState().loadEmployeeActivities();
    });
    expect(listCalls).toBe(2);

    await act(async () => {
      freshList.resolve([codexDeskWorkingActivity("employee-1", { lastActivityAt: 2_000 })]);
      await freshList.promise;
    });
    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.lastActivityAt).toBe(2_000);
    });

    await act(async () => {
      staleList.resolve([
        codexWaitingInstructionActivity("employee-1", { lastActivityAt: 1_000 }),
      ]);
      await staleList.promise;
    });

    expect(useAppStore.getState().employeeActivities["employee-1"]).toMatchObject({
      status: "codex_running",
      lastActivityAt: 2_000,
    });
  });

  it("removes activity only when the latest employee refresh reports it missing", async () => {
    (mockTauriInvoke as InvokeMock).mockImplementation(async (command: string) => {
      if (command === "employee_activity_get") {
        throw new Error("activity missing");
      }
      return null;
    });
    act(() => {
      useAppStore.setState({
        employeeActivities: {
          "employee-1": codexDeskWorkingActivity("employee-1"),
        },
      });
    });

    await act(async () => {
      await useAppStore.getState().refreshEmployeeActivity("employee-1");
    });

    expect(useAppStore.getState().employeeActivities["employee-1"]).toBeUndefined();
  });

  it("applies terminal session updates before refreshing floor activity from backend contract", async () => {
    const workingSession = codexAppServerWorkingSession({
      sessionId: "ordered-session",
      turnState: "agent_working",
    });
    const activity = deferred<EmployeeActivity>();
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "employee_activity_get") {
          expect(args).toEqual({ employeeId: "employee-1" });
          return activity.promise;
        }
        return null;
      },
    );
    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: workingSession.sessionId })],
        selectedEmployeeId: "employee-1",
      });
    });
    await useAppStore.getState().connectEvents();

    act(() => {
      handlers["terminal:session-updated"]?.({
        payload: { session: workingSession },
      });
    });

    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      sessionId: "ordered-session",
      turnState: "agent_working",
    });
    expect(useAppStore.getState().employeeActivities["employee-1"]).toBeUndefined();

    act(() => {
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: "employee-1" },
      });
    });
    await act(async () => {
      activity.resolve(codexDeskWorkingActivity("employee-1"));
      await activity.promise;
    });

    const { presentation, model } = floorModelFromStore("employee-1");
    expect(presentation.state).toBe("codex_running");
    expect(model.zone).toBe("desk");
    expect(model.worksAtDesk).toBe(true);
  });

  it("keeps app-server-shaped terminal text non-authoritative until backend session and activity arrive", async () => {
    const session = codexAppServerWorkingSession({
      sessionId: "codex-output-session",
      turnState: "agent_working",
    });
    const readySession = codexAppServerWorkingSession({
      sessionId: "codex-output-session",
      turnState: "owner_prompt_ready",
      lastPromptReadyAt: 2_000,
      lastPromptSubmittedAt: 1_000,
    });
    const handlers: Record<string, CapturedTauriEventHandler> = {};
    (mockTauriListen as unknown as ListenMock).mockImplementation(async (eventName, handler) => {
      handlers[eventName] = handler;
      return () => undefined;
    });
    (mockTauriInvoke as InvokeMock).mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "employee_activity_get") {
          expect(args).toEqual({ employeeId: "employee-1" });
          return codexWaitingInstructionActivity("employee-1", {
            activeTerminalSessionId: "codex-output-session",
          });
        }
        return null;
      },
    );

    act(() => {
      useAppStore.setState({
        employees: [employee({ terminalSessionId: session.sessionId })],
        terminalSessions: [session],
        selectedEmployeeId: "employee-1",
        settings: { ...DEFAULT_SETTINGS, maxTerminalBufferChars: 250 },
      });
    });
    await useAppStore.getState().connectEvents();

    act(() => {
      handlers["terminal:data"]?.({
        payload: {
          employeeId: "employee-1",
          sessionId: session.sessionId,
          data: "\r\n[Codex] Waiting for next instruction.\r\n› ",
        },
      });
    });
    await flushTerminalDataBatch();

    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      runtime: "codex_app_server",
      turnState: "agent_working",
    });
    expect(useAppStore.getState().terminalSessions[0]?.lastPromptReadyAt).toBeUndefined();

    act(() => {
      handlers["terminal:session-updated"]?.({
        payload: { session: readySession },
      });
      handlers["employee:activity-updated"]?.({
        payload: { employeeId: "employee-1" },
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().employeeActivities["employee-1"]?.status).toBe(
        "codex_waiting_instruction",
      );
    });
    expect(useAppStore.getState().terminalSessions[0]).toMatchObject({
      turnState: "owner_prompt_ready",
      lastPromptReadyAt: 2_000,
    });
    expect(
      useAppStore.getState().employeeActivities["employee-1"]?.contract.render.placement,
    ).toBe("owner_office");
    expect(floorModelFromStore("employee-1").model.zone).toBe("executive_office");
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

function codexWaitingInstructionActivity(
  employeeId: string,
  overrides: Partial<EmployeeActivity> = {},
): EmployeeActivity {
  return {
    employeeId,
    status: "codex_waiting_instruction",
    contract: {
      lifecycle: "active",
      work: {
        kind: "codex",
        phase: "waiting_owner",
        turnOwner: "owner",
      },
      render: {
        placement: "owner_office",
        posture: "standing",
        activity: "waiting_instruction",
      },
      attention: {
        required: true,
        reason: "needs_instruction",
        priority: "normal",
      },
      source: {
        runtime: "codex_app_server",
        confidence: "structured",
      },
    },
    label: "Awaiting prompt",
    details: "Waiting for owner instruction",
    lastActivityAt: 2_000,
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
        path: null,
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
