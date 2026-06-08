import type { TerminalSessionProfile, TerminalSessionRecord } from "../types";

export function terminalSessionEffectiveProfile(
  session: TerminalSessionRecord,
): TerminalSessionProfile {
  return session.activeProfile ?? session.profile;
}

export function terminalSessionIsCodexActive(session: TerminalSessionRecord): boolean {
  return terminalSessionEffectiveProfile(session) === "codex";
}

export function codexSessionIsWaitingForInstruction(
  session: TerminalSessionRecord,
): boolean {
  if (
    !terminalSessionIsCodexActive(session) ||
    session.status !== "running"
  ) {
    return false;
  }

  switch (session.turnState) {
    case "owner_prompt_ready":
    case "owner_composing":
      return true;
    case "prompt_submitted":
    case "agent_working":
    case "waiting_approval":
    case "completed":
    case "failed":
      return false;
    default:
      break;
  }

  const lastPromptSubmittedAt = session.lastPromptSubmittedAt ?? 0;
  const lastPromptReadyAt = session.lastPromptReadyAt ?? 0;
  return lastPromptReadyAt >= lastPromptSubmittedAt && lastPromptReadyAt > 0;
}

export function codexSessionIsWaitingForApproval(
  session: TerminalSessionRecord,
): boolean {
  if (
    !terminalSessionIsCodexActive(session) ||
    session.status !== "running"
  ) {
    return false;
  }

  switch (session.turnState) {
    case "waiting_approval":
      return true;
    case "owner_prompt_ready":
    case "owner_composing":
    case "prompt_submitted":
    case "agent_working":
    case "completed":
    case "failed":
      return false;
    default:
      break;
  }

  const lastPromptSubmittedAt = session.lastPromptSubmittedAt ?? 0;
  const lastApprovalPromptAt = session.lastApprovalPromptAt ?? 0;
  return lastApprovalPromptAt >= lastPromptSubmittedAt && lastApprovalPromptAt > 0;
}

export function codexSessionHasActiveTurn(session: TerminalSessionRecord): boolean {
  if (
    !terminalSessionIsCodexActive(session) ||
    session.status !== "running"
  ) {
    return false;
  }

  if (codexSessionIsWaitingForInstruction(session) || codexSessionIsWaitingForApproval(session)) {
    return false;
  }

  if (session.turnState === "prompt_submitted" || session.turnState === "agent_working") {
    return true;
  }

  return Boolean(session.lastPromptSubmittedAt);
}
