import * as THREE from "three";

import type { OfficeWalkAreaId } from "./officeLayoutManifest";

export type WalkAreaId = OfficeWalkAreaId;

export type WalkArea = {
  id: WalkAreaId;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type WalkObstacle = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function point(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, z);
}

export function pointFromManifest([x, z]: readonly [number, number]): THREE.Vector3 {
  return point(x, z);
}

export function containsPoint(area: WalkArea, pointValue: THREE.Vector3): boolean {
  return (
    pointValue.x >= area.minX &&
    pointValue.x <= area.maxX &&
    pointValue.z >= area.minZ &&
    pointValue.z <= area.maxZ
  );
}

export function samePoint2D(first: THREE.Vector3, second: THREE.Vector3, tolerance: number): boolean {
  return Math.hypot(first.x - second.x, first.z - second.z) <= tolerance;
}

export function near(value: number, target: number): boolean {
  return Math.abs(value - target) < 0.18;
}
