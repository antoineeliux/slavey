import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetAppStore } from "../../test/storeTestUtils";
import { useAppStore } from "../../store/appStore";
import { EditorPane } from "../EditorPane";

describe("EditorPane", () => {
  beforeEach(() => {
    resetAppStore();
  });

  it("renders a clear no-file state with disabled save reason", () => {
    render(<EditorPane />);

    expect(
      screen.getByText("Select a file from the tree or recent files to start editing."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toHaveAttribute(
      "title",
      "Open a file before saving",
    );
  });

  it("marks dirty files with an accessible unsaved indicator", () => {
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

    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toHaveAttribute(
      "title",
      "Save changes",
    );
  });
});
