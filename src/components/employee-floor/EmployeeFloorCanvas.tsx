import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_OWNER_AVATAR_APPEARANCE,
  type OwnerAvatarAppearance,
} from "./avatarAppearance";
import type { EmployeeFloorViewModel } from "./employeeFloorViewModel";
import {
  DEFAULT_OFFICE_COLOR_THEME,
  type OfficeColorTheme,
} from "./officeColorTheme";
import {
  createEmployeeFloorRuntime,
  type EmployeeFloorRuntime,
  type EmployeeFloorRuntimeProps,
} from "./runtime/createEmployeeFloorRuntime";

export function EmployeeFloorCanvas({
  viewModels,
  onSelectEmployee,
  onSelectHotspot,
  avatarAppearance = DEFAULT_OWNER_AVATAR_APPEARANCE,
  ownerName = "You",
  showOwnerAvatar = false,
  enableSelectionFocus = true,
  minimumDeskCount = 8,
  officeColorTheme = DEFAULT_OFFICE_COLOR_THEME,
  nameplateScale = 1,
}: {
  viewModels: EmployeeFloorViewModel[];
  onSelectEmployee: (employeeId: string) => void;
  onSelectHotspot?: (hotspotId: string) => void;
  avatarAppearance?: OwnerAvatarAppearance;
  ownerName?: string;
  showOwnerAvatar?: boolean;
  enableSelectionFocus?: boolean;
  minimumDeskCount?: number;
  officeColorTheme?: OfficeColorTheme;
  nameplateScale?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<EmployeeFloorRuntime | null>(null);
  const [rendererUnavailable, setRendererUnavailable] = useState(false);

  const runtimeProps = useMemo<EmployeeFloorRuntimeProps>(
    () => ({
      viewModels,
      onSelectEmployee,
      onSelectHotspot,
      avatarAppearance,
      ownerName,
      showOwnerAvatar,
      enableSelectionFocus,
      minimumDeskCount,
      officeColorTheme,
      nameplateScale,
    }),
    [
      avatarAppearance,
      enableSelectionFocus,
      minimumDeskCount,
      nameplateScale,
      officeColorTheme,
      onSelectEmployee,
      onSelectHotspot,
      ownerName,
      showOwnerAvatar,
      viewModels,
    ],
  );
  const runtimePropsRef = useRef(runtimeProps);
  runtimePropsRef.current = runtimeProps;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setRendererUnavailable(true);
      return undefined;
    }

    const runtime = createEmployeeFloorRuntime(container, runtimePropsRef.current);
    runtimeRef.current = runtime;
    setRendererUnavailable(!runtime);

    return () => {
      runtime?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.updateProps(runtimeProps);
  }, [runtimeProps]);

  return (
    <div className="employee-floor-canvas" ref={containerRef}>
      {rendererUnavailable ? (
        <div className="employee-floor-unavailable" role="status">
          3D floor unavailable
        </div>
      ) : null}
    </div>
  );
}
