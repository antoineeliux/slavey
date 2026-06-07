import type { TerminalSessionProfile, TerminalSessionRecord } from "../types";

export function terminalSessionEffectiveProfile(
  session: TerminalSessionRecord,
): TerminalSessionProfile {
  return session.activeProfile ?? session.profile;
}

export function terminalSessionIsCodexActive(session: TerminalSessionRecord): boolean {
  return terminalSessionEffectiveProfile(session) === "codex";
}

export function terminalInputSubmitsPrompt(input: string): boolean {
  return input.includes("\r") || input.includes("\n");
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

  const lastPromptSubmittedAt = session.lastPromptSubmittedAt ?? 0;
  const lastApprovalPromptAt = session.lastApprovalPromptAt ?? 0;
  return lastApprovalPromptAt >= lastPromptSubmittedAt && lastApprovalPromptAt > 0;
}

export function terminalOutputSuggestsCodexPromptReady(output: string): boolean {
  const cleanOutput = stripAnsi(output).replace(/\r/g, "\n");
  return cleanOutput
    .split("\n")
    .some((line) => line.trimStart().startsWith("›"));
}

export function terminalOutputSuggestsCodexApprovalPrompt(output: string): boolean {
  const cleanOutput = stripAnsi(output).replace(/\r/g, "\n").toLowerCase();
  const hasDirectRequest =
    cleanOutput.includes("approve") ||
    cleanOutput.includes("allow ") ||
    cleanOutput.includes("permission");
  const hasApprovalRequest =
    cleanOutput.includes("approval") &&
    (cleanOutput.includes("required") || cleanOutput.includes("request"));
  const hasActionWord =
    cleanOutput.includes("run") ||
    cleanOutput.includes("command") ||
    cleanOutput.includes("edit") ||
    cleanOutput.includes("write") ||
    cleanOutput.includes("proceed") ||
    cleanOutput.includes("continue");
  const hasChoice =
    cleanOutput.includes("yes") ||
    cleanOutput.includes("no") ||
    cleanOutput.includes("[y") ||
    cleanOutput.includes("(y") ||
    cleanOutput.includes("›");
  return (
    (hasDirectRequest && hasActionWord && hasChoice) ||
    (hasApprovalRequest && (hasActionWord || hasChoice))
  );
}

export function terminalOutputSuggestsCodexApprovalChoice(output: string): boolean {
  const cleanOutput = stripAnsi(output).replace(/\r/g, "\n").toLowerCase();
  return (
    cleanOutput.includes("yes") ||
    cleanOutput.includes("no") ||
    cleanOutput.includes("[y") ||
    cleanOutput.includes("(y") ||
    cleanOutput.includes("›")
  );
}

export function terminalOutputHasVisibleText(output: string): boolean {
  return stripAnsi(output).replace(/\s/g, "").length > 0;
}

export function terminalOutputEndsAtCodexPrompt(output: string): boolean {
  const cleanOutput = stripAnsi(output).replace(/\r/g, "\n");
  const lastMeaningfulLine = cleanOutput
    .split("\n")
    .map((line) => line.trimStart())
    .filter(Boolean)
    .at(-1);
  return lastMeaningfulLine?.startsWith("›") ?? false;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "");
}
