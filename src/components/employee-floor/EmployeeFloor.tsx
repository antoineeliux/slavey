import { useMemo } from "react";

import { EmployeeFloorCanvas } from "./EmployeeFloorCanvas";
import type { OwnerAvatarAppearance } from "./avatarAppearance";
import type { EmployeeFloorViewModel } from "./employeeFloorViewModel";
import type { OfficeColorTheme } from "./officeColorTheme";

export function EmployeeFloor({
  viewModels,
  onSelectEmployee,
  onSelectHotspot,
  avatarAppearance,
  ownerName,
  minimumDeskCount = 8,
  mode = "compact",
  officeColorTheme,
  nameplateScale = 1,
}: {
  viewModels: EmployeeFloorViewModel[];
  onSelectEmployee: (employeeId: string) => void;
  onSelectHotspot?: (hotspotId: string) => void;
  avatarAppearance?: OwnerAvatarAppearance;
  ownerName?: string;
  minimumDeskCount?: number;
  mode?: "compact" | "office";
  officeColorTheme?: OfficeColorTheme;
  nameplateScale?: number;
}) {
  const selected = viewModels.find((viewModel) => viewModel.selected) ?? null;
  const counts = useMemo(
    () => {
      const employees = viewModels.filter((viewModel) => viewModel.kind === "employee");
      return {
        atDesk: employees.filter((viewModel) => viewModel.worksAtDesk).length,
        social: employees.filter((viewModel) => !viewModel.worksAtDesk && !viewModel.muted).length,
        offline: employees.filter((viewModel) => viewModel.muted).length,
      };
    },
    [viewModels],
  );

  return (
    <section
      className={mode === "office" ? "employee-floor office-mode" : "employee-floor"}
      aria-label="Animated employee command floor"
    >
      <EmployeeFloorCanvas
        viewModels={viewModels}
        onSelectEmployee={onSelectEmployee}
        onSelectHotspot={onSelectHotspot}
        avatarAppearance={avatarAppearance}
        ownerName={ownerName}
        showOwnerAvatar={mode === "office"}
        enableSelectionFocus={mode !== "office"}
        minimumDeskCount={minimumDeskCount}
        officeColorTheme={officeColorTheme}
        nameplateScale={nameplateScale}
      />
      {mode === "office" ? null : <div className="employee-floor-strip">
        <span
          className={selected ? `floor-selected state-${selected.sourceState}` : "floor-selected"}
          title={selected?.stationTitle ?? "No employee selected"}
        >
          {selected ? `${selected.name}: ${selected.label}` : "No employee selected"}
        </span>
        <span>{counts.atDesk} at desks</span>
        <span>{counts.social} social</span>
        {counts.offline > 0 ? <span>{counts.offline} offline</span> : null}
      </div>}
    </section>
  );
}
