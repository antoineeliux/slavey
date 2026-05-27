import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../store/helpers";
import { useAppStore } from "../../store/appStore";
import { resetAppStore } from "../../test/storeTestUtils";
import { mockTauriInvoke } from "../../test/setup";
import type { WorkspaceInfo } from "../../types";
import { WorkspaceSettingsPanel } from "../WorkspaceSettingsPanel";

function workspaceInfo(): WorkspaceInfo {
  return {
    workspaceRoot: "/workspace",
    recentWorkspaces: ["/workspace", "/other"],
    settings: DEFAULT_SETTINGS,
    switchBlockers: [],
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
        message: "Codex CLI unavailable in web tests",
      },
    },
  };
}

describe("WorkspaceSettingsPanel", () => {
  beforeEach(() => {
    resetAppStore();
    const info = workspaceInfo();
    useAppStore.setState({
      workspaceRoot: info.workspaceRoot,
      workspaceInfo: info,
      recentWorkspaces: info.recentWorkspaces,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("renders workspace health and safe diagnostics messaging", async () => {
    render(<WorkspaceSettingsPanel />);

    expect(screen.getByRole("button", { name: /Open workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/Local-only export/)).toBeInTheDocument();
    expect(screen.getByText(/Secrets, terminal output, environment variables/)).toBeInTheDocument();
    expect(await screen.findByText(/0.1.0 \(test-os\/test-arch\)/)).toBeInTheDocument();
    await waitFor(() => expect(mockTauriInvoke).toHaveBeenCalledWith("diagnostics_summary"));
  });
});
