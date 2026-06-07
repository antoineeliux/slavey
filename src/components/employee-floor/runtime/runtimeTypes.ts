import type { OwnerAvatarAppearance } from "../avatarAppearance";
import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { OfficeColorTheme } from "../officeColorTheme";

export type EmployeeFloorRuntimeProps = {
  viewModels: EmployeeFloorViewModel[];
  onSelectEmployee: (employeeId: string) => void;
  onSelectHotspot?: (hotspotId: string) => void;
  avatarAppearance: OwnerAvatarAppearance;
  ownerName: string;
  showOwnerAvatar: boolean;
  enableSelectionFocus: boolean;
  minimumDeskCount: number;
  officeColorTheme: OfficeColorTheme;
  nameplateScale: number;
};

export type EmployeeFloorRuntime = {
  updateProps: (nextProps: EmployeeFloorRuntimeProps) => void;
  dispose: () => void;
};
