import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import type { Employee } from "../../types";
import { useAppStore } from "../../store/appStore";
import { EmployeeTerminalSurface } from "../EmployeeTerminalSurface";

type MockTerminalBuffer = {
  active: {
    type: "normal" | "alternate";
    viewportY: number;
    baseY: number;
  };
};

const xtermMocks = vi.hoisted(() => {
  type DataHandler = (input: string) => void;

  class MockTerminal {
    static instances: MockTerminal[] = [];

    buffer: MockTerminalBuffer = {
      active: {
        type: "normal",
        viewportY: 0,
        baseY: 0,
      },
    };
    cols = 80;
    rows = 24;
    writes: string[] = [];
    refreshCount = 0;
    resetCount = 0;
    disposed = false;
    dataHandler: DataHandler | null = null;
    element = document.createElement("div");

    constructor() {
      MockTerminal.instances.push(this);
    }

    loadAddon(addon: { activate?: (terminal: MockTerminal) => void }) {
      addon.activate?.(this);
    }

    open(host?: HTMLElement) {
      host?.appendChild(this.element);
    }

    onData(handler: DataHandler) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }

    write(data: string, callback?: () => void) {
      this.writes.push(data);
      callback?.();
    }

    writeln(data: string) {
      this.write(`${data}\r\n`);
    }

    reset() {
      this.resetCount += 1;
      this.writes = [];
    }

    clear() {
      this.writes = [];
    }

    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }

    scrollToBottom() {
      this.buffer.active.viewportY = this.buffer.active.baseY;
    }

    scrollToLine(line: number) {
      this.buffer.active.viewportY = line;
    }

    scrollToTop() {
      this.buffer.active.viewportY = 0;
    }

    focus() {}

    refresh() {
      this.refreshCount += 1;
    }

    clearTextureAtlas() {}

    dispose() {
      this.disposed = true;
    }
  }

  class MockFitAddon {
    terminal: MockTerminal | null = null;

    activate(terminal: MockTerminal) {
      this.terminal = terminal;
    }

    fit() {
      if (this.terminal) {
        this.terminal.cols = 100;
        this.terminal.rows = 30;
      }
    }
  }

  class MockSerializeAddon {
    static payload = "\u001b[snapshot";

    activate() {}

    serialize() {
      return MockSerializeAddon.payload;
    }

    dispose() {}
  }

  return {
    MockFitAddon,
    MockSerializeAddon,
    MockTerminal,
  };
});

const webviewMocks = vi.hoisted(() => {
  type DragDropEvent = {
    payload:
      | { type: "enter"; paths: string[]; position: { x: number; y: number } }
      | { type: "over"; position: { x: number; y: number } }
      | { type: "drop"; paths: string[]; position: { x: number; y: number } }
      | { type: "leave" };
  };
  type DragDropHandler = (event: DragDropEvent) => void;
  let dragDropHandler: DragDropHandler | null = null;

  const onDragDropEvent = vi.fn(async (handler: DragDropHandler) => {
    dragDropHandler = handler;
    return vi.fn(() => {
      if (dragDropHandler === handler) {
        dragDropHandler = null;
      }
    });
  });

  return {
    onDragDropEvent,
    emitDragDropEvent(event: DragDropEvent) {
      dragDropHandler?.(event);
    },
    reset() {
      dragDropHandler = null;
      onDragDropEvent.mockClear();
    },
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: xtermMocks.MockFitAddon,
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: xtermMocks.MockSerializeAddon,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: webviewMocks.onDragDropEvent,
  }),
}));

const employee: Employee = {
  id: "employee-1",
  name: "Ada",
  role: "general",
  status: "running",
  cwd: "/workspace",
  worktreePath: null,
  branchName: null,
  terminalSessionId: "session-1",
  currentCommand: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("EmployeeTerminalSurface", () => {
  beforeEach(() => {
    resetAppStore();
    xtermMocks.MockTerminal.instances.length = 0;
    xtermMocks.MockSerializeAddon.payload = "\u001b[snapshot";
    webviewMocks.reset();
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "__TAURI_INTERNALS__");
  });

  it("reattaches a cached xterm screen and appends only unseen output", async () => {
    useAppStore.setState({
      employees: [employee],
      terminalBuffers: {
        "session-1": "first raw",
      },
    });

    const { unmount } = render(<EmployeeTerminalSurface employee={employee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    unmount();
    useAppStore.setState({
      terminalBuffers: {
        "session-1": "first rawdelta",
      },
    });

    render(<EmployeeTerminalSurface employee={employee} />);

    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(1);
      const writes = xtermMocks.MockTerminal.instances[0]?.writes ?? [];
      expect(writes).toContain("delta");
      expect(writes).not.toContain("first rawdelta");
    });
  });

  it("keeps the cached screen visible while backend replay is loading", async () => {
    const delayedEmployee = {
      ...employee,
      terminalSessionId: "session-delayed",
    };
    useAppStore.setState({
      employees: [delayedEmployee],
      terminalBuffers: {
        "session-delayed": "first raw",
      },
    });

    const { unmount } = render(<EmployeeTerminalSurface employee={delayedEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    unmount();
    useAppStore.setState({
      terminalBuffers: {},
    });

    render(<EmployeeTerminalSurface employee={delayedEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(1);
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    useAppStore.setState({
      terminalBuffers: {
        "session-delayed": "first rawdelta",
      },
    });

    await waitFor(() => {
      const writes = xtermMocks.MockTerminal.instances[0]?.writes ?? [];
      expect(writes).toContain("delta");
      expect(writes).not.toContain("first rawdelta");
    });
  });

  it("falls back to raw replay when a cached screen no longer matches the buffer", async () => {
    const staleEmployee = {
      ...employee,
      terminalSessionId: "session-stale",
    };
    useAppStore.setState({
      employees: [staleEmployee],
      terminalBuffers: {
        "session-stale": "first raw",
      },
    });

    const { unmount } = render(<EmployeeTerminalSurface employee={staleEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    unmount();
    useAppStore.setState({
      terminalBuffers: {
        "session-stale": "other raw",
      },
    });

    render(<EmployeeTerminalSurface employee={staleEmployee} />);

    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(1);
      const writes = xtermMocks.MockTerminal.instances[0]?.writes ?? [];
      expect(writes).toContain("other raw");
      expect(writes).not.toContain("\u001b[snapshot");
    });
  });

  it("clears a pending cached screen when delayed backend replay does not match", async () => {
    const staleEmployee = {
      ...employee,
      terminalSessionId: "session-delayed-stale",
    };
    useAppStore.setState({
      employees: [staleEmployee],
      terminalBuffers: {
        "session-delayed-stale": "first raw",
      },
    });

    const { unmount } = render(<EmployeeTerminalSurface employee={staleEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    unmount();
    useAppStore.setState({
      terminalBuffers: {},
    });

    render(<EmployeeTerminalSurface employee={staleEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(1);
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("first raw");
    });

    useAppStore.setState({
      terminalBuffers: {
        "session-delayed-stale": "other raw",
      },
    });

    await waitFor(() => {
      const writes = xtermMocks.MockTerminal.instances[0]?.writes ?? [];
      expect(writes).toContain("other raw");
      expect(writes).not.toContain("\u001b[snapshot");
    });
  });

  it("creates a cached terminal when a session starts after an empty mount", async () => {
    const idleEmployee = {
      ...employee,
      terminalSessionId: null,
    };
    const activeEmployee = {
      ...employee,
      terminalSessionId: "session-started",
    };
    useAppStore.setState({
      employees: [idleEmployee],
      terminalBuffers: {},
    });

    const { rerender, unmount } = render(<EmployeeTerminalSurface employee={idleEmployee} />);
    expect(xtermMocks.MockTerminal.instances).toHaveLength(1);

    useAppStore.setState({
      employees: [activeEmployee],
      terminalBuffers: {
        "session-started": "started raw",
      },
    });
    rerender(<EmployeeTerminalSurface employee={activeEmployee} />);

    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(2);
      expect(xtermMocks.MockTerminal.instances[0]?.disposed).toBe(true);
      expect(xtermMocks.MockTerminal.instances[1]?.writes).toContain("started raw");
    });

    unmount();
    useAppStore.setState({
      terminalBuffers: {
        "session-started": "started rawdelta",
      },
    });
    render(<EmployeeTerminalSurface employee={activeEmployee} />);

    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(2);
      const writes = xtermMocks.MockTerminal.instances[1]?.writes ?? [];
      expect(writes).toContain("delta");
      expect(writes).not.toContain("started rawdelta");
    });
  });

  it("does not seed a new session cache with the previous session buffer", async () => {
    const firstEmployee = {
      ...employee,
      terminalSessionId: "session-old",
    };
    const nextEmployee = {
      ...employee,
      terminalSessionId: "session-new-empty",
    };
    useAppStore.setState({
      employees: [firstEmployee],
      terminalBuffers: {
        "session-old": "old raw",
      },
    });

    const { rerender, unmount } = render(<EmployeeTerminalSurface employee={firstEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("old raw");
    });

    useAppStore.setState({
      employees: [nextEmployee],
      terminalBuffers: {},
    });
    rerender(<EmployeeTerminalSurface employee={nextEmployee} />);
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances).toHaveLength(2);
    });
    unmount();

    useAppStore.setState({
      terminalBuffers: {
        "session-new-empty": "old rawnew",
      },
    });
    render(<EmployeeTerminalSurface employee={nextEmployee} />);

    await waitFor(() => {
      const writes = xtermMocks.MockTerminal.instances[1]?.writes ?? [];
      expect(writes).toContain("old rawnew");
      expect(writes).not.toContain("new");
    });
  });

  it("repairs terminal rendering when the repair signal changes", async () => {
    const repairEmployee = {
      ...employee,
      terminalSessionId: "session-repair",
    };
    useAppStore.setState({
      employees: [repairEmployee],
      terminalBuffers: {
        "session-repair": "repair raw",
      },
    });

    const { rerender } = render(
      <EmployeeTerminalSurface employee={repairEmployee} repairSignal={0} />,
    );
    await waitFor(() => {
      expect(xtermMocks.MockTerminal.instances[0]?.writes).toContain("repair raw");
    });

    const terminal = xtermMocks.MockTerminal.instances[0];
    const previousRefreshCount = terminal?.refreshCount ?? 0;
    rerender(<EmployeeTerminalSurface employee={repairEmployee} repairSignal={1} />);

    await waitFor(() => {
      expect(terminal?.refreshCount ?? 0).toBeGreaterThan(previousRefreshCount);
    });
  });

  it("deduplicates duplicate browser image drop events", async () => {
    const insertTerminalImage = vi.fn(async () => true);
    useAppStore.setState({
      employees: [employee],
      terminalBuffers: {
        "session-1": "",
      },
      insertTerminalImage,
    });

    const { container } = render(<EmployeeTerminalSurface employee={employee} />);
    const host = container.querySelector(".terminal-host");
    expect(host).toBeInstanceOf(HTMLElement);

    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screen.png", {
      type: "image/png",
      lastModified: 1,
    });
    const dataTransfer = {
      types: ["Files"],
      files: [image],
      items: [],
    };

    fireEvent.drop(host as HTMLElement, { dataTransfer });
    fireEvent.drop(host as HTMLElement, { dataTransfer });

    await waitFor(() => {
      expect(insertTerminalImage).toHaveBeenCalledTimes(1);
    });
    expect(host).toHaveAttribute("data-terminal-image-status", "1 image inserted");
    expect(host).toHaveAttribute("data-terminal-image-status-tone", "success");
    expect(insertTerminalImage).toHaveBeenCalledWith(
      "employee-1",
      "session-1",
      expect.objectContaining({
        fileName: "screen.png",
        mimeType: "image/png",
      }),
    );
  });

  it("accepts Tauri image drops after entering outside and moving inside the terminal", async () => {
    enableTauriRuntime();
    const insertTerminalImagePath = vi.fn(async () => true);
    useAppStore.setState({
      employees: [employee],
      terminalBuffers: {
        "session-1": "",
      },
      insertTerminalImagePath,
    });

    const { container } = render(<EmployeeTerminalSurface employee={employee} />);
    const host = terminalHost(container);
    setTerminalHostRect(host);
    await waitFor(() => {
      expect(webviewMocks.onDragDropEvent).toHaveBeenCalledTimes(1);
    });

    act(() => {
      webviewMocks.emitDragDropEvent({
        payload: {
          type: "enter",
          paths: ["/tmp/screen.png"],
          position: { x: 500, y: 500 },
        },
      });
    });
    expect(host).not.toHaveClass("terminal-image-dragging");

    act(() => {
      webviewMocks.emitDragDropEvent({
        payload: {
          type: "over",
          position: { x: 100, y: 100 },
        },
      });
    });
    expect(host).toHaveClass("terminal-image-dragging");

    act(() => {
      webviewMocks.emitDragDropEvent({
        payload: {
          type: "drop",
          paths: ["/tmp/screen.png"],
          position: { x: 100, y: 100 },
        },
      });
    });

    await waitFor(() => {
      expect(insertTerminalImagePath).toHaveBeenCalledTimes(1);
    });
    expect(host).toHaveAttribute("data-terminal-image-status", "1 image inserted");
    expect(insertTerminalImagePath).toHaveBeenCalledWith("employee-1", "session-1", {
      path: "/tmp/screen.png",
    });
  });

  it("deduplicates browser and Tauri copies of the same image drop", async () => {
    enableTauriRuntime();
    const insertTerminalImage = vi.fn(async () => true);
    const insertTerminalImagePath = vi.fn(async () => true);
    useAppStore.setState({
      employees: [employee],
      terminalBuffers: {
        "session-1": "",
      },
      insertTerminalImage,
      insertTerminalImagePath,
    });

    const { container } = render(<EmployeeTerminalSurface employee={employee} />);
    const host = terminalHost(container);
    setTerminalHostRect(host);
    await waitFor(() => {
      expect(webviewMocks.onDragDropEvent).toHaveBeenCalledTimes(1);
    });

    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screen.png", {
      type: "image/png",
      lastModified: 1,
    });
    fireEvent.drop(host, {
      dataTransfer: {
        types: ["Files"],
        files: [image],
        items: [],
      },
    });
    act(() => {
      webviewMocks.emitDragDropEvent({
        payload: {
          type: "drop",
          paths: ["/tmp/screen.png"],
          position: { x: 100, y: 100 },
        },
      });
    });

    await waitFor(() => {
      expect(insertTerminalImage).toHaveBeenCalledTimes(1);
    });
    expect(insertTerminalImagePath).not.toHaveBeenCalled();
  });
});

function enableTauriRuntime(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

function terminalHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(".terminal-host");
  expect(host).toBeInstanceOf(HTMLElement);
  return host as HTMLElement;
}

function setTerminalHostRect(host: HTMLElement): void {
  host.getBoundingClientRect = vi.fn(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        toJSON: () => ({}),
      }) as DOMRect,
  );
}
