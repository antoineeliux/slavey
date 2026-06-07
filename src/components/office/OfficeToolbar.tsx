import { Plus, Type } from "lucide-react";

import type { EmployeeRole } from "../../types";
import {
  OFFICE_COLOR_THEME_OPTIONS,
  type OfficeColorTheme,
} from "../employee-floor/officeColorTheme";
import { OfficeDirectoryPicker } from "./OfficeDirectoryPicker";

export function OfficeToolbar({
  employeeCount,
  name,
  role,
  cwd,
  roles,
  placeholder,
  cwdPlaceholder,
  workspaceRoot,
  officeColorTheme,
  nameplateScale,
  onNameChange,
  onRoleChange,
  onCwdChange,
  onThemeChange,
  onNameplateScaleChange,
  onSubmit,
}: {
  employeeCount: number;
  name: string;
  role: EmployeeRole;
  cwd: string;
  roles: EmployeeRole[];
  placeholder: string;
  cwdPlaceholder: string;
  workspaceRoot: string | null;
  officeColorTheme: OfficeColorTheme;
  nameplateScale: number;
  onNameChange: (name: string) => void;
  onRoleChange: (role: EmployeeRole) => void;
  onCwdChange: (cwd: string) => void;
  onThemeChange: (theme: OfficeColorTheme) => void;
  onNameplateScaleChange: (scale: number) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="office-floating-toolbar">
      <div className="toolbar-title">
        <span>Office</span>
        <small>{employeeCount} employee{employeeCount === 1 ? "" : "s"}</small>
      </div>
      <div className="office-theme-toggle" role="radiogroup" aria-label="Office color theme">
        {OFFICE_COLOR_THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={officeColorTheme === option.id ? "active" : ""}
            role="radio"
            aria-checked={officeColorTheme === option.id}
            title={`${option.label} office theme`}
            onClick={() => onThemeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="office-name-size-control" title="Employee name size">
        <Type size={15} />
        <input
          type="range"
          min="0.7"
          max="2.2"
          step="0.05"
          value={nameplateScale}
          aria-label="Employee name size"
          onChange={(event) => onNameplateScaleChange(Number(event.target.value))}
        />
        <span>{Math.round(nameplateScale * 100)}%</span>
      </label>
      <form
        className="office-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={placeholder}
          aria-label="Employee name"
        />
        <OfficeDirectoryPicker
          value={cwd}
          placeholder={cwdPlaceholder}
          workspaceRoot={workspaceRoot}
          onChange={onCwdChange}
        />
        <select
          value={role}
          onChange={(event) => onRoleChange(event.target.value as EmployeeRole)}
          aria-label="Employee role"
        >
          {roles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="submit" className="icon-button create" title="Create employee">
          <Plus size={16} />
        </button>
      </form>
    </div>
  );
}
