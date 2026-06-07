import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fsListDir } from "../../lib/tauriCommands";
import type { FsEntry } from "../../types";
import { OfficeDirectoryPicker } from "./OfficeDirectoryPicker";

vi.mock("../../lib/tauriCommands", () => ({
  fsListDir: vi.fn(),
}));

const fsListDirMock = vi.mocked(fsListDir);

describe("OfficeDirectoryPicker", () => {
  beforeEach(() => {
    fsListDirMock.mockReset();
  });

  it("filters workspace directories and chooses one", async () => {
    const onChange = vi.fn();
    fsListDirMock.mockResolvedValue([
      dir("apps", "/workspace/apps"),
      dir("docs", "/workspace/docs"),
      file("README.md", "/workspace/README.md"),
    ]);

    render(
      <OfficeDirectoryPicker
        value=""
        workspaceRoot="/workspace"
        placeholder="/workspace"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Working directory" }));

    expect(await screen.findByText("apps")).toBeInTheDocument();
    expect(fsListDirMock).toHaveBeenCalledWith("/workspace");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search directories" }), {
      target: { value: "app" },
    });

    expect(screen.getByText("apps")).toBeInTheDocument();
    expect(screen.queryByText("docs")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Use apps"));

    expect(onChange).toHaveBeenCalledWith("/workspace/apps");
    expect(screen.queryByRole("dialog", { name: "Choose working directory" })).not.toBeInTheDocument();
  });

  it("navigates into folders before choosing the current directory", async () => {
    const onChange = vi.fn();
    fsListDirMock.mockImplementation(async (path) =>
      path === "/workspace/apps"
        ? [dir("web", "/workspace/apps/web")]
        : [dir("apps", "/workspace/apps")],
    );

    render(
      <OfficeDirectoryPicker
        value=""
        workspaceRoot="/workspace"
        placeholder="/workspace"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Working directory" }));
    fireEvent.click(await screen.findByTitle("Open apps"));

    await waitFor(() => expect(fsListDirMock).toHaveBeenLastCalledWith("/workspace/apps"));
    expect(await screen.findByText("web")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Use current directory"));

    expect(onChange).toHaveBeenCalledWith("/workspace/apps");
  });
});

function dir(name: string, path: string): FsEntry {
  return { name, path, isDir: true, size: null, modified: null };
}

function file(name: string, path: string): FsEntry {
  return { name, path, isDir: false, size: 10, modified: null };
}
