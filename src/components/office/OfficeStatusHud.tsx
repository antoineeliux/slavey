import {
  Armchair,
  FileCode2,
  GitBranch,
  Monitor,
  PawPrint,
  Play,
  TerminalSquare,
  UserMinus,
} from "lucide-react";

import type {
  Action,
  ApprovalRequest,
  PetVariant,
  WorktreeHandoffPreflight,
} from "../../types";
import type { EmployeeFloorViewModel } from "../employee-floor/employeeFloorViewModel";
import { OfficeContextActions } from "./OfficeContextActions";

export function OfficeStatusHud({
  viewModel,
  pendingApproval,
  pendingAction,
  handoff,
  handoffDisabledReason,
  changedFiles,
  onOpenTerminal,
  onOpenEditor,
  onOpenApprovals,
  onOpenReview,
  onResolvePendingApproval,
  onApplyHandoff,
  onCreateCompanion,
  onReleaseEmployee,
  onSetStandby,
  onResumeStandby,
  companionCount,
}: {
  viewModel: EmployeeFloorViewModel | null;
  pendingApproval: ApprovalRequest | null;
  pendingAction: Action | null;
  handoff: WorktreeHandoffPreflight | null;
  handoffDisabledReason: string | null;
  changedFiles: string[];
  companionCount: number;
  onOpenTerminal: () => void;
  onOpenEditor: () => void;
  onOpenApprovals: () => void;
  onOpenReview: () => void;
  onResolvePendingApproval: (resolution: "approve" | "reject") => void;
  onApplyHandoff: () => void;
  onCreateCompanion: (employeeId: string, petVariant: PetVariant) => void;
  onReleaseEmployee: (employeeId: string) => void;
  onSetStandby: (employeeId: string) => void;
  onResumeStandby: (employeeId: string) => void;
}) {
  if (!viewModel) {
    return null;
  }

  const statusItems = [
    viewModel.pendingApprovals > 0 ? `${viewModel.pendingApprovals} approvals` : null,
    viewModel.changedFiles > 0 ? `${viewModel.changedFiles} files` : null,
    viewModel.runningActions > 0 ? `${viewModel.runningActions} actions` : null,
    viewModel.runningProcesses > 0 ? `${viewModel.runningProcesses} processes` : null,
    companionCount > 0 ? `${companionCount} pets` : null,
  ].filter(Boolean);
  const isPet = viewModel.visualKind === "pet";
  const releaseDisabledReason = viewModel.worktreePath
    ? "Remove or archive the worktree before releasing"
    : companionCount > 0
      ? "Release attached pets before releasing"
      : null;

  return (
    <aside className={`office-status-hud office-state-${viewModel.officeState}`}>
      <div className="office-status-hud-header">
        <div>
          <span>{viewModel.name}</span>
          <small>{isPet ? petVariantLabel(viewModel.petVariant) : viewModel.role}</small>
        </div>
        <strong>{officeStateLabel(viewModel.officeState)}</strong>
      </div>
      <div className="office-status-detail">{viewModel.detail}</div>
      <div className="office-status-grid">
        <span>
          <GitBranch size={13} />
          {viewModel.branchName ?? "no branch"}
        </span>
        <span>
          <Monitor size={13} />
          {viewModel.terminalSessionId ? "session linked" : "no session"}
        </span>
        <span title={viewModel.worktreePath ?? viewModel.cwd}>
          {shortPath(viewModel.worktreePath ?? viewModel.cwd)}
        </span>
        <span>{statusItems.length > 0 ? statusItems.join(" · ") : viewModel.employeeStatus}</span>
      </div>
      <div className="office-status-actions">
        <button onClick={onOpenTerminal}>
          <TerminalSquare size={15} />
          Terminal
        </button>
        <button onClick={onOpenEditor}>
          <FileCode2 size={15} />
          Editor
        </button>
        {!isPet ? (
          <>
            {PET_VARIANTS.map((petVariant) => (
              <button
                key={petVariant}
                title={`Create ${petVariant} pet`}
                onClick={() => onCreateCompanion(viewModel.id, petVariant)}
              >
                <PawPrint size={15} />
                {petVariantLabel(petVariant)}
              </button>
            ))}
          </>
        ) : null}
        {viewModel.employeeStatus === "standby" ? (
          <button onClick={() => onResumeStandby(viewModel.id)}>
            <Play size={15} />
            Resume
          </button>
        ) : (
          <button onClick={() => onSetStandby(viewModel.id)}>
            <Armchair size={15} />
            Standby
          </button>
        )}
        <button
          className="danger"
          disabled={Boolean(releaseDisabledReason)}
          title={releaseDisabledReason ?? "Release employee"}
          onClick={() => onReleaseEmployee(viewModel.id)}
        >
          <UserMinus size={15} />
          Release
        </button>
      </div>
      <OfficeContextActions
        viewModel={viewModel}
        pendingApproval={pendingApproval}
        pendingAction={pendingAction}
        handoff={handoff}
        handoffDisabledReason={handoffDisabledReason}
        changedFiles={changedFiles}
        onOpenApprovals={onOpenApprovals}
        onOpenReview={onOpenReview}
        onOpenTerminal={onOpenTerminal}
        onResolvePendingApproval={onResolvePendingApproval}
        onApplyHandoff={onApplyHandoff}
      />
    </aside>
  );
}

const PET_VARIANTS: PetVariant[] = ["dog", "cat", "robot"];

function petVariantLabel(variant: PetVariant | null | undefined): string {
  switch (variant) {
    case "cat":
      return "Cat";
    case "robot":
      return "Robot";
    case "dog":
    default:
      return "Dog";
  }
}

function officeStateLabel(state: EmployeeFloorViewModel["officeState"]): string {
  switch (state) {
    case "working_at_desk":
      return "Working";
    case "running_terminal":
      return "Terminal";
    case "waiting_instruction":
      return "Awaiting Prompt";
    case "terminal_waiting_approval":
      return "Terminal Approval";
    case "waiting_approval":
      return "Approval";
    case "reviewing_changes":
      return "Review";
    case "blocked":
      return "Blocked";
    case "handoff_ready":
      return "Done";
    case "standby_available":
      return "Standby";
    case "offline":
      return "Offline";
    case "idle_available":
    case "on_standby":
    default:
      return state === "on_standby" ? "Standby" : "Idle";
  }
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}
