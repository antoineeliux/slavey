import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import { walkAreaIdForPoint } from "./navigationAreas";
import type { WalkAreaId } from "./navigationTypes";

export function canViewModelUseWalkArea(
  viewModel: EmployeeFloorViewModel,
  areaId: WalkAreaId,
): boolean {
  if (areaId === "lounge") {
    return ownerAttentionOfficeStates.has(viewModel.officeState);
  }
  if (areaId === "main") {
    return viewModel.worksAtDesk;
  }
  return true;
}

export function pointAllowedForViewModel(
  viewModel: EmployeeFloorViewModel,
  point: THREE.Vector3,
): boolean {
  const areaId = walkAreaIdForPoint(point);
  return Boolean(areaId && canViewModelUseWalkArea(viewModel, areaId));
}

export function isRestrictedForAmbientActors(areaId: WalkAreaId | null): boolean {
  return areaId === "lounge" || areaId === "main";
}

const ownerAttentionOfficeStates = new Set<EmployeeFloorViewModel["officeState"]>([
  "waiting_instruction",
  "terminal_waiting_approval",
  "waiting_approval",
  "reviewing_changes",
  "handoff_ready",
  "blocked",
]);
