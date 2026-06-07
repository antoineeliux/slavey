import { lazy, Suspense, useCallback, useMemo, type ReactNode } from "react";

import { useAppStore } from "../../store/appStore";
import { EmployeeStation } from "./EmployeeStation";
import { presentEmployeeActivity } from "./activityPresentation";

const EmployeeSceneFloor = lazy(() =>
  import("./EmployeeSceneFloor").then((module) => ({ default: module.EmployeeSceneFloor })),
);

export function EmployeeScene({
  children,
  showFloor = true,
}: {
  children?: ReactNode;
  showFloor?: boolean;
}) {
  const employees = useAppStore((state) => state.employees);
  const employeeActivities = useAppStore((state) => state.employeeActivities);
  const selectedEmployeeId = useAppStore((state) => state.selectedEmployeeId);
  const terminalSessions = useAppStore((state) => state.terminalSessions);
  const approvals = useAppStore((state) => state.approvals);
  const actions = useAppStore((state) => state.actions);
  const processes = useAppStore((state) => state.processes);
  const worktreeReviews = useAppStore((state) => state.worktreeReviews);
  const worktreeHandoffs = useAppStore((state) => state.worktreeHandoffs);
  const selectEmployee = useAppStore((state) => state.selectEmployee);
  const removeEmployee = useAppStore((state) => state.removeEmployee);
  const stationModels = useMemo(
    () =>
      employees.map((employee) => ({
        employee,
        presentation: presentEmployeeActivity({
          employee,
          activity: employeeActivities[employee.id] ?? null,
          terminalSessions,
          approvals,
          actions,
          processes,
          review: worktreeReviews[employee.id] ?? null,
          handoff: worktreeHandoffs[employee.id] ?? null,
        }),
      })),
    [
      actions,
      approvals,
      employeeActivities,
      employees,
      processes,
      terminalSessions,
      worktreeHandoffs,
      worktreeReviews,
    ],
  );
  const handleSelectEmployee = useCallback(
    (employeeId: string) => {
      void selectEmployee(employeeId);
    },
    [selectEmployee],
  );

  if (children) {
    return <div className="employee-scene">{children}</div>;
  }

  if (employees.length === 0) {
    return (
      <div className="employee-scene empty" data-testid="employee-scene">
        <div className="employee-scene-empty">Create an employee to start a shell session.</div>
      </div>
    );
  }

  return (
    <div
      className="employee-scene"
      data-testid="employee-scene"
      aria-label="Employee command floor"
    >
      <div className="employee-scene-header">
        <span>Command floor</span>
        <strong>{employees.length} employee{employees.length === 1 ? "" : "s"}</strong>
      </div>
      {showFloor ? (
        <Suspense fallback={null}>
          <EmployeeSceneFloor
            stationModels={stationModels}
            selectedEmployeeId={selectedEmployeeId}
            onSelectEmployee={handleSelectEmployee}
          />
        </Suspense>
      ) : null}
      <div className="employee-station-debug">
        {showFloor ? <div className="employee-station-debug-header">Station cards</div> : null}
        <div className="employee-station-grid">
          {stationModels.map(({ employee, presentation }) => (
            <EmployeeStation
              employee={employee}
              presentation={presentation}
              selected={employee.id === selectedEmployeeId}
              key={employee.id}
              onSelect={() => handleSelectEmployee(employee.id)}
              onRemove={() => void removeEmployee(employee.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
