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
} from "./navigationTypes";

export function createNavigationPath(
  start: THREE.Vector3,
  destination: THREE.Vector3,
): THREE.Vector3[] {
  const end = clampToWalkable(destination);
  const startArea = walkAreaForPoint(start);
  const endArea = walkAreaForPoint(end);
  if (startArea?.id === endArea?.id) {
    return obstacleAwarePath(start, [end]);
  }

  const startExit = exitToCorridor(start, startArea, end);
  const endEntry = entryFromCorridor(end, endArea, start);
  const path = [
    ...startExit.waypoints,
    ...corridorRoute(startExit.corridor, endEntry.corridor),
    ...endEntry.waypoints,
    end,
  ];

  return obstacleAwarePath(start, compactPath(path));
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
