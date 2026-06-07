import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CAFETERIA_WANDER_POINTS_MANIFEST,
  OFFICE_DONE_ROOM_POINTS,
  OFFICE_DOOR_CONNECTIONS,
  OFFICE_EXECUTIVE_QUEUE_POINTS,
  OFFICE_HALL_IDS,
  OFFICE_ROOM_IDS,
  OFFICE_SOCIAL_CLUSTERS_MANIFEST,
  OFFICE_STANDBY_SLOTS,
  OFFICE_STATIC_WALK_OBSTACLES,
  OFFICE_WALK_AREAS,
  OFFICE_WANDER_POINTS_MANIFEST,
  type OfficePoint2D,
} from "./officeLayoutManifest";
import {
  isDoorwayOrCorridorPoint,
  walkAreaForPoint,
} from "./navigation";
import { isRestrictedForAmbientActors } from "./actorAccessRules";
import { OFFICE_ACTION_SCENES } from "./actions/officeActionManifest";

describe("office layout manifest", () => {
  it("defines valid walkable rectangles", () => {
    for (const area of OFFICE_WALK_AREAS) {
      expect(area.minX, `${area.id} minX`).toBeLessThan(area.maxX);
      expect(area.minZ, `${area.id} minZ`).toBeLessThan(area.maxZ);
      expect(Number.isFinite(area.minX)).toBe(true);
      expect(Number.isFinite(area.maxX)).toBe(true);
      expect(Number.isFinite(area.minZ)).toBe(true);
      expect(Number.isFinite(area.maxZ)).toBe(true);
    }
  });

  it("keeps manifest door points walkable or pass-through", () => {
    for (const door of OFFICE_DOOR_CONNECTIONS) {
      for (const [label, pointValue] of [
        ["inside", door.inside],
        ["outside", door.outside],
      ] as const) {
        const worldPoint = point(pointValue);
        expect(
          Boolean(walkAreaForPoint(worldPoint)) || isDoorwayOrCorridorPoint(worldPoint),
          `${door.id} ${label}`,
        ).toBe(true);
      }
    }
  });

  it("keeps actor anchor points walkable", () => {
    for (const [label, pointValue] of actorAnchorPoints()) {
      expect(walkAreaForPoint(point(pointValue))?.id ?? null, label).not.toBeNull();
    }
  });

  it("keeps static furniture obstacles away from actor anchors", () => {
    const blocked = actorAnchorPoints()
      .filter(([, pointValue]) =>
        OFFICE_STATIC_WALK_OBSTACLES.some((obstacle) => containsPoint(obstacle, pointValue)),
      )
      .map(([label, pointValue]) => `${label}:${pointValue[0].toFixed(2)},${pointValue[1].toFixed(2)}`);

    expect(blocked).toEqual([]);
  });

  it("maps doors between known rooms and halls", () => {
    const rooms = new Set(OFFICE_ROOM_IDS);
    const halls = new Set(OFFICE_HALL_IDS);

    for (const door of OFFICE_DOOR_CONNECTIONS) {
      expect(rooms.has(door.from), `${door.id} room`).toBe(true);
      expect(halls.has(door.to), `${door.id} hall`).toBe(true);
    }
  });

  it("keeps ambient anchors out of the executive suite and center workspace", () => {
    const restricted = ambientAnchorPoints()
      .filter(([, pointValue]) =>
        isRestrictedForAmbientActors(walkAreaForPoint(point(pointValue))?.id ?? null),
      )
      .map(([label, pointValue]) => `${label}:${pointValue[0].toFixed(2)},${pointValue[1].toFixed(2)}`);

    expect(restricted).toEqual([]);
  });
});

function actorAnchorPoints(): Array<[string, OfficePoint2D]> {
  return [
    ...OFFICE_STANDBY_SLOTS.map((slot) => [`standby:${slot.id}`, slot.position] as [string, OfficePoint2D]),
    ...OFFICE_DONE_ROOM_POINTS.map((pointValue, index) => [`done:${index}`, pointValue] as [string, OfficePoint2D]),
    ...OFFICE_EXECUTIVE_QUEUE_POINTS.map((pointValue, index) => [`executive:${index}`, pointValue] as [string, OfficePoint2D]),
    ...OFFICE_WANDER_POINTS_MANIFEST.map((pointValue, index) => [`office-wander:${index}`, pointValue] as [string, OfficePoint2D]),
    ...CAFETERIA_WANDER_POINTS_MANIFEST.map((pointValue, index) => [`cafeteria-wander:${index}`, pointValue] as [string, OfficePoint2D]),
    ...OFFICE_SOCIAL_CLUSTERS_MANIFEST.office.flatMap((cluster, index) => [
      [`office-social:${index}:center`, cluster.center] as [string, OfficePoint2D],
      ...cluster.slots.map((slot, slotIndex) => [`office-social:${index}:${slotIndex}`, slot] as [string, OfficePoint2D]),
    ]),
    ...OFFICE_SOCIAL_CLUSTERS_MANIFEST.cafeteria.flatMap((cluster, index) => [
      [`cafeteria-social:${index}:center`, cluster.center] as [string, OfficePoint2D],
      ...cluster.slots.map((slot, slotIndex) => [`cafeteria-social:${index}:${slotIndex}`, slot] as [string, OfficePoint2D]),
    ]),
  ];
}

function ambientAnchorPoints(): Array<[string, OfficePoint2D]> {
  return [
    ...OFFICE_STANDBY_SLOTS.map((slot) => [`standby:${slot.id}`, slot.position] as [string, OfficePoint2D]),
    ...OFFICE_DONE_ROOM_POINTS.map((pointValue, index) => [`done:${index}`, pointValue] as [string, OfficePoint2D]),
    ...OFFICE_WANDER_POINTS_MANIFEST.map((pointValue, index) => [`office-wander:${index}`, pointValue] as [string, OfficePoint2D]),
    ...CAFETERIA_WANDER_POINTS_MANIFEST.map((pointValue, index) => [`cafeteria-wander:${index}`, pointValue] as [string, OfficePoint2D]),
    ...OFFICE_SOCIAL_CLUSTERS_MANIFEST.office.flatMap((cluster, index) => [
      [`office-social:${index}:center`, cluster.center] as [string, OfficePoint2D],
      ...cluster.slots.map((slot, slotIndex) => [`office-social:${index}:${slotIndex}`, slot] as [string, OfficePoint2D]),
    ]),
    ...OFFICE_SOCIAL_CLUSTERS_MANIFEST.cafeteria.flatMap((cluster, index) => [
      [`cafeteria-social:${index}:center`, cluster.center] as [string, OfficePoint2D],
      ...cluster.slots.map((slot, slotIndex) => [`cafeteria-social:${index}:${slotIndex}`, slot] as [string, OfficePoint2D]),
    ]),
    ...OFFICE_ACTION_SCENES.flatMap((scene) =>
      scene.slots.map((slot) => [`action:${scene.id}:${slot.id}`, [slot.target.x, slot.target.z] as const] as [string, OfficePoint2D]),
    ),
  ];
}

function point([x, z]: OfficePoint2D): THREE.Vector3 {
  return new THREE.Vector3(x, 0, z);
}

function containsPoint(
  obstacle: { minX: number; maxX: number; minZ: number; maxZ: number },
  pointValue: OfficePoint2D,
): boolean {
  return (
    pointValue[0] > obstacle.minX &&
    pointValue[0] < obstacle.maxX &&
    pointValue[1] > obstacle.minZ &&
    pointValue[1] < obstacle.maxZ
  );
}
