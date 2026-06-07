import { EmployeeFloor } from "./employee-floor/EmployeeFloor";
import { OfficeAvatarCustomizer } from "./office/OfficeAvatarCustomizer";
import { OfficeCreateEmployeeModal } from "./office/OfficeCreateEmployeeModal";
import { OfficeStatusHud } from "./office/OfficeStatusHud";
import { OfficeTerminalDock } from "./office/OfficeTerminalDock";
import { OfficeToolbar } from "./office/OfficeToolbar";
import { useOfficeViewModel } from "./office/useOfficeViewModel";

export function OfficePane() {
  const office = useOfficeViewModel();

  return (
    <div className="office-pane">
      <OfficeToolbar
        employeeCount={office.employeeCount}
        name={office.name}
        role={office.role}
        cwd={office.cwd}
        roles={office.roles}
        placeholder={office.nextName}
        cwdPlaceholder={office.cwdPlaceholder}
        workspaceRoot={office.workspaceRoot}
        officeColorTheme={office.officeColorTheme}
        nameplateScale={office.nameplateScale}
        onNameChange={office.setName}
        onRoleChange={office.setRole}
        onCwdChange={office.setCwd}
        onThemeChange={office.setOfficeColorTheme}
        onNameplateScaleChange={office.setNameplateScale}
        onSubmit={office.submitCreateEmployee}
      />
      <EmployeeFloor
        viewModels={office.floorViewModels}
        onSelectEmployee={office.handleSelectEmployee}
        onSelectHotspot={office.handleSelectOfficeHotspot}
        avatarAppearance={office.avatarAppearance}
        ownerName={office.ownerName}
        minimumDeskCount={8}
        mode="office"
        officeColorTheme={office.officeColorTheme}
        nameplateScale={office.nameplateScale}
      />
      <OfficeStatusHud
        viewModel={office.selectedFloorModel}
        pendingApproval={office.pendingApproval}
        pendingAction={office.pendingAction}
        handoff={office.reviewHandoff}
        handoffDisabledReason={office.handoffDisabledReason}
        changedFiles={office.selectedChangedFiles}
        onOpenTerminal={office.openTerminalContext}
        onOpenEditor={office.openEditorContext}
        onOpenApprovals={office.openDetailsContext}
        onOpenReview={office.openReviewContext}
        onResolvePendingApproval={office.resolvePendingApproval}
        onApplyHandoff={office.runApplyHandoff}
        onReleaseEmployee={office.releaseEmployee}
        onSetStandby={office.setEmployeeStandby}
        onResumeStandby={office.resumeEmployeeFromStandby}
      />
      <OfficeCreateEmployeeModal
        open={office.createModalOpen}
        name={office.name}
        role={office.role}
        cwd={office.cwd}
        roles={office.roles}
        placeholder={office.nextName}
        cwdPlaceholder={office.cwdPlaceholder}
        workspaceRoot={office.workspaceRoot}
        onNameChange={office.setName}
        onRoleChange={office.setRole}
        onCwdChange={office.setCwd}
        onClose={office.closeCreateModal}
        onSubmit={office.submitCreateEmployee}
      />
      <OfficeAvatarCustomizer
        open={office.avatarCustomizerOpen}
        appearance={office.avatarAppearance}
        ownerName={office.ownerName}
        onCycle={office.cycleAvatarOption}
        onNameChange={office.setOwnerName}
        onClose={office.closeAvatarCustomizer}
      />
      <OfficeTerminalDock
        employee={office.terminalDockEmployee}
        activeSession={office.terminalDockSession}
        expanded={office.terminalDockExpanded}
        onClose={office.closeTerminalDock}
        onStartShell={office.startShellTerminal}
        onStop={office.stopTerminal}
        onRelease={office.releaseEmployee}
        onToggleExpanded={office.toggleTerminalDockExpanded}
      />
    </div>
  );
}
