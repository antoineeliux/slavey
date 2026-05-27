import type { ReactNode } from "react";

export function EmployeeScene({ children }: { children: ReactNode }) {
  // Future animated employee UI belongs behind this boundary and must consume
  // backend EmployeeActivity state instead of parsing terminal or Codex text.
  return <div className="employee-scene">{children}</div>;
}
