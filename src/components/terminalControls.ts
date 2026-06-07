import type { Employee } from "../types";

export function terminalStartDisabledReason(
  employee: Employee | null,
  sessionId: string | null,
): string | null {
  if (!employee) {
    return "Select an employee before starting a terminal";
  }
  if (sessionId) {
    return "Employee already has an active terminal session";
  }
  return null;
}
