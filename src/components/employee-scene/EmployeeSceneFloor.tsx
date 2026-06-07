import { useMemo } from "react";

import type { Employee } from "../../types";
import { EmployeeFloor } from "../employee-floor/EmployeeFloor";
import { createEmployeeFloorViewModels } from "../employee-floor/employeeFloorViewModel";
import type { EmployeeActivityPresentation } from "./activityPresentation";

type EmployeeSceneFloorProps = {
  stationModels: Array<{
    employee: Employee;
    presentation: EmployeeActivityPresentation;
  }>;
  selectedEmployeeId: string | null;
  onSelectEmployee: (employeeId: string) => void;
};

export function EmployeeSceneFloor({
  stationModels,
  selectedEmployeeId,
  onSelectEmployee,
}: EmployeeSceneFloorProps) {
  const floorViewModels = useMemo(
    () => createEmployeeFloorViewModels(stationModels, selectedEmployeeId),
    [selectedEmployeeId, stationModels],
  );

  return <EmployeeFloor viewModels={floorViewModels} onSelectEmployee={onSelectEmployee} />;
}
