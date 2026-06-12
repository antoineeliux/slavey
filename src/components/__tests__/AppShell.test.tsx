import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import { useAppStore } from "../../store/appStore";
import { AppShell } from "../AppShell";

vi.mock("../TerminalPane", () => ({
  TerminalPane: () => <div>Terminal panel mock</div>,
}));

vi.mock("../EditorPane", () => ({
  EditorPane: () => <div>Editor panel mock</div>,
}));

vi.mock("../OfficePane", () => ({
  OfficePane: () => <div>Office panel mock</div>,
}));

vi.mock("../WorkspaceSettingsPanel", () => ({
  WorkspaceSettingsPanel: () => <div>Settings panel mock</div>,
}));

vi.mock("../EventLogPanel", () => ({
  EventLogPanel: () => <div>Event log mock</div>,
}));

describe("AppShell", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("renders the core workspace tabs and lands on office by default", async () => {
    useAppStore.setState({ backendReady: true });
    render(<AppShell />);

    expect(screen.getByRole("tablist", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Office/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/i })).toBeInTheDocument();
    expect(await screen.findByText("Office panel mock")).toBeInTheDocument();
    expect(screen.queryByText("Backend ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Employee details mock")).not.toBeInTheDocument();
    expect(screen.queryByText("Event log mock")).not.toBeInTheDocument();
  });

  it("renders non-office workspace regions on the terminal tab", async () => {
    useAppStore.setState({ backendReady: true, activeTab: "terminal" });
    render(<AppShell />);

    expect(await screen.findByText("Terminal panel mock")).toBeInTheDocument();
    expect(screen.queryByText("Employee details mock")).not.toBeInTheDocument();
    expect(screen.queryByText("Backend ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Event log mock")).not.toBeInTheDocument();
  });

  it("keeps info-only logs out of the main workbench chrome", async () => {
    useAppStore.setState({
      activeTab: "terminal",
      backendReady: true,
      logs: [{ id: "log-1", level: "info", message: "Started", timestamp: 1 }],
    });

    render(<AppShell />);

    expect(await screen.findByText("Terminal panel mock")).toBeInTheDocument();
    expect(screen.queryByText("Event log mock")).not.toBeInTheDocument();
  });

  it("shows the event log for warnings and errors", async () => {
    useAppStore.setState({
      activeTab: "terminal",
      backendReady: true,
      logs: [{ id: "log-1", level: "warn", message: "Needs attention", timestamp: 1 }],
    });

    render(<AppShell />);

    expect(await screen.findByText("Terminal panel mock")).toBeInTheDocument();
    expect(screen.getByText("Event log mock")).toBeInTheDocument();
  });

  it("switches tabs through the store without remounting the shell", async () => {
    render(<AppShell />);

    fireEvent.click(screen.getByRole("button", { name: /Editor/i }));

    expect(useAppStore.getState().activeTab).toBe("editor");
    expect(await screen.findByText("Editor panel mock")).toBeInTheDocument();
  });

  it("surfaces dirty editor state in the status strip", () => {
    useAppStore.setState({
      activeTab: "terminal",
      backendReady: true,
      employees: [
        {
          id: "employee-1",
          name: "Ada",
          role: "frontend",
          status: "running",
          cwd: "/workspace",
          worktreePath: null,
          branchName: null,
          terminalSessionId: "term-1",
          currentCommand: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      selectedEmployeeId: "employee-1",
      workspaceInfo: {
        workspaceRoot: "/workspace/project",
        recentWorkspaces: [],
        settings: useAppStore.getState().settings,
        switchBlockers: [],
        repoHealth: {
          isExistingDirectory: true,
          isGitRepo: true,
          repoRoot: "/workspace/project",
          currentBranch: "main",
          dirty: false,
          gitUserNameConfigured: true,
          gitUserEmailConfigured: true,
          worktreeSupported: true,
          worktreeSupportMessage: "available",
          worktreeBlockers: [],
          handoffBlockers: [],
          codexCliStatus: {
            available: true,
            version: "codex 1.0.0",
            message: "available",
            path: "codex",
          },
        },
      },
      terminalSessions: [
        {
          sessionId: "term-1",
          employeeId: "employee-1",
          profile: "shell",
          runtime: "pty",
          cwd: "/workspace",
          status: "running",
          startedAt: 1,
          label: "Shell",
          turnState: "shell",
        },
      ],
      openFile: {
        path: "/workspace/project/src/App.tsx",
        savedContents: "",
        contents: "changed",
        dirty: true,
        lastSavedAt: null,
        saveError: null,
        metadata: null,
        openedModified: null,
      },
    });

    render(<AppShell />);

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Ada · running")).not.toBeInTheDocument();
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();
  });
});
