import * as THREE from "three";

import { walkAreaForPoint } from "./navigationAreas";
import { clampToWalkable } from "./navigationClamp";
import {
  corridorRoute,
  entryFromCorridor,
  exitToCorridor,
} from "./navigationDoors";
import {
  MAX_OBSTACLE_ROUTE_DEPTH,
  obstacleForSegment,
  obstacleRouteCandidates,
  pointIsFurnitureBlocked,
} from "./navigationObstacles";
import {
  samePoint2D,
  type WalkArea,
} from "./navigationTypes";

type OpenAreaRoute = {
  transit: THREE.Vector3;
  waypoints: THREE.Vector3[];
};

const OPEN_WORK_AREA_IDS = new Set<WalkArea["id"]>([
  "main",
  "left_hall",
  "right_hall",
  "front_hall",
  "back_hall",
]);

export function createNavigationPath(
  start: THREE.Vector3,
  destination: THREE.Vector3,
): THREE.Vector3[] {
  const end = clampToWalkable(destination);
  const startArea = walkAreaForPoint(start);
  const endArea = walkAreaForPoint(end);
  if (startArea?.id === endArea?.id || (isOpenWorkArea(startArea) && isOpenWorkArea(endArea))) {
    return obstacleAwarePath(start, [end]);
  }

  const startExit = exitToOpenArea(start, startArea, end);
  const endEntry = entryFromOpenArea(end, endArea, start);
  const transit = routeOpenAreaTransit(startExit.transit, endEntry.transit);
  const path = [
    ...startExit.waypoints,
    ...transit,
    ...endEntry.waypoints,
    end,
  ];

  return obstacleAwarePath(start, compactPath(path));
}

function exitToOpenArea(
  start: THREE.Vector3,
  area: WalkArea | null,
  destination: THREE.Vector3,
): OpenAreaRoute {
  if (isOpenWorkArea(area)) {
    return { transit: clampToWalkable(start), waypoints: [] };
  }

  const exit = exitToCorridor(start, area, destination);
  return { transit: exit.corridor, waypoints: exit.waypoints };
}

function entryFromOpenArea(
  destination: THREE.Vector3,
  area: WalkArea | null,
  start: THREE.Vector3,
): OpenAreaRoute {
  if (isOpenWorkArea(area)) {
    return { transit: clampToWalkable(destination), waypoints: [] };
  }

  const entry = entryFromCorridor(destination, area, start);
  return { transit: entry.corridor, waypoints: entry.waypoints };
}

function routeOpenAreaTransit(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
  if (isOpenWorkPoint(start) && isOpenWorkPoint(end)) {
    return [end];
  }

  return corridorRoute(start, end);
}

function isOpenWorkPoint(pointValue: THREE.Vector3): boolean {
  return isOpenWorkArea(walkAreaForPoint(pointValue));
}

function isOpenWorkArea(area: WalkArea | null): boolean {
  return area ? OPEN_WORK_AREA_IDS.has(area.id) : false;
}

function obstacleAwarePath(start: THREE.Vector3, waypoints: THREE.Vector3[]): THREE.Vector3[] {
  const routed: THREE.Vector3[] = [];
  let current = clampToWalkable(start);
  for (const waypoint of waypoints) {
    const segment = routeSegmentAroundObstacles(current, clampToWalkable(waypoint), 0);
    for (const pointValue of segment) {
      const previous = routed.at(-1);
      if (!previous || !samePoint2D(previous, pointValue, 0.08)) {
        routed.push(pointValue);
      }
    }
    current = routed.at(-1) ?? current;
  }
  return compactPath(routed);
}

function routeSegmentAroundObstacles(
  start: THREE.Vector3,
  end: THREE.Vector3,
  depth: number,
): THREE.Vector3[] {
  const obstacle = obstacleForSegment(start, end);
  if (!obstacle || depth >= MAX_OBSTACLE_ROUTE_DEPTH) {
    return [end];
  }

  const candidates = obstacleRouteCandidates(obstacle)
    .map((candidate) => clampToWalkable(candidate))
    .filter((candidate) => !pointIsFurnitureBlocked(candidate))
    .sort(
      (a, b) =>
        start.distanceTo(a) + a.distanceTo(end) -
        (start.distanceTo(b) + b.distanceTo(end)),
    );

  for (const candidate of candidates) {
    if (samePoint2D(start, candidate, 0.08) || samePoint2D(end, candidate, 0.08)) {
      continue;
    }
    const firstLeg = routeSegmentAroundObstacles(start, candidate, depth + 1);
    const secondLeg = routeSegmentAroundObstacles(candidate, end, depth + 1);
    return [...firstLeg, ...secondLeg];
  }

  return [end];
}

function compactPath(points: THREE.Vector3[]): THREE.Vector3[] {
  const compact: THREE.Vector3[] = [];
  for (const entry of points) {
    const target = clampToWalkable(entry);
    const previous = compact.at(-1);
    if (!previous || !samePoint2D(previous, target, 0.08)) {
      compact.push(target);
    }
  }
  return compact;
}
