import { useAppStore } from "../store/appStore";
import type { RepoHealth, WorktreeHandoffPreflight } from "../types";

export function nextEmployeeName(): string {
  const count = useAppStore.getState().employees.length + 1;
  return `Employee ${count}`;
}

export function codexStatusLabel(
  status: { available: boolean; version?: string | null } | null,
  loading: boolean,
): string {
  if (loading || !status) {
    return "checking";
  }
  if (!status.available) {
    return "unavailable";
  }
  return status.version ?? "available";
}

export function codexStatusTitle(
  status: { message: string; path?: string | null } | null,
  loading: boolean,
): string {
  if (loading || !status) {
    return "Checking Codex CLI";
  }
  return status.path ? `${status.message} (${status.path})` : status.message;
}

export function identityLabel(health: RepoHealth | null): string {
  if (!health?.isGitRepo) {
    return "unavailable";
  }
  if (health.gitUserNameConfigured && health.gitUserEmailConfigured) {
    return "configured";
  }
  if (!health.gitUserNameConfigured && !health.gitUserEmailConfigured) {
    return "missing name and email";
  }
  return health.gitUserNameConfigured ? "missing email" : "missing name";
}

export function worktreeCreateDisabledReason(
  worktreePath: string | null | undefined,
  health: RepoHealth | null,
): string | null {
  if (worktreePath) {
    return "Employee already has a worktree";
  }
  return repoCapabilityDisabledReason(health);
}

export function handoffApplyDisabledReason(
  health: RepoHealth | null,
  handoff: WorktreeHandoffPreflight | undefined,
): string | null {
  const repoReason = repoCapabilityDisabledReason(health);
  if (repoReason) {
    return repoReason;
  }
  if (!handoff) {
    return "Handoff preflight is not loaded";
  }
  return null;
}

function repoCapabilityDisabledReason(health: RepoHealth | null): string | null {
  if (!health) {
    return "Workspace health is not loaded";
  }
  if (!health.isGitRepo) {
    return "Open a git repository workspace to use worktrees";
  }
  if (!health.gitUserNameConfigured || !health.gitUserEmailConfigured) {
    return `Configure git user.name and user.email for this workspace (${identityLabel(health)})`;
  }
  if (!health.worktreeSupported) {
    return health.worktreeBlockers[0] ?? health.worktreeSupportMessage;
  }
  return null;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function previewText(value: string): string {
  const limit = 4000;
  return value.length > limit ? `${value.slice(0, limit)}\n[preview truncated]` : value;
}

export function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatStrategy(value: string): string {
  return value.replaceAll("_", " ");
}
