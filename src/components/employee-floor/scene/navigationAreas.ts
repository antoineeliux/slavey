import * as THREE from "three";

import {
  OFFICE_HALL_IDS,
  OFFICE_WALK_AREAS,
} from "./officeLayoutManifest";
import {
  containsPoint,
  point,
  type WalkArea,
  type WalkAreaId,
} from "./navigationTypes";

export const WALKABLE_AREAS: WalkArea[] = OFFICE_WALK_AREAS.map((area) => ({
  id: area.id,
  minX: area.minX,
  maxX: area.maxX,
  minZ: area.minZ,
  maxZ: area.maxZ,
}));

const HALL_AREA_IDS = new Set<WalkAreaId>(OFFICE_HALL_IDS);

export function walkAreaForPoint(pointValue: THREE.Vector3): WalkArea | null {
  return WALKABLE_AREAS.find((area) => containsPoint(area, pointValue)) ?? null;
}

export function walkAreaIdForPoint(pointValue: THREE.Vector3): WalkAreaId | null {
  return walkAreaForPoint(pointValue)?.id ?? null;
}

export function isCorridorPoint(pointValue: THREE.Vector3): boolean {
  const area = walkAreaForPoint(pointValue);
  return area ? corridorArea(area.id) : false;
}

export function corridorArea(areaId: WalkAreaId): boolean {
  return HALL_AREA_IDS.has(areaId);
}

export function closestPointInAreas(source: THREE.Vector3, areas: WalkArea[]): THREE.Vector3 {
  let best = point(source.x, source.z);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const candidate = point(
      THREE.MathUtils.clamp(source.x, area.minX, area.maxX),
      THREE.MathUtils.clamp(source.z, area.minZ, area.maxZ),
    );
    const distance = Math.hypot(candidate.x - source.x, candidate.z - source.z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
