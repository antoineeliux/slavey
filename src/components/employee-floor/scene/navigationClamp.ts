import * as THREE from "three";

import {
  closestPointInAreas,
  walkAreaForPoint,
  WALKABLE_AREAS,
} from "./navigationAreas";
import { clampAwayFromObstacles } from "./navigationObstacles";
import { point } from "./navigationTypes";

export function clampToWalkable(source: THREE.Vector3): THREE.Vector3 {
  const area = walkAreaForPoint(source);
  let candidate: THREE.Vector3;
  if (area) {
    candidate = point(
      THREE.MathUtils.clamp(source.x, area.minX, area.maxX),
      THREE.MathUtils.clamp(source.z, area.minZ, area.maxZ),
    );
  } else {
    candidate = closestPointInAreas(source, WALKABLE_AREAS);
  }
  return clampAwayFromObstacles(candidate);
}

export function nudgeWithinWalkable(
  source: THREE.Vector3,
  destination: THREE.Vector3,
  seed: number,
): THREE.Vector3 {
  const dx = destination.x - source.x;
  const dz = destination.z - source.z;
  const length = Math.hypot(dx, dz) || 1;
  const rightX = -dz / length;
  const rightZ = dx / length;
  const direction = seed % 2 === 0 ? 1 : -1;
  const distance = 0.48 + (seed % 3) * 0.12;
  return clampToWalkable(
    point(source.x + rightX * direction * distance, source.z + rightZ * direction * distance),
  );
}

export function pointsShareWalkArea(first: THREE.Vector3, second: THREE.Vector3): boolean {
  const firstArea = walkAreaForPoint(first);
  const secondArea = walkAreaForPoint(second);
  return Boolean(firstArea && secondArea && firstArea.id === secondArea.id);
}
