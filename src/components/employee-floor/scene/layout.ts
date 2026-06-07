import * as THREE from "three";

import {
  CAFETERIA_WANDER_POINTS_MANIFEST,
  OFFICE_CORRIDOR_LINES,
  OFFICE_DESK_LAYOUT,
  OFFICE_DONE_ROOM_POINTS,
  OFFICE_EXECUTIVE_QUEUE_POINTS,
  OFFICE_SOCIAL_CLUSTERS_MANIFEST,
  OFFICE_STANDBY_SLOTS,
  OFFICE_WANDER_POINTS_MANIFEST,
  type OfficePoint2D,
  type OfficeStandbyRoomId,
} from "./officeLayoutManifest";

export type DeskAnchor = {
  desk: THREE.Vector3;
  cafeteria: THREE.Vector3;
  officeA: THREE.Vector3;
  officeB: THREE.Vector3;
  row: number;
};

export type OfficeRoomSlot = {
  id: string;
  room: OfficeStandbyRoomId;
  position: THREE.Vector3;
  facing: number;
};

export const OFFICE_ROOM_OCCUPANT_SLOTS: OfficeRoomSlot[] = OFFICE_STANDBY_SLOTS.map(
  (slot) => ({
    id: slot.id,
    room: slot.room,
    position: point2D(slot.position),
    facing: slot.facing,
  }),
);

export const OFFICE_VISUAL_CAPACITY = OFFICE_ROOM_OCCUPANT_SLOTS.length;

export const STANDBY_WANDER_POINTS = OFFICE_ROOM_OCCUPANT_SLOTS.map((slot) =>
  slot.position.clone(),
);

export const EXECUTIVE_QUEUE_POINTS = OFFICE_EXECUTIVE_QUEUE_POINTS.map(point2D);

export const DONE_ROOM_POINTS = OFFICE_DONE_ROOM_POINTS.map(point2D);

export const OFFICE_WANDER_POINTS = OFFICE_WANDER_POINTS_MANIFEST.map(point2D);

export const CAFETERIA_WANDER_POINTS = CAFETERIA_WANDER_POINTS_MANIFEST.map(point2D);

export const EMPLOYEE_ENTRY_POINT = new THREE.Vector3(
  0,
  0,
  OFFICE_CORRIDOR_LINES.frontHallZ,
);

export const SOCIAL_CLUSTERS = {
  office: OFFICE_SOCIAL_CLUSTERS_MANIFEST.office.map((cluster) => ({
    center: point2D(cluster.center),
    slots: cluster.slots.map(point2D),
  })),
  cafeteria: OFFICE_SOCIAL_CLUSTERS_MANIFEST.cafeteria.map((cluster) => ({
    center: point2D(cluster.center),
    slots: cluster.slots.map(point2D),
  })),
};

export function deskAnchorForIndex(index: number): DeskAnchor {
  const col = index % OFFICE_DESK_LAYOUT.columns;
  const band = Math.floor(index / OFFICE_DESK_LAYOUT.columns);
  const row = 0;
  const bandOffset = Math.floor(index / OFFICE_DESK_LAYOUT.bandSize) * OFFICE_DESK_LAYOUT.bandOffsetStep;
  const desk = new THREE.Vector3(
    OFFICE_DESK_LAYOUT.xStart + col * OFFICE_DESK_LAYOUT.xSpacing,
    0,
    band % 2 === 0 ? OFFICE_DESK_LAYOUT.frontRowZ : OFFICE_DESK_LAYOUT.rearRowZ + bandOffset,
  );
  return {
    row,
    desk,
    cafeteria: new THREE.Vector3(
      OFFICE_DESK_LAYOUT.cafeteria.xStart + (index % OFFICE_DESK_LAYOUT.columns) * OFFICE_DESK_LAYOUT.cafeteria.xSpacing,
      0,
      OFFICE_DESK_LAYOUT.cafeteria.zStart +
        Math.floor((index % OFFICE_DESK_LAYOUT.bandSize) / OFFICE_DESK_LAYOUT.columns) *
          OFFICE_DESK_LAYOUT.cafeteria.zRowSpacing,
    ),
    officeA: OFFICE_WANDER_POINTS[index % OFFICE_WANDER_POINTS.length].clone(),
    officeB: OFFICE_WANDER_POINTS[(index + 3) % OFFICE_WANDER_POINTS.length].clone(),
  };
}

export function standbyAnchorForIndex(index: number): OfficeRoomSlot {
  return OFFICE_ROOM_OCCUPANT_SLOTS[index % OFFICE_ROOM_OCCUPANT_SLOTS.length];
}

export function hashUnit(value: string, salt = 0): number {
  let hash = 2166136261 + salt;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function point2D([x, z]: OfficePoint2D): THREE.Vector3 {
  return new THREE.Vector3(x, 0, z);
}
