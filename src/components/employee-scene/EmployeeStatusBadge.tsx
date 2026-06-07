import {
  AlertTriangle,
  Armchair,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileDiff,
  GitMerge,
  Play,
  Square,
  TerminalSquare,
  Workflow,
} from "lucide-react";

import type { EmployeeVisualState } from "./activityPresentation";

export function EmployeeStatusBadge({ state, label }: { state: EmployeeVisualState; label: string }) {
  const Icon = iconFor(state);
  return (
    <span className={`employee-status-badge state-${state}`} title={label}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function iconFor(state: EmployeeVisualState) {
  switch (state) {
    case "shell_running":
    case "codex_starting":
      return TerminalSquare;
    case "codex_running":
      return Play;
    case "standby":
      return Armchair;
    case "codex_waiting_approval":
    case "waiting_approval":
      return Clock3;
    case "action_running":
      return Workflow;
    case "process_running":
      return CircleDashed;
    case "review_needed":
      return FileDiff;
    case "handoff_ready":
    case "done_clean":
      return GitMerge;
    case "blocked":
      return AlertTriangle;
    case "stopped":
      return Square;
    case "idle":
    default:
      return CheckCircle2;
  }
}
