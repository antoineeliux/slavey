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
    render(<AppShell />);

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
});
