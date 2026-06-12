import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

const tauriMocks = vi.hoisted(() => {
  const settings = {
    defaultTerminalProfile: "shell",
    codexBinaryPath: "",
    requireConfirmationDiscard: true,
    requireConfirmationDelete: true,
    requireConfirmationHandoffApply: true,
    maxTerminalBufferChars: 250_000,
  };
  const codexCliStatus = {
    available: false,
    version: null,
    message: "Codex CLI unavailable in web tests",
    path: null,
  };
  const repoHealth = {
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
    codexCliStatus,
  };
  const diagnosticsSummary = {
    appVersion: "0.1.0",
    os: "test-os",
    arch: "test-arch",
    workspaceSelected: true,
    workspacePath: "~/workspace",
    workspaceExists: true,
    workspaceIsGitRepo: true,
    gitUserNameConfigured: true,
    gitUserEmailConfigured: true,
    codexCliAvailable: false,
    codexCliVersion: null,
    codexCliMessage: "Codex CLI unavailable in web tests",
    counts: {
      employees: 0,
      activeTerminalSessions: 0,
      recentTerminalSessions: 0,
      actionsByStatus: {},
      approvalsByStatus: {},
      managedProcessesByStatus: {},
      recentFiles: 0,
    },
    healthFlags: [],
    blockers: [],
  };
  const workspaceInfo = {
    workspaceRoot: "/workspace",
    recentWorkspaces: ["/workspace"],
    settings,
    repoHealth,
    switchBlockers: [],
  };
  const snapshot = {
    workspaceRoot: "/workspace",
    employees: [],
    terminalSessions: [],
    actions: [],
    approvals: [],
    processes: [],
    processLogs: [],
    selectedEmployeeId: null,
    activeTab: "office",
    recentFiles: [],
    recentWorkspaces: ["/workspace"],
    settings,
    updatedAt: 1,
  };

  return {
    invoke: vi.fn(async (command: string) => {
      switch (command) {
        case "app_state_load":
          return snapshot;
        case "app_state_save":
          return null;
        case "workspace_info":
          return workspaceInfo;
        case "diagnostics_summary":
          return diagnosticsSummary;
        case "diagnostics_export_bundle":
          return {
            generatedAt: 1,
            summary: diagnosticsSummary,
            settings,
            workspace: {
              workspacePath: "~/workspace",
              workspaceExists: true,
              isGitRepo: true,
              repoRoot: "~/workspace",
              currentBranch: "main",
              dirty: false,
              gitUserNameConfigured: true,
              gitUserEmailConfigured: true,
              worktreeSupported: true,
              worktreeBlockers: [],
              handoffBlockers: [],
              switchBlockers: [],
              codexCliStatus,
            },
            actions: [],
            approvals: [],
            terminalSessions: [],
            processes: [],
            notes: [
              "Terminal output, process logs, environment variables, credentials, tokens, and file-write contents are excluded.",
            ],
          };
        case "approval_list":
        case "action_list":
        case "process_list":
        case "employee_activity_list":
        case "employee_role_policies":
        case "terminal_session_list":
        case "fs_list_dir":
          return [];
        case "terminal_image_upload":
        case "terminal_image_upload_path":
          return {
            path: "/workspace/.slavey/terminal-images/test-image.png",
            fileName: "test-image.png",
            bytes: 128,
            mimeType: "image/png",
          };
        case "codex_cli_status":
          return codexCliStatus;
        case "settings_update":
          return settings;
        case "workspace_recent_clear":
          return [];
        default:
          return null;
      }
    }),
    listen: vi.fn(async () => vi.fn()),
    open: vi.fn(async () => null),
  };
});

export const mockTauriInvoke = tauriMocks.invoke;
export const mockTauriListen = tauriMocks.listen;
export const mockDialogOpen = tauriMocks.open;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: tauriMocks.open,
}));

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: vi.fn(async () => undefined),
  },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
