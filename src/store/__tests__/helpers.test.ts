import { describe, expect, it } from "vitest";

import type { EmployeeActivity, FileMetadata, FilePayload } from "../../types";
import {
  DEFAULT_SETTINGS,
  activitiesByEmployee,
  appendBoundedTerminalBuffer,
  hasFileChangedOnDisk,
  movedPathAfterRename,
  normalizeSettings,
  openFileFromPayload,
  pathIsSameOrChild,
} from "../helpers";

function metadata(path: string, modified: number | null): FileMetadata {
  return {
    path,
    size: 5,
    modified,
    readonly: false,
    writable: true,
    isFile: true,
    isDir: false,
    isSymlink: false,
    insideWorkspace: true,
  };
}

describe("store helpers", () => {
  it("caps terminal buffers and keeps the newest output", () => {
    const capped = appendBoundedTerminalBuffer("a".repeat(40), "b".repeat(40), 50);

    expect(capped).toContain("[... earlier output truncated ...]");
    expect(capped.endsWith("b".repeat(14))).toBe(true);
    expect(capped.length).toBe(50);
  });

  it("maps renamed paths for files and descendants", () => {
    expect(pathIsSameOrChild("/repo/src/file.ts", "/repo/src")).toBe(true);
    expect(movedPathAfterRename("/repo/src/file.ts", "/repo/src", "/repo/app")).toBe(
      "/repo/app/file.ts",
    );
    expect(movedPathAfterRename("/repo/other/file.ts", "/repo/src", "/repo/app")).toBeNull();
  });

  it("detects disk changes from the opened metadata snapshot", () => {
    const file: FilePayload = { path: "/repo/file.ts", contents: "hello" };
    const openFile = openFileFromPayload(file, metadata(file.path, 10));

    expect(openFile.dirty).toBe(false);
    expect(hasFileChangedOnDisk(openFile, metadata(file.path, 10))).toBe(false);
    expect(hasFileChangedOnDisk(openFile, metadata(file.path, 11))).toBe(true);
  });

  it("normalizes partial settings over safe defaults", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        defaultTerminalProfile: "codex",
        requireConfirmationDelete: false,
        maxTerminalBufferChars: 120_000,
      }),
    ).toMatchObject({
      defaultTerminalProfile: "codex",
      requireConfirmationDelete: false,
      maxTerminalBufferChars: 120_000,
    });
  });

  it("indexes activity by employee id", () => {
    const activities: EmployeeActivity[] = [
      {
        employeeId: "employee-1",
        status: "idle",
        label: "Idle",
        details: null,
        lastActivityAt: null,
        activeTerminalSessionId: null,
        activeActionId: null,
        activeProcessIds: [],
        reviewCounts: { changedFiles: 0, stagedFiles: 0, untrackedFiles: 0 },
        blockers: [],
      },
      {
        employeeId: "employee-2",
        status: "shell_running",
        label: "Shell running",
        details: "session",
        lastActivityAt: 2,
        activeTerminalSessionId: "session-2",
        activeActionId: null,
        activeProcessIds: [],
        reviewCounts: { changedFiles: 1, stagedFiles: 0, untrackedFiles: 0 },
        blockers: [],
      },
    ];

    const byEmployee = activitiesByEmployee(activities);
    expect(byEmployee["employee-1"]?.status).toBe("idle");
    expect(byEmployee["employee-2"]?.activeTerminalSessionId).toBe("session-2");
  });
});
