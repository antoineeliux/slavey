import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CAFETERIA_WANDER_POINTS,
  DONE_ROOM_POINTS,
  EXECUTIVE_QUEUE_POINTS,
  OFFICE_ROOM_OCCUPANT_SLOTS,
  OFFICE_WANDER_POINTS,
} from "./layout";
import {
  clampToWalkable,
  createNavigationPath,
  isDoorwayOrCorridorPoint,
  nudgeWithinWalkable,
  pointIsFurnitureBlocked,
  segmentCrossesFurniture,
  walkAreaIdForPoint,
} from "./navigation";

describe("navigation", () => {
  it("routes from the executive office to a work desk through valid doors and halls", () => {
    const start = new THREE.Vector3(-5.2, 0, 8.0);
    const desk = new THREE.Vector3(-7.25, 0, -3.1);
    const path = createNavigationPath(start, desk);
    const areaIds = path.map((point) => walkAreaIdForPoint(point));

    expect(path.length).toBeGreaterThan(2);
    expect(areaIds.every(Boolean)).toBe(true);
    expect(areaIds).toContain("front_hall");
    expect(areaIds).toContain("main");
    expect(path.at(-1)?.distanceTo(desk)).toBeLessThan(0.01);
  });

  it("routes between side rooms through hallway areas instead of crossing the center walls", () => {
    const start = new THREE.Vector3(-14.25, 0, -3.3);
    const destination = new THREE.Vector3(14.25, 0, -3.3);
    const path = createNavigationPath(start, destination);
    const areaIds = path.map((point) => walkAreaIdForPoint(point));

    expect(areaIds.every(Boolean)).toBe(true);
    expect(areaIds).toContain("left_hall");
    expect(areaIds).toContain("right_hall");
    expect(path.at(-1)?.distanceTo(destination)).toBeLessThan(0.01);
  });

  it("marks doorway and hall points as pass-through zones", () => {
    expect(isDoorwayOrCorridorPoint(new THREE.Vector3(-8.25, 0, 4.35))).toBe(true);
    expect(isDoorwayOrCorridorPoint(new THREE.Vector3(-8.25, 0, 5.55))).toBe(true);
    expect(isDoorwayOrCorridorPoint(new THREE.Vector3(-5.2, 0, 8.0))).toBe(false);
  });

  it("nudges stuck actors without leaving walkable space", () => {
    const source = new THREE.Vector3(-8.25, 0, 5.55);
    const destination = new THREE.Vector3(-5.2, 0, 8.0);
    const nudged = nudgeWithinWalkable(source, destination, 3);

    expect(walkAreaIdForPoint(nudged)).not.toBeNull();
    expect(nudged.distanceTo(source)).toBeGreaterThan(0.2);
  });

  it("clamps social targets out of furniture footprints", () => {
    const tablePoint = new THREE.Vector3(8.95, 0, 10.15);
    const clamped = clampToWalkable(tablePoint);

    expect(pointIsFurnitureBlocked(tablePoint)).toBe(true);
    expect(pointIsFurnitureBlocked(clamped)).toBe(false);
    expect(walkAreaIdForPoint(clamped)).toBe("cafeteria");
  });

  it("routes same-room walking around tables instead of through them", () => {
    const start = new THREE.Vector3(4.25, 0, 8.75);
    const destination = new THREE.Vector3(13.25, 0, 10.15);
    const path = createNavigationPath(start, destination);
    const fullPath = [start, ...path];

    expect(path.length).toBeGreaterThan(1);
    expect(path.every((point) => !pointIsFurnitureBlocked(point))).toBe(true);
    for (let index = 1; index < fullPath.length; index += 1) {
      expect(segmentCrossesFurniture(fullPath[index - 1], fullPath[index])).toBe(false);
    }
  });

  it("keeps social and queue anchor points out of furniture", () => {
    const points = [
      ...DONE_ROOM_POINTS,
      ...EXECUTIVE_QUEUE_POINTS,
      ...OFFICE_WANDER_POINTS,
      ...CAFETERIA_WANDER_POINTS,
      ...OFFICE_ROOM_OCCUPANT_SLOTS.map((slot) => slot.position),
    ];

    const blocked = points
      .filter((point) => pointIsFurnitureBlocked(point))
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`);

    expect(blocked).toEqual([]);
  });
});
