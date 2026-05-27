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

vi.mock("../WorkspaceSettingsPanel", () => ({
  WorkspaceSettingsPanel: () => <div>Settings panel mock</div>,
}));

vi.mock("../EmployeeDetailsPanel", () => ({
  EmployeeDetailsPanel: () => <div>Employee details mock</div>,
}));

vi.mock("../EventLogPanel", () => ({
  EventLogPanel: () => <div>Event log mock</div>,
}));

describe("AppShell", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("renders the core workspace tabs and shell regions", async () => {
    useAppStore.setState({ backendReady: true });
    render(<AppShell />);

    expect(screen.getByText("Backend ready")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/i })).toBeInTheDocument();
    expect(await screen.findByText("Terminal panel mock")).toBeInTheDocument();
    expect(screen.getByText("Employee details mock")).toBeInTheDocument();
    expect(screen.getByText("Event log mock")).toBeInTheDocument();
  });

  it("switches tabs through the store without remounting the shell", async () => {
    render(<AppShell />);

    fireEvent.click(screen.getByRole("button", { name: /Editor/i }));

    expect(useAppStore.getState().activeTab).toBe("editor");
    expect(await screen.findByText("Editor panel mock")).toBeInTheDocument();
  });

  it("surfaces active employee session and dirty editor state in the status strip", () => {
    useAppStore.setState({
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
          },
        },
      },
      terminalSessions: [
        {
          sessionId: "term-1",
          employeeId: "employee-1",
          profile: "shell",
          cwd: "/workspace",
          status: "running",
          startedAt: 1,
          label: "Shell",
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

    expect(screen.getByText("Ada · running")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
