import { describe, expect, it } from "vitest";

import type { EmployeeActivity, EmployeeAttentionReason } from "../types";
import { resolveEmployeeActivityContractView } from "./employeeActivityContractView";

describe("resolveEmployeeActivityContractView", () => {
  it("maps desk work kinds to presentation states and floor intents", () => {
    expect(
      view({
        status: "codex_running",
        placement: "desk",
        renderActivity: "working",
        workKind: "codex",
      }),
    ).toMatchObject({ state: "codex_running", floorIntent: "desk_working" });
    expect(
      view({
        status: "action_running",
        placement: "desk",
        renderActivity: "working",
        workKind: "action",
      }),
    ).toMatchObject({ state: "action_running", floorIntent: "desk_working" });
    expect(
      view({
        status: "process_running",
        placement: "desk",
        renderActivity: "terminal",
        workKind: "process",
      }),
    ).toMatchObject({ state: "process_running", floorIntent: "desk_terminal" });
    expect(
      view({
        status: "shell_running",
        placement: "desk",
        renderActivity: "terminal",
        workKind: "shell",
        workPhase: "idle",
      }),
    ).toMatchObject({ state: "shell_running", floorIntent: "desk_terminal" });
  });

  it("maps done-room shell, starting codex, and idle contracts", () => {
    expect(
      view({
        status: "shell_running",
        placement: "done_room",
        renderActivity: "terminal",
        workKind: "shell",
        workPhase: "idle",
      }),
    ).toMatchObject({ state: "shell_running", floorIntent: "done_room_idle" });
    expect(
      view({
        status: "codex_starting",
        placement: "done_room",
        renderActivity: "terminal",
        workKind: "codex",
        workPhase: "starting",
      }),
    ).toMatchObject({ state: "codex_starting", floorIntent: "done_room_idle" });
    expect(
      view({
        status: "idle",
        placement: "done_room",
        renderActivity: "idle",
        workKind: "none",
        workPhase: "idle",
      }),
    ).toMatchObject({ state: "idle", floorIntent: "done_room_idle" });
  });

  it("distinguishes owner terminal approval from app approval", () => {
    expect(
      view({
        status: "codex_waiting_approval",
        placement: "owner_office",
        renderActivity: "approval",
        workKind: "codex",
        workPhase: "waiting_approval",
        attentionReason: "needs_terminal_approval",
      }),
    ).toMatchObject({
      state: "codex_waiting_approval",
      floorIntent: "owner_terminal_approval",
      attentionRequired: true,
      attentionReason: "needs_terminal_approval",
    });
    expect(
      view({
        status: "action_pending_approval",
        placement: "owner_office",
        renderActivity: "approval",
        workKind: "action",
        workPhase: "waiting_approval",
        attentionReason: "needs_app_approval",
      }),
    ).toMatchObject({
      state: "waiting_approval",
      floorIntent: "owner_approval",
      attentionRequired: true,
      attentionReason: "needs_app_approval",
    });
  });

  it("maps owner review, handoff, done-clean handoff, and blocked contracts", () => {
    expect(
      view({
        status: "review_needed",
        placement: "owner_office",
        renderActivity: "review",
        workKind: "review",
        workPhase: "ready",
        attentionReason: "review_needed",
      }),
    ).toMatchObject({ state: "review_needed", floorIntent: "owner_review" });
    expect(
      view({
        status: "handoff_ready",
        placement: "owner_office",
        renderActivity: "handoff",
        workKind: "review",
        workPhase: "ready",
        attentionReason: "handoff_ready",
      }),
    ).toMatchObject({ state: "handoff_ready", floorIntent: "owner_handoff" });
    expect(
      view({
        status: "done_clean",
        placement: "owner_office",
        renderActivity: "handoff",
        workKind: "review",
        workPhase: "ready",
        attentionReason: "ready_to_report",
      }),
    ).toMatchObject({ state: "done_clean", floorIntent: "owner_handoff" });
    expect(
      view({
        status: "blocked",
        placement: "owner_office",
        renderActivity: "blocked",
        workKind: "none",
        workPhase: "blocked",
        attentionReason: "blocked_needs_help",
      }),
    ).toMatchObject({ state: "blocked", floorIntent: "owner_blocked" });
  });

  it("maps standby and offline contracts", () => {
    expect(
      view({
        status: "standby",
        placement: "standby",
        renderActivity: "idle",
        workKind: "none",
        workPhase: "idle",
        lifecycle: "standby",
      }),
    ).toMatchObject({ state: "standby", floorIntent: "standby" });
    expect(
      view({
        status: "stopped",
        placement: "offline",
        renderActivity: "idle",
        workKind: "none",
        workPhase: "idle",
        lifecycle: "stopped",
      }),
    ).toMatchObject({ state: "stopped", floorIntent: "offline" });
  });
});

function view({
  status,
  placement,
  renderActivity,
  workKind,
  workPhase = "working",
  attentionReason = null,
  lifecycle = "active",
}: {
  status: EmployeeActivity["status"];
  placement: NonNullable<EmployeeActivity["contract"]>["render"]["placement"];
  renderActivity: NonNullable<EmployeeActivity["contract"]>["render"]["activity"];
  workKind: NonNullable<EmployeeActivity["contract"]>["work"]["kind"];
  workPhase?: NonNullable<EmployeeActivity["contract"]>["work"]["phase"];
  attentionReason?: EmployeeAttentionReason | null;
  lifecycle?: NonNullable<EmployeeActivity["contract"]>["lifecycle"];
}) {
  const contract: NonNullable<EmployeeActivity["contract"]> = {
    lifecycle,
    work: {
      kind: workKind,
      phase: workPhase,
      turnOwner: workPhase === "waiting_approval" ? "owner" : "agent",
    },
    render: {
      placement,
      posture: placement === "desk" ? "sitting" : "standing",
      activity: renderActivity,
    },
    attention: {
      required: Boolean(attentionReason),
      reason: attentionReason,
      priority: attentionReason ? "normal" : "none",
    },
    source: {
      runtime: "pty",
      confidence: "structured",
    },
  };
  const contractView = resolveEmployeeActivityContractView({ contract });
  expect(contractView).not.toBeNull();
  return contractView;
}
