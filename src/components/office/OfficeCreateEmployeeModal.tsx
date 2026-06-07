import { useEffect } from "react";
import { Plus, X } from "lucide-react";

import type { EmployeeRole } from "../../types";
import { OfficeDirectoryPicker } from "./OfficeDirectoryPicker";

export function OfficeCreateEmployeeModal({
  open,
  name,
  role,
  cwd,
  roles,
  placeholder,
  cwdPlaceholder,
  workspaceRoot,
  onNameChange,
  onRoleChange,
  onCwdChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  role: EmployeeRole;
  cwd: string;
  roles: EmployeeRole[];
  placeholder: string;
  cwdPlaceholder: string;
  workspaceRoot: string | null;
  onNameChange: (name: string) => void;
  onRoleChange: (role: EmployeeRole) => void;
  onCwdChange: (cwd: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="office-modal-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="office-create-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create employee"
      >
        <div className="office-create-modal-header">
          <strong>Create employee</strong>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <form
          className="office-create-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            autoFocus
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
          <button type="submit" className="command-button success">
            <Plus size={14} />
            Create
          </button>
        </form>
      </section>
    </div>
  );
}
