import * as THREE from "three";

import { deskAnchorForIndex } from "./layout";
import { OFFICE_STATIC_WALK_OBSTACLES } from "./officeLayoutManifest";
import {
  closestPointInAreas,
  WALKABLE_AREAS,
} from "./navigationAreas";
import {
  point,
  type WalkObstacle,
} from "./navigationTypes";

export const OBSTACLE_ROUTE_PADDING = 0.42;
export const OBSTACLE_CLEARANCE = 0.1;
export const MAX_OBSTACLE_ROUTE_DEPTH = 5;

export const WALK_OBSTACLES: WalkObstacle[] = [
  ...Array.from({ length: 10 }, (_, index) => deskObstacleForIndex(index)),
  ...OFFICE_STATIC_WALK_OBSTACLES.map((entry) => ({
    id: entry.id,
    minX: entry.minX,
    maxX: entry.maxX,
    minZ: entry.minZ,
    maxZ: entry.maxZ,
  })),
];

export function pointIsFurnitureBlocked(pointValue: THREE.Vector3): boolean {
  return Boolean(obstacleContainingPoint(pointValue));
}

export function segmentCrossesFurniture(
  first: THREE.Vector3,
  second: THREE.Vector3,
): boolean {
  return Boolean(obstacleForSegment(first, second));
}

export function clampAwayFromObstacles(source: THREE.Vector3): THREE.Vector3 {
  let candidate = point(source.x, source.z);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const obstacle = obstacleContainingPoint(candidate);
    if (!obstacle) {
      return candidate;
    }
    candidate = closestClearPoint(candidate, obstacle);
  }
  return candidate;
}

export function obstacleRouteCandidates(obstacleValue: WalkObstacle): THREE.Vector3[] {
  return [
    point(obstacleValue.minX - OBSTACLE_ROUTE_PADDING, obstacleValue.minZ - OBSTACLE_ROUTE_PADDING),
    point(obstacleValue.minX - OBSTACLE_ROUTE_PADDING, obstacleValue.maxZ + OBSTACLE_ROUTE_PADDING),
    point(obstacleValue.maxX + OBSTACLE_ROUTE_PADDING, obstacleValue.minZ - OBSTACLE_ROUTE_PADDING),
    point(obstacleValue.maxX + OBSTACLE_ROUTE_PADDING, obstacleValue.maxZ + OBSTACLE_ROUTE_PADDING),
  ];
}

export function obstacleForSegment(start: THREE.Vector3, end: THREE.Vector3): WalkObstacle | null {
  return (
    WALK_OBSTACLES.find((obstacleValue) =>
      segmentIntersectsObstacle(start, end, obstacleValue),
    ) ?? null
  );
}

export function obstacleContainingPoint(pointValue: THREE.Vector3): WalkObstacle | null {
  return (
    WALK_OBSTACLES.find((obstacleValue) =>
      pointValue.x > obstacleValue.minX &&
      pointValue.x < obstacleValue.maxX &&
      pointValue.z > obstacleValue.minZ &&
      pointValue.z < obstacleValue.maxZ,
    ) ?? null
  );
}

function closestClearPoint(source: THREE.Vector3, obstacleValue: WalkObstacle): THREE.Vector3 {
  const candidates = [
    point(obstacleValue.minX - OBSTACLE_CLEARANCE, source.z),
    point(obstacleValue.maxX + OBSTACLE_CLEARANCE, source.z),
    point(source.x, obstacleValue.minZ - OBSTACLE_CLEARANCE),
    point(source.x, obstacleValue.maxZ + OBSTACLE_CLEARANCE),
    ...obstacleRouteCandidates(obstacleValue),
  ]
    .map((candidate) => closestPointInAreas(candidate, WALKABLE_AREAS))
    .filter((candidate) => !obstacleContainingPoint(candidate));

  return candidates.reduce((best, candidate) =>
    candidate.distanceTo(source) < best.distanceTo(source) ? candidate : best,
  candidates[0] ?? source);
}

function segmentIntersectsObstacle(
  start: THREE.Vector3,
  end: THREE.Vector3,
  obstacleValue: WalkObstacle,
): boolean {
  if (obstacleContainingPoint(start) === obstacleValue || obstacleContainingPoint(end) === obstacleValue) {
    return true;
  }

  let tMin = 0;
  let tMax = 1;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const clips = [
    [-dx, start.x - obstacleValue.minX],
    [dx, obstacleValue.maxX - start.x],
    [-dz, start.z - obstacleValue.minZ],
    [dz, obstacleValue.maxZ - start.z],
  ] as const;

  for (const [edge, distance] of clips) {
    if (Math.abs(edge) < 0.0001) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / edge;
    if (edge < 0) {
      tMin = Math.max(tMin, ratio);
    } else {
      tMax = Math.min(tMax, ratio);
    }
    if (tMin > tMax) return false;
  }
  return tMin <= tMax && tMax >= 0 && tMin <= 1;
}

function deskObstacleForIndex(index: number): WalkObstacle {
  const anchor = deskAnchorForIndex(index);
  const dir = anchor.row === 0 ? 1 : -1;
  const topZ = anchor.desk.z + dir * 1.02;
  return obstacle(
    `work-desk-${index}`,
    anchor.desk.x - 1.52,
    anchor.desk.x + 1.52,
    topZ - 0.78,
    topZ + 0.78,
  );
}

function obstacle(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): WalkObstacle {
  return { id, minX, maxX, minZ, maxZ };
}
