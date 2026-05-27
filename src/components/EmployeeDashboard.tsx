import { useMemo, useState } from "react";
import { Bot, Plus, Trash2 } from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { EmployeeRole } from "../types";

const roles: EmployeeRole[] = ["general", "frontend", "backend", "reviewer", "tester"];

export function EmployeeDashboard() {
  const employees = useAppStore((state) => state.employees);
  const employeeActivities = useAppStore((state) => state.employeeActivities);
  const selectedEmployeeId = useAppStore((state) => state.selectedEmployeeId);
  const approvals = useAppStore((state) => state.approvals);
  const selectEmployee = useAppStore((state) => state.selectEmployee);
  const createEmployee = useAppStore((state) => state.createEmployee);
  const removeEmployee = useAppStore((state) => state.removeEmployee);
  const [name, setName] = useState("");
  const [role, setRole] = useState<EmployeeRole>("general");

  const nextName = useMemo(() => `Employee ${employees.length + 1}`, [employees.length]);

  return (
    <div className="employee-dashboard">
      <form
        className="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void createEmployee({ name: name.trim() || nextName, role });
          setName("");
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={nextName}
          aria-label="Employee name"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as EmployeeRole)}
          aria-label="Employee role"
        >
          {roles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button className="icon-button create" title="Create employee">
          <Plus size={16} />
        </button>
      </form>

      <div className="employee-list">
        {employees.length === 0 ? (
          <div className="empty-card">Create an employee to start a shell session.</div>
        ) : (
          employees.map((employee) => {
            const hasPendingApproval = approvals.some(
              (approval) =>
                approval.employeeId === employee.id && approval.status === "pending",
            );
            const activity = employeeActivities[employee.id];
            return (
              <button
                type="button"
                className={
                  employee.id === selectedEmployeeId
                    ? `employee-card selected ${employee.status}${hasPendingApproval ? " has-approval" : ""}`
                    : `employee-card ${employee.status}${hasPendingApproval ? " has-approval" : ""}`
                }
                key={employee.id}
                onClick={() => void selectEmployee(employee.id)}
              >
              <div className="employee-visual" aria-hidden="true">
                <div className="employee-head">
                  <Bot size={16} />
                </div>
                <div className="employee-body" />
                <div className="typing-dots">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="employee-card-body">
                <div className="employee-card-top">
                  <strong>{employee.name}</strong>
                  <span>{employee.role}</span>
                </div>
                <div className="employee-meta">
                  <span>{activity?.label ?? employee.status.replace("_", " ")}</span>
                  <span>{employee.worktreePath ? "worktree" : "root"}</span>
                  <span>{activity?.details ?? employee.currentCommand ?? "no command"}</span>
                </div>
                {activity ? (
                  <div className="employee-activity-line">
                    <span>{activity.status.replaceAll("_", " ")}</span>
                    {activity.reviewCounts.changedFiles > 0 ? (
                      <span>{activity.reviewCounts.changedFiles} changed</span>
                    ) : null}
                    {activity.activeProcessIds.length > 0 ? (
                      <span>{activity.activeProcessIds.length} process</span>
                    ) : null}
                  </div>
                ) : null}
                <p title={employee.cwd}>{employee.cwd}</p>
                <code>{employee.terminalSessionId ?? "no session"}</code>
              </div>
              <span
                role="button"
                tabIndex={0}
                className="card-remove"
                title="Remove employee"
                onClick={(event) => {
                  event.stopPropagation();
                  void removeEmployee(employee.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    void removeEmployee(employee.id);
                  }
                }}
              >
                <Trash2 size={14} />
              </span>
            </button>
            );
          })
        )}
      </div>
    </div>
  );
}
