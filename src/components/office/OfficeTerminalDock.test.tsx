import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Employee, TerminalSessionRecord } from "../../types";
import { OfficeTerminalDock } from "./OfficeTerminalDock";

vi.mock("../EmployeeTerminalSurface", () => ({
  EmployeeTerminalSurface: ({ repairSignal }: { repairSignal?: number }) => (
    <div data-testid="terminal-surface" data-repair-signal={repairSignal ?? 0}>
      terminal surface
    </div>
  ),
}));

const employee: Employee = {
  id: "employee-1",
  name: "Rien",
  role: "general",
  status: "running",
  cwd: "/workspace",
  worktreePath: null,
  branchName: null,
  terminalSessionId: "term-1",
  currentCommand: null,
  createdAt: 1,
  updatedAt: 1,
};

const session: TerminalSessionRecord = {
  sessionId: "term-1",
  employeeId: "employee-1",
  profile: "codex",
  runtime: "pty",
  cwd: "/workspace",
  status: "running",
  startedAt: 1,
  label: "Codex",
  turnState: "codex_starting",
};

describe("OfficeTerminalDock", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  });

  it("renders resize handles for every edge and corner", () => {
    const { container } = render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("[data-resize-direction]")).map((element) =>
        element.getAttribute("data-resize-direction"),
      ),
    ).toEqual(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
    expect(
      screen.queryByRole("button", { name: "Resize terminal from top edge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resize terminal from bottom right corner" }),
    ).toBeInTheDocument();
  });

  it("persists the bottom-right resized expanded terminal size", async () => {
    const { container } = render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    const handle = resizeHandle(container, "se");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 220, clientY: 160 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 160 });

    await waitFor(() => {
      const geometry = JSON.parse(
        window.localStorage.getItem("slavey.officeTerminalDock.geometry") ?? "{}",
      );
      expect(geometry.expanded).toMatchObject({ x: 24, y: 70, width: 1300, height: 740 });
    });
  });

  it("resizes from the top-left corner while preserving the opposite edges", async () => {
    const { container } = render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    const handle = resizeHandle(container, "nw");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140, clientY: 130 });

    await waitFor(() => {
      const geometry = JSON.parse(
        window.localStorage.getItem("slavey.officeTerminalDock.geometry") ?? "{}",
      );
      expect(geometry.expanded).toMatchObject({ x: 64, y: 100, width: 1140, height: 650 });
    });
  });

  it("supports keyboard resizing from the visible resize grip", async () => {
    render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Resize terminal from bottom right corner" }),
      { key: "ArrowRight" },
    );

    await waitFor(() => {
      const geometry = JSON.parse(
        window.localStorage.getItem("slavey.officeTerminalDock.geometry") ?? "{}",
      );
      expect(geometry.expanded).toMatchObject({ x: 24, y: 70, width: 1200, height: 680 });
    });
  });

  it("signals the terminal surface to refresh rendering", () => {
    render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    expect(screen.getByTestId("terminal-surface")).toHaveAttribute("data-repair-signal", "0");
    fireEvent.click(screen.getByRole("button", { name: "Refresh terminal rendering" }));
    expect(screen.getByTestId("terminal-surface")).toHaveAttribute("data-repair-signal", "1");
  });

  it("persists the dragged terminal position", async () => {
    render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded={false}
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    const title = screen.getByTitle("Drag terminal");
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 70 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 150, clientY: 70 });

    await waitFor(() => {
      const geometry = JSON.parse(
        window.localStorage.getItem("slavey.officeTerminalDock.geometry") ?? "{}",
      );
      expect(geometry.docked).toMatchObject({ x: 62, y: 598, width: 720, height: 360 });
    });
  });

  it("toggles between docked and expanded terminal modes", () => {
    const onToggleExpanded = vi.fn();
    const { rerender } = render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded={false}
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand terminal" }));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={onToggleExpanded}
      />,
    );

    expect(screen.getByRole("button", { name: "Dock terminal" })).toBeInTheDocument();
  });

  it("resets the active terminal geometry", async () => {
    window.localStorage.setItem(
      "slavey.officeTerminalDock.geometry",
      JSON.stringify({
        docked: { x: 320, y: 300, width: 640, height: 340 },
        expanded: { x: 24, y: 70, width: 1180, height: 680 },
      }),
    );

    render(
      <OfficeTerminalDock
        employee={employee}
        activeSession={session}
        expanded={false}
        onClose={vi.fn()}
        onStartShell={vi.fn()}
        onStop={vi.fn()}
        onRelease={vi.fn()}
        onToggleExpanded={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset terminal position" }));

    await waitFor(() => {
      const geometry = JSON.parse(
        window.localStorage.getItem("slavey.officeTerminalDock.geometry") ?? "{}",
      );
      expect(geometry.docked).toMatchObject({ x: 12, y: 628, width: 720, height: 360 });
    });
  });
});

function resizeHandle(container: HTMLElement, direction: string): HTMLElement {
  const handle = container.querySelector<HTMLElement>(`[data-resize-direction="${direction}"]`);
  if (!handle) {
    throw new Error(`Missing resize handle: ${direction}`);
  }
  return handle;
}
