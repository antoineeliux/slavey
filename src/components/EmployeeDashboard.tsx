import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { useAppStore } from "../store/appStore";
import type { EmployeeRole } from "../types";
import { EmployeeScene } from "./EmployeeScene";

const roles: EmployeeRole[] = ["general", "frontend", "backend", "reviewer", "tester"];

export function EmployeeDashboard() {
  const employees = useAppStore((state) => state.employees);
  const createEmployee = useAppStore((state) => state.createEmployee);
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
        <EmployeeScene showFloor={false} />
      </div>
    </div>
  );
}
