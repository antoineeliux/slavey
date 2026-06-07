import * as THREE from "three";

import type { FloorMaterials } from "./materials";
import { OFFICE_FLOOR } from "./officeLayoutManifest";
import { addSkyscraperCutaway } from "./officeBackdrop";
import {
  addCocktailBarFurniture,
  addEntertainmentRoomFurniture,
  addMeetingRoomFurniture,
} from "./officeFurniture";
import {
  box,
  interiorGlassMaterials,
  SHOW_INTERIOR_GLASS_PARTITIONS,
} from "./officePrimitives";

const FLOOR_WIDTH = OFFICE_FLOOR.width;
const FLOOR_DEPTH = OFFICE_FLOOR.depth;
const BACK_Z = OFFICE_FLOOR.backZ;
const MAIN_ROOM_LEFT_X = OFFICE_FLOOR.mainRoomBounds.minX;
const MAIN_ROOM_RIGHT_X = OFFICE_FLOOR.mainRoomBounds.maxX;
const MAIN_ROOM_BACK_Z = OFFICE_FLOOR.mainRoomBounds.minZ;
const MAIN_ROOM_FRONT_Z = OFFICE_FLOOR.mainRoomBounds.maxZ;

export function addShell(group: THREE.Group, materials: FloorMaterials): void {
  addSkyscraperCutaway(group, materials);
  group.add(box([FLOOR_WIDTH, 0.18, FLOOR_DEPTH], [0, -0.09, 0], materials.floor, false, true));
  group.add(box([FLOOR_WIDTH + 0.35, 0.42, 0.2], [0, 0.16, BACK_Z + 0.02], materials.wall, false, true));
  group.add(box([0.26, 1.2, FLOOR_DEPTH], [-FLOOR_WIDTH / 2, 0.54, 0], materials.wallTrim, false, true));
  group.add(box([0.26, 1.2, FLOOR_DEPTH], [FLOOR_WIDTH / 2, 0.54, 0], materials.wallTrim, false, true));

  for (const x of [-10.8, -5.6, 0, 5.6, 10.8]) {
    group.add(box([0.18, 0.04, FLOOR_DEPTH - 1.3], [x, 0.025, 0.15], materials.grid, false, false));
  }
  for (const z of [-9.4, -6.4, -4.0, -1.0, 2.25, 4.1, 7.0, 9.8]) {
    group.add(box([FLOOR_WIDTH - 1.1, 0.04, 0.02], [0, 0.025, z], materials.grid, false, false));
  }
}

export function addFloorZones(group: THREE.Group, materials: FloorMaterials): void {
  group.add(box([20.5, 0.04, 5.65], [0, 0.005, -1.25], materials.floorInset, false, true));
  group.add(box([20.6, 0.045, 0.82], [0, 0.035, MAIN_ROOM_FRONT_Z - 0.18], materials.floorLane, false, true));
  group.add(box([20.6, 0.045, 0.72], [0, 0.035, MAIN_ROOM_BACK_Z + 0.15], materials.floorLane, false, true));
  group.add(box([1.85, 0.055, 8.6], [0, 0.065, -0.85], materials.floorLane, false, true));
  group.add(box([1.05, 0.045, 18.1], [MAIN_ROOM_LEFT_X - 0.3, 0.05, -1.25], materials.floorLane, false, true));
  group.add(box([1.05, 0.045, 18.1], [MAIN_ROOM_RIGHT_X + 0.3, 0.05, -1.25], materials.floorLane, false, true));
  group.add(box([14.2, 0.05, 5.8], [-8.25, 0.055, 8.55], materials.loungeRug, false, true));
  group.add(box([14.2, 0.05, 5.8], [8.25, 0.055, 8.55], materials.floorLane, false, true));
  for (const [x, z, width, depth] of [
    [-14.25, -3.3, 4.7, 14.25],
    [14.25, -3.3, 4.7, 14.25],
    [-5.35, -8.85, 9.0, 3.7],
    [5.35, -8.85, 9.0, 3.7],
  ] as const) {
    group.add(box([width, 0.045, depth], [x, 0.045, z], materials.floorInset, false, true));
  }
}

export function addSurroundingRooms(group: THREE.Group, materials: FloorMaterials): void {
  addMainWorkroomPerimeter(group, materials);

  addRoomShell(group, materials, [-14.25, -3.3], [4.75, 14.55], "east");
  addEntertainmentRoomFurniture(group, materials, [-14.25, -3.3]);
  addRoomShell(group, materials, [14.25, -3.3], [4.75, 14.55], "west");
  addCocktailBarFurniture(group, materials, [14.25, -3.3]);

  for (const [x, z, rotation] of [
    [-5.35, -8.85, 0],
    [5.35, -8.85, Math.PI],
  ] as const) {
    addRoomShell(group, materials, [x, z], [9.0, 3.85], "south");
    addMeetingRoomFurniture(group, materials, [x, z], rotation);
  }

  addRoomShell(group, materials, [-8.25, 8.55], [15.2, 6.5], "south");
  addRoomShell(group, materials, [8.25, 8.55], [15.2, 6.5], "south");
}

function addMainWorkroomPerimeter(group: THREE.Group, materials: FloorMaterials): void {
  addGlassWallX(group, materials, MAIN_ROOM_FRONT_Z, MAIN_ROOM_LEFT_X, MAIN_ROOM_RIGHT_X, 0, 3.2);
  addGlassWallX(group, materials, MAIN_ROOM_BACK_Z, MAIN_ROOM_LEFT_X, MAIN_ROOM_RIGHT_X, 0, 2.8);
  addGlassWallZ(group, materials, MAIN_ROOM_LEFT_X, MAIN_ROOM_BACK_Z, MAIN_ROOM_FRONT_Z, -0.5, 2.4);
  addGlassWallZ(group, materials, MAIN_ROOM_RIGHT_X, MAIN_ROOM_BACK_Z, MAIN_ROOM_FRONT_Z, -0.5, 2.4);
}

function addRoomShell(
  group: THREE.Group,
  materials: FloorMaterials,
  center: [number, number],
  size: [number, number],
  doorSide: "north" | "south" | "east" | "west",
): void {
  const [x, z] = center;
  const [width, depth] = size;
  const left = x - width / 2;
  const right = x + width / 2;
  const back = z - depth / 2;
  const front = z + depth / 2;
  const doorWidth = 1.45;

  addGlassWallX(
    group,
    materials,
    front,
    left,
    right,
    doorSide === "north" ? x : null,
    doorWidth,
  );
  addGlassWallX(
    group,
    materials,
    back,
    left,
    right,
    doorSide === "south" ? x : null,
    doorWidth,
  );
  addGlassWallZ(
    group,
    materials,
    left,
    back,
    front,
    doorSide === "west" ? z : null,
    doorWidth,
  );
  addGlassWallZ(
    group,
    materials,
    right,
    back,
    front,
    doorSide === "east" ? z : null,
    doorWidth,
  );
}

function addGlassWallX(
  group: THREE.Group,
  materials: FloorMaterials,
  z: number,
  startX: number,
  endX: number,
  doorCenterX: number | null,
  doorWidth: number,
): void {
  if (!SHOW_INTERIOR_GLASS_PARTITIONS) return;

  for (const [from, to] of wallSegments(startX, endX, doorCenterX, doorWidth)) {
    const interior = interiorGlassMaterials(materials);
    const width = to - from;
    const x = from + width / 2;
    group.add(box([width, 0.08, 0.055], [x, 0.12, z], interior.sill, true, true));
    group.add(box([width, 2.32, 0.026], [x, 1.5, z], interior.glass, false, false));
    group.add(box([width, 0.035, 0.045], [x, 2.72, z], interior.frame, true, true));
    for (let frameX = from + 1.55; frameX < to - 0.45; frameX += 2.75) {
      group.add(box([0.026, 2.36, 0.045], [frameX, 1.48, z], interior.frame, true, true));
    }
  }
}

function addGlassWallZ(
  group: THREE.Group,
  materials: FloorMaterials,
  x: number,
  startZ: number,
  endZ: number,
  doorCenterZ: number | null,
  doorWidth: number,
): void {
  if (!SHOW_INTERIOR_GLASS_PARTITIONS) return;

  for (const [from, to] of wallSegments(startZ, endZ, doorCenterZ, doorWidth)) {
    const interior = interiorGlassMaterials(materials);
    const depth = to - from;
    const z = from + depth / 2;
    group.add(box([0.055, 0.08, depth], [x, 0.12, z], interior.sill, true, true));
    group.add(box([0.026, 2.32, depth], [x, 1.5, z], interior.glass, false, false));
    group.add(box([0.045, 0.035, depth], [x, 2.72, z], interior.frame, true, true));
    for (let frameZ = from + 1.55; frameZ < to - 0.45; frameZ += 2.75) {
      group.add(box([0.045, 2.36, 0.026], [x, 1.48, frameZ], interior.frame, true, true));
    }
  }
}

function wallSegments(
  start: number,
  end: number,
  doorCenter: number | null,
  doorWidth: number,
): Array<[number, number]> {
  if (doorCenter === null) return [[start, end]];
  const doorStart = Math.max(start, doorCenter - doorWidth / 2);
  const doorEnd = Math.min(end, doorCenter + doorWidth / 2);
  return [
    [start, doorStart],
    [doorEnd, end],
  ].filter(([from, to]) => to - from > 0.2) as Array<[number, number]>;
}
