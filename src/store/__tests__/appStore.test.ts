import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import type { Employee } from "../../types";
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
});
