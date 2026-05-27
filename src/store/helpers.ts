import type {
  AppLog,
  AppSettings,
  EmployeeActivity,
  FileMetadata,
  FilePayload,
} from "../types";

export const MAX_TERMINAL_BUFFER_CHARS = 250_000;
const TERMINAL_TRUNCATION_MARKER = "\n[... earlier output truncated ...]\n";

export const DEFAULT_SETTINGS: AppSettings = {
  defaultTerminalProfile: "shell",
  requireConfirmationDiscard: true,
  requireConfirmationDelete: true,
  requireConfirmationHandoffApply: true,
  maxTerminalBufferChars: MAX_TERMINAL_BUFFER_CHARS,
};

export type OpenFile = {
  path: string;
  savedContents: string;
  contents: string;
  dirty: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  metadata: FileMetadata | null;
  openedModified: number | null;
};

export function localLog(level: AppLog["level"], message: string): AppLog {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    timestamp: Date.now(),
  };
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

export function parentDir(path: string): string | null {
  const trimmed = path.replace(/[\\/]$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) {
    return null;
  }
  return trimmed.slice(0, index);
}

export function openFileFromPayload(file: FilePayload, metadata: FileMetadata): OpenFile {
  return {
    path: file.path,
    savedContents: file.contents,
    contents: file.contents,
    dirty: false,
    lastSavedAt: null,
    saveError: null,
    metadata,
    openedModified: metadata.modified ?? null,
  };
}

export function hasFileChangedOnDisk(openFile: OpenFile, metadata: FileMetadata): boolean {
  const openedModified = openFile.openedModified;
  const diskModified = metadata.modified ?? null;
  return openedModified !== null && diskModified !== null && openedModified !== diskModified;
}

export function confirmDiscardIfNeeded(
  openFile: OpenFile | null,
  settings: AppSettings,
  action: string,
): boolean {
  if (!openFile?.dirty || !settings.requireConfirmationDiscard) {
    return true;
  }
  return confirm(`Discard unsaved changes in ${shortPath(openFile.path)} before ${action}?`);
}

export function pathIsSameOrChild(path: string, parent: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedParent = normalizePathForCompare(parent);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function movedPathAfterRename(path: string, from: string, to: string): string | null {
  if (!pathIsSameOrChild(path, from)) {
    return null;
  }
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFrom = normalizePathForCompare(from);
  const normalizedTo = normalizePathForCompare(to);
  return `${normalizedTo}${normalizedPath.slice(normalizedFrom.length)}`;
}

export function isMissingPathError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("no such file");
}

export function reviewFileKey(employeeId: string, path: string): string {
  return `${employeeId}:${path}`;
}

export function activitiesByEmployee(
  activities: EmployeeActivity[],
): Record<string, EmployeeActivity> {
  return Object.fromEntries(activities.map((activity) => [activity.employeeId, activity]));
}

export function normalizeSettings(settings?: AppSettings | null): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    maxTerminalBufferChars:
      typeof settings?.maxTerminalBufferChars === "number"
        ? settings.maxTerminalBufferChars
        : DEFAULT_SETTINGS.maxTerminalBufferChars,
  };
}

export function appendBoundedTerminalBuffer(
  previous: string,
  chunk: string,
  maxChars: number,
): string {
  const next = `${previous}${chunk}`;
  const limit = Math.max(TERMINAL_TRUNCATION_MARKER.length + 1, maxChars);
  if (next.length <= limit) {
    return next;
  }

  const tailLength = limit - TERMINAL_TRUNCATION_MARKER.length;
  return `${TERMINAL_TRUNCATION_MARKER}${next.slice(-tailLength)}`;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
