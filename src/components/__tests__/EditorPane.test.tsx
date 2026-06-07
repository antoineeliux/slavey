import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockTauriInvoke } from "../../test/setup";
import { resetAppStore } from "../../test/storeTestUtils";
import { useAppStore } from "../../store/appStore";
import { gitPathFileKey, gitPathKey } from "../../store/slices/reviewSlice";
import type { GitPathChanges, WorktreeReviewFile } from "../../types";
import { EditorPane } from "../EditorPane";

describe("EditorPane", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("renders a clear no-file state with disabled save reason", () => {
    render(<EditorPane />);

    expect(
      screen.getByText("Select a file from the tree or changed files to start editing."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toHaveAttribute(
      "title",
      "Open a file before saving",
    );
  });

  it("marks dirty files with an accessible dirty indicator", () => {
    useAppStore.setState({
      openFile: {
        path: "/workspace/src/App.tsx",
        savedContents: "old",
        contents: "new",
        dirty: true,
        lastSavedAt: null,
        saveError: null,
        metadata: {
          path: "/workspace/src/App.tsx",
          size: 3,
          modified: 1,
          readonly: false,
          writable: true,
          isFile: true,
          isDir: false,
          isSymlink: false,
          insideWorkspace: true,
        },
        openedModified: 1,
      },
    });

    render(<EditorPane />);

    expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toHaveAttribute(
      "title",
      "Save changes",
    );
  });

  it("keeps a diff fallback for deleted files that cannot be opened", () => {
    const root = "/workspace/project";
    const path = "src/deleted.ts";
    const diff = "diff --git a/src/deleted.ts b/src/deleted.ts\n@@ -1 +0,0 @@\n-old\n";
    const changes = gitChanges(root, [changedFile(path, { deleted: true, unstaged: true })]);

    mockGitCommands(changes, diff);
    useAppStore.setState({
      workspaceRoot: root,
      gitPathChanges: { [gitPathKey(root)]: changes },
      selectedGitChangedFiles: { [gitPathKey(root)]: path },
      gitPathFileDiffs: { [gitPathFileKey(root, path)]: diff },
    });

    render(<EditorPane />);

    fireEvent.click(screen.getByRole("button", { name: /src\/deleted\.ts\s*deleted/i }));

    expect(screen.getByText(`Diff: ${path}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${path} diff`)).toHaveTextContent("-old");
  });

  it("groups mixed staged and unstaged files once", () => {
    const root = "/workspace/project";
    const path = "src/App.tsx";
    const changes = gitChanges(root, [changedFile(path, { staged: true, unstaged: true })]);

    mockGitCommands(changes, "");
    useAppStore.setState({
      workspaceRoot: root,
      gitPathChanges: { [gitPathKey(root)]: changes },
      selectedGitChangedFiles: { [gitPathKey(root)]: path },
    });

    render(<EditorPane />);

    expect(screen.getByText("Mixed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /src\/App\.tsx\s*mixed/i })).toHaveLength(1);
  });

  it("keeps recent files collapsed but still clearable", async () => {
    useAppStore.setState({
      recentFiles: ["/workspace/project/src/App.tsx"],
    });

    render(<EditorPane />);

    expect(screen.getByText("Recent files")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Clear recent files"));

    await waitFor(() => {
      expect(screen.queryByText("Recent files")).not.toBeInTheDocument();
    });
  });
});

function mockGitCommands(changes: GitPathChanges, diff: string): void {
  const invokeMock = mockTauriInvoke as unknown as {
    mockImplementation: (implementation: (command: string) => Promise<unknown>) => void;
  };
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "fs_list_dir":
        return [];
      case "git_changes_for_path":
        return changes;
      case "git_file_diff_for_path":
        return diff;
      case "app_state_save":
        return null;
      default:
        return null;
    }
  });
}

function gitChanges(root: string, files: WorktreeReviewFile[]): GitPathChanges {
  return {
    root,
    repoRoot: root,
    isRepo: true,
    clean: files.length === 0,
    status: [],
    changedFiles: files.map((file) => file.path),
    files,
  };
}

function changedFile(
  path: string,
  overrides: Partial<WorktreeReviewFile> = {},
): WorktreeReviewFile {
  return {
    path,
    status: "M",
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    deleted: false,
    renamed: false,
    ...overrides,
  };
}
