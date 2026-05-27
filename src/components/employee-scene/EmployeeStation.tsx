import { FileDiff, GitMerge, ListChecks, RotateCw, Trash2 } from "lucide-react";

import type { Employee } from "../../types";
import type { EmployeeActivityPresentation } from "./activityPresentation";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";

export function EmployeeStation({
  employee,
  presentation,
  selected,
  onSelect,
  onRemove,
}: {
  employee: Employee;
  presentation: EmployeeActivityPresentation;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className={
        selected
          ? `employee-station selected state-${presentation.state}`
          : `employee-station state-${presentation.state}`
      }
      title={presentation.stationTitle}
      data-state={presentation.state}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="station-surface">
        <EmployeeAvatar state={presentation.state} initials={initials(employee.name)} />
        <div className="station-progress" aria-hidden="true" />
      </div>
      <div className="station-content">
        <div className="station-topline">
          <strong>{employee.name}</strong>
          <span>{employee.role}</span>
        </div>
        <EmployeeStatusBadge state={presentation.state} label={presentation.label} />
        <p title={presentation.detail}>{presentation.detail}</p>
        <div className="station-signals" aria-label={`${employee.name} signals`}>
          {presentation.pendingApprovals > 0 ? (
            <span className="signal approval" title="Pending approvals">
              <ListChecks size={11} />
              {presentation.pendingApprovals}
            </span>
          ) : null}
          {presentation.runningActions > 0 ? (
            <span className="signal action" title="Running actions">
              <RotateCw size={11} />
              {presentation.runningActions}
            </span>
          ) : null}
          {presentation.runningProcesses > 0 ? (
            <span className="signal process" title="Running processes">
              <RotateCw size={11} />
              {presentation.runningProcesses}
            </span>
          ) : null}
          {presentation.changedFiles > 0 ? (
            <span className="signal review" title="Changed files">
              <FileDiff size={11} />
              {presentation.changedFiles}
            </span>
          ) : null}
          {presentation.hasHandoffReady ? (
            <span className="signal handoff" title="Handoff ready">
              <GitMerge size={11} />
            </span>
          ) : null}
        </div>
      </div>
      {selected ? <span className="station-selected-marker">Selected</span> : null}
      <span
        role="button"
        tabIndex={0}
        className="station-remove"
        title="Remove employee"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }
        }}
      >
        <Trash2 size={13} />
      </span>
    </button>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const next = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2);
  return (next || "E").toUpperCase();
}
