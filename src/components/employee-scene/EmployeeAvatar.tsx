import { Bot, Keyboard, TerminalSquare } from "lucide-react";

import type { EmployeeVisualState } from "./activityPresentation";

export function EmployeeAvatar({
  state,
  initials,
}: {
  state: EmployeeVisualState;
  initials: string;
}) {
  return (
    <div className={`employee-avatar state-${state}`} aria-hidden="true">
      <div className="avatar-monitor">
        <TerminalSquare size={12} />
      </div>
      <div className="avatar-figure">
        <div className="avatar-head">
          <Bot size={15} />
        </div>
        <div className="avatar-body">{initials}</div>
      </div>
      <div className="avatar-keyboard">
        <Keyboard size={12} />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
