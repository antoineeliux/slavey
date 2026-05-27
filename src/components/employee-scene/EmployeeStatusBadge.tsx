import {
  AlertTriangle,
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
      return TerminalSquare;
    case "codex_running":
      return Play;
    case "waiting_approval":
      return Clock3;
    case "action_running":
      return Workflow;
    case "process_running":
      return CircleDashed;
    case "review_needed":
      return FileDiff;
    case "handoff_ready":
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
