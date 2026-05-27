import type { ReactNode } from "react";

import { useAppStore } from "../../store/appStore";
import { EmployeeStation } from "./EmployeeStation";
import { presentEmployeeActivity } from "./activityPresentation";

export function EmployeeScene({ children }: { children?: ReactNode }) {
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
      <div className="employee-station-grid">
        {employees.map((employee) => {
          const presentation = presentEmployeeActivity({
            employee,
            activity: employeeActivities[employee.id] ?? null,
            terminalSessions,
            approvals,
            actions,
            processes,
            review: worktreeReviews[employee.id] ?? null,
            handoff: worktreeHandoffs[employee.id] ?? null,
          });
          return (
            <EmployeeStation
              employee={employee}
              presentation={presentation}
              selected={employee.id === selectedEmployeeId}
              key={employee.id}
              onSelect={() => void selectEmployee(employee.id)}
              onRemove={() => void removeEmployee(employee.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
