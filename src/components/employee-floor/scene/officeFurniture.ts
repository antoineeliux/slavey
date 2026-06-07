import * as THREE from "three";

import type { FloorMaterials } from "./materials";
import { deskLamp, loungeChair, overheadPanelLight } from "./officeDecor";
import {
  box,
  cup,
  cylinder,
  interiorGlassMaterials,
  markOfficeHotspot,
  SHOW_INTERIOR_GLASS_PARTITIONS,
} from "./officePrimitives";

export function addEntertainmentRoomFurniture(
  group: THREE.Group,
  materials: FloorMaterials,
  center: [number, number],
): void {
  const [x, z] = center;
  addTvScreen(group, materials, [x - 2.28, 2.08, z], "east", "entertainment");
  group.add(box([1.85, 0.42, 0.84], [x - 0.95, 0.34, z - 4.4], materials.sofa, true, true));
  group.add(box([1.9, 0.92, 0.24], [x - 0.95, 0.74, z - 4.82], materials.sofa, true, true));
  group.add(box([1.85, 0.42, 0.84], [x - 0.95, 0.34, z + 4.4], materials.sofa, true, true));
  group.add(box([1.9, 0.92, 0.24], [x - 0.95, 0.74, z + 4.82], materials.sofa, true, true));
  for (const zOffset of [-2.15, 0, 2.15]) {
    const console = new THREE.Group();
    console.position.set(x - 0.85, 0, z + zOffset);
    console.add(box([1.28, 0.74, 0.44], [0, 0.37, 0], materials.cafeteria, true, true));
    console.add(box([0.82, 0.14, 0.05], [0, 0.82, -0.24], materials.monitorScreen, true, false));
    console.add(box([0.34, 0.08, 0.24], [-0.28, 0.86, 0.02], materials.lightPanel, false, false));
    console.add(box([0.34, 0.08, 0.24], [0.28, 0.86, 0.02], materials.marker.desk_terminal, false, false));
    group.add(console);
  }
  group.add(box([1.2, 0.12, 9.8], [x + 0.95, 0.82, z], materials.cafeteriaTop, true, true));
  for (const zOffset of [-4.2, -2.1, 0, 2.1, 4.2]) {
    group.add(cylinder(0.22, 0.48, [x + 0.18, 0.24, z + zOffset], materials.chairAccent, true));
  }
  group.add(box([1.1, 0.1, 7.2], [x + 0.45, 2.78, z], materials.lightPanel, false, false));
  group.add(overheadPanelLight([x + 0.45, 2.62, z], { width: 1.1, depth: 7.2 }, 0xd8edff, 8.1));
}

export function addCocktailBarFurniture(
  group: THREE.Group,
  materials: FloorMaterials,
  center: [number, number],
): void {
  const [x, z] = center;
  addTvScreen(group, materials, [x + 2.28, 2.04, z - 3.7], "west", "bar");
  addTvScreen(group, materials, [x + 2.28, 2.04, z + 3.7], "west", "music");
  group.add(box([1.2, 0.88, 11.2], [x + 1.15, 0.48, z], materials.cafeteria, true, true));
  group.add(box([1.44, 0.16, 11.45], [x + 1.15, 0.98, z], materials.cafeteriaTop, true, true));
  group.add(box([0.2, 1.28, 10.8], [x + 2.1, 1.52, z], materials.deskEdge, true, true));
  for (const zOffset of [-4.7, -3.1, -1.55, 0, 1.55, 3.1, 4.7]) {
    const stool = new THREE.Group();
    stool.position.set(x - 0.08, 0, z + zOffset);
    stool.add(cylinder(0.23, 0.14, [0, 0.58, 0], materials.chairAccent, true));
    stool.add(cylinder(0.06, 0.55, [0, 0.3, 0], materials.metal, true));
    stool.add(cylinder(0.2, 0.04, [0, 0.05, 0], materials.deskLeg, true));
    group.add(stool);
  }
  for (const zOffset of [-4.3, -3.55, -2.8, 2.8, 3.55, 4.3]) {
    group.add(cup([x + 0.72, 1.2, z + zOffset], materials));
  }
  for (const zOffset of [-3.3, -1.9, -0.5, 0.9, 2.3, 3.7]) {
    group.add(box([0.22, 0.44, 0.22], [x + 2.0, 2.12, z + zOffset], materials.cup, true, true));
    group.add(box([0.28, 0.08, 0.28], [x + 2.0, 2.38, z + zOffset], materials.lightPanel, false, false));
  }
  group.add(box([1.1, 0.1, 8.8], [x + 0.85, 2.78, z], materials.lightPanel, false, false));
  group.add(overheadPanelLight([x + 0.85, 2.62, z], { width: 1.1, depth: 8.8 }, 0xffd7a6, 8.4));
}

export function addMeetingRoomFurniture(
  group: THREE.Group,
  materials: FloorMaterials,
  center: [number, number],
  rotation: number,
): void {
  const [x, z] = center;
  const table = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 1.35), materials.cafeteriaTop);
  table.position.set(x, 0.54, z);
  table.rotation.y = rotation;
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);

  for (const [offsetX, offsetZ, chairRotation] of [
    [-1.65, -1.05, 0],
    [0, -1.05, 0],
    [1.65, -1.05, 0],
    [-1.65, 1.05, Math.PI],
    [0, 1.05, Math.PI],
    [1.65, 1.05, Math.PI],
  ] as const) {
    const chair = simpleChair(materials);
    chair.position.set(x + offsetX, 0, z + offsetZ);
    chair.rotation.y = chairRotation + rotation;
    group.add(chair);
  }

  for (const offsetX of [-1.2, 0, 1.2]) {
    group.add(box([0.8, 0.045, 0.34], [x + offsetX, 0.68, z], materials.keyboard, true, false));
  }

  addTvScreen(group, materials, [x, 2.0, z + 1.84], "south", "meeting");
}

type TvFacing = "north" | "south" | "east" | "west";
type TvVariant = "entertainment" | "bar" | "music" | "meeting" | "lounge";

function addTvScreen(
  group: THREE.Group,
  materials: FloorMaterials,
  position: [number, number, number],
  facing: TvFacing,
  variant: TvVariant,
): void {
  const width = variant === "bar" || variant === "music" ? 1.95 : 2.7;
  const height = variant === "bar" || variant === "music" ? 1.04 : 1.46;
  const [x, y, z] = position;
  const normal = facingNormal(facing);
  group.add(orientedBox([x, y, z], facing, width + 0.24, height + 0.2, 0.12, materials.monitorCase, true, false));
  const screenMaterial = materials.monitorScreen.clone();
  screenMaterial.emissive.setHex(0x7ec8ff);
  screenMaterial.emissiveIntensity = 0.34;
  group.add(
    orientedBox(
      [x + normal.x * 0.07, y, z + normal.z * 0.07],
      facing,
      width,
      height,
      0.055,
      screenMaterial,
      true,
      false,
    ),
  );

  const palette = tvPalette(variant);
  const content = [
    [-0.28, 0.26, 0.34, 0.22, palette.primary],
    [0.28, 0.22, 0.42, 0.16, palette.secondary],
    [-0.38, -0.06, 0.22, 0.46, palette.accent],
    [0.18, -0.1, 0.6, 0.12, palette.primary],
    [0.04, -0.34, 0.86, 0.08, palette.secondary],
  ] as const;

  content.forEach(([u, v, itemWidth, itemHeight, color], index) => {
    const material = tvContentMaterial(color, 0.62 + index * 0.05);
    const center = contentPosition(position, facing, u * width, v * height, 0.105);
    group.add(orientedBox(center, facing, itemWidth * width, itemHeight * height, 0.035, material, false, false));
  });

  for (let index = 0; index < 6; index += 1) {
    const u = -0.42 * width + index * 0.17 * width;
    const v = -0.18 * height + Math.sin(index * 1.4) * 0.14 * height;
    const center = contentPosition(position, facing, u, v, 0.115);
    const material = tvContentMaterial(index % 2 === 0 ? palette.accent : palette.secondary, 0.48);
    group.add(orientedBox(center, facing, 0.045 * width, 0.045 * height, 0.04, material, false, false));
  }
}

function facingNormal(facing: TvFacing): { x: number; z: number } {
  switch (facing) {
    case "east":
      return { x: 1, z: 0 };
    case "west":
      return { x: -1, z: 0 };
    case "north":
      return { x: 0, z: 1 };
    case "south":
    default:
      return { x: 0, z: -1 };
  }
}

function contentPosition(
  position: [number, number, number],
  facing: TvFacing,
  u: number,
  v: number,
  normalOffset: number,
): [number, number, number] {
  const [x, y, z] = position;
  const normal = facingNormal(facing);
  if (facing === "east" || facing === "west") {
    return [x + normal.x * normalOffset, y + v, z + u];
  }
  return [x + u, y + v, z + normal.z * normalOffset];
}

function orientedBox(
  position: [number, number, number],
  facing: TvFacing,
  width: number,
  height: number,
  thickness: number,
  material: THREE.Material,
  castShadow: boolean,
  receiveShadow: boolean,
): THREE.Mesh {
  const size: [number, number, number] =
    facing === "east" || facing === "west"
      ? [thickness, height, width]
      : [width, height, thickness];
  return box(size, position, material, castShadow, receiveShadow);
}

function tvPalette(variant: TvVariant): { primary: number; secondary: number; accent: number } {
  switch (variant) {
    case "bar":
      return { primary: 0xf1ce73, secondary: 0xff8a70, accent: 0x8ec5d8 };
    case "music":
      return { primary: 0xc798ff, secondary: 0x75bdff, accent: 0xf1ce73 };
    case "meeting":
      return { primary: 0x75bdff, secondary: 0x76e084, accent: 0xf1ce73 };
    case "lounge":
      return { primary: 0x8ec5d8, secondary: 0xc798ff, accent: 0x76e084 };
    case "entertainment":
    default:
      return { primary: 0xff7a70, secondary: 0x75bdff, accent: 0xf1ce73 };
  }
}

function tvContentMaterial(color: number, emissiveIntensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    roughness: 0.38,
    metalness: 0.02,
  });
}

function simpleChair(materials: FloorMaterials): THREE.Group {
  const chair = new THREE.Group();
  chair.add(box([0.68, 0.18, 0.62], [0, 0.36, 0], materials.chairAccent, true, true));
  chair.add(box([0.7, 0.76, 0.14], [0, 0.78, -0.35], materials.chair, true, true));
  chair.add(cylinder(0.07, 0.34, [0, 0.18, 0], materials.deskLeg, true));
  chair.add(cylinder(0.28, 0.045, [0, 0.04, 0], materials.deskLeg, true));
  return chair;
}

export function addDeskNeighborhood(group: THREE.Group, materials: FloorMaterials): void {
  group.add(box([20.1, 0.12, 0.22], [0, 0.11, -4.75], materials.wallTrim, true, true));
  group.add(box([20.1, 0.12, 0.22], [0, 0.11, 2.72], materials.wallTrim, true, true));

  for (const x of [-4.9, 0, 4.9]) {
    group.add(box([0.15, 1.1, 4.1], [x, 0.58, -1.2], materials.column, true, true));
    if (SHOW_INTERIOR_GLASS_PARTITIONS) {
      group.add(box([0.026, 0.68, 3.72], [x, 1.08, -1.2], interiorGlassMaterials(materials).glass, false, false));
    }
  }

  for (const x of [-7.25, -2.5, 2.25, 7.0]) {
    group.add(box([2.9, 0.05, 0.5], [x, 0.05, -4.78], materials.lightPanel, false, false));
  }
}

export function addExecutiveOffice(group: THREE.Group, materials: FloorMaterials): void {
  addTvScreen(group, materials, [-15.66, 2.05, 8.35], "east", "lounge");

  const desk = new THREE.Group();
  desk.position.set(-12.35, 0, 8.38);
  desk.add(box([3.25, 0.42, 1.32], [0, 0.54, 0], materials.deskTop, true, true));
  desk.add(box([3.42, 0.2, 1.48], [0, 0.78, 0], materials.cafeteriaTop, true, true));
  desk.add(box([0.22, 0.78, 1.25], [-1.52, 0.38, 0], materials.deskEdge, true, true));
  desk.add(box([0.22, 0.78, 1.25], [1.52, 0.38, 0], materials.deskEdge, true, true));
  desk.add(box([0.46, 0.06, 0.88], [-0.78, 0.94, 0.02], materials.keyboard, true, false));
  desk.add(box([0.08, 0.46, 0.92], [-0.22, 1.24, 0.02], materials.monitorScreen, true, false));
  desk.add(box([0.08, 0.28, 0.08], [-0.35, 1.04, 0.02], materials.monitorCase, true, false));
  desk.add(box([0.32, 0.05, 0.42], [-0.48, 0.91, 0.02], materials.monitorCase, true, false));
  desk.add(cup([-1.0, 1.0, 0.42], materials));
  desk.add(deskLamp([-1.06, 0.91, -0.42], materials, 0xffe1aa, 0.58));
  group.add(desk);

  const executiveChair = loungeChair(materials);
  executiveChair.position.set(-14.48, 0, 8.38);
  executiveChair.rotation.y = Math.PI * 0.5;
  executiveChair.scale.setScalar(1.12);
  group.add(executiveChair);

  for (const [x, z, rotation] of [
    [-9.8, 7.22, -Math.PI * 0.34],
    [-9.8, 9.45, Math.PI * 0.34],
  ] as const) {
    const chair = simpleChair(materials);
    chair.position.set(x, 0, z);
    chair.rotation.y = rotation;
    group.add(chair);
  }

  const sofa = new THREE.Group();
  sofa.position.set(-5.85, 0, 10.35);
  sofa.add(box([3.2, 0.44, 0.78], [0, 0.3, 0], materials.sofa, true, true));
  sofa.add(box([3.3, 0.92, 0.24], [0, 0.72, 0.42], materials.sofa, true, true));
  sofa.add(box([0.3, 0.64, 0.82], [-1.72, 0.52, 0], materials.sofaAccent, true, true));
  sofa.add(box([0.3, 0.64, 0.82], [1.72, 0.52, 0], materials.sofaAccent, true, true));
  group.add(sofa);

  group.add(box([2.2, 0.78, 0.42], [-14.25, 0.42, 10.35], materials.cafeteria, true, true));
  group.add(box([2.32, 0.12, 0.52], [-14.25, 0.88, 10.35], materials.cafeteriaTop, true, true));
  for (const x of [-14.85, -14.25, -13.65]) {
    group.add(box([0.2, 0.38, 0.2], [x, 1.16, 10.35], materials.lightPanel, false, false));
  }

  addClothesRack(group, materials);
}

function addClothesRack(group: THREE.Group, materials: FloorMaterials): void {
  const rack = new THREE.Group();
  rack.name = "owner-clothes-rack";
  rack.position.set(-11.7, 0, 6.72);
  rack.rotation.y = Math.PI * 0.5;

  for (const x of [-0.52, 0.52]) {
    rack.add(cylinder(0.035, 1.62, [x, 0.84, 0], materials.metal, true));
    rack.add(cylinder(0.08, 0.06, [x, 0.05, 0], materials.deskLeg, true));
  }
  rack.add(box([1.28, 0.08, 0.08], [0, 1.62, 0], materials.metal, true, true));
  rack.add(box([1.24, 0.04, 0.38], [0, 0.16, 0], materials.deskLeg, true, true));

  const clothing = [
    [-0.34, 0x1f3035],
    [-0.12, 0x75bdff],
    [0.12, 0xc798ff],
    [0.34, 0xd6a94f],
  ] as const;
  clothing.forEach(([x, color], index) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.02,
    });
    rack.add(box([0.18, 0.62, 0.32], [x, 1.16, 0.02], material, true, true));
    const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.01, 6, 20, Math.PI), materials.metal);
    hanger.position.set(x, 1.48, 0);
    hanger.rotation.z = index % 2 === 0 ? 0.1 : -0.1;
    hanger.castShadow = true;
    rack.add(hanger);
  });

  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.01,
    depthWrite: false,
  });
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.92, 0.72), hitMaterial);
  hitbox.position.set(0, 0.96, 0);
  hitbox.name = "owner-clothes-rack-hitbox";
  rack.add(hitbox);

  markOfficeHotspot(rack, "avatar_customizer");
  group.add(rack);
}

export function addCafeteria(group: THREE.Group, materials: FloorMaterials): void {
  addTvScreen(group, materials, [15.66, 2.0, 8.35], "west", "bar");

  group.add(box([5.7, 0.82, 0.72], [9.45, 0.42, 9.9], materials.cafeteria, true, true));
  group.add(box([5.95, 0.14, 0.92], [9.45, 0.88, 9.9], materials.cafeteriaTop, true, true));
  group.add(box([0.82, 0.82, 2.9], [12.25, 0.42, 8.55], materials.cafeteria, true, true));
  group.add(box([1.02, 0.14, 3.12], [12.25, 0.88, 8.55], materials.cafeteriaTop, true, true));
  group.add(box([3.35, 0.72, 1.05], [6.55, 0.37, 7.1], materials.cafeteria, true, true));
  group.add(box([3.55, 0.12, 1.2], [6.55, 0.79, 7.1], materials.cafeteriaTop, true, true));

  for (let index = 0; index < 5; index += 1) {
    group.add(cup([8.6 + index * 0.42, 1.05, 9.72], materials));
  }

  for (const x of [5.35, 6.45, 7.55, 8.65]) {
    const stool = new THREE.Group();
    stool.position.set(x, 0, 6.18);
    stool.add(cylinder(0.24, 0.14, [0, 0.55, 0], materials.chairAccent, true));
    stool.add(cylinder(0.07, 0.55, [0, 0.28, 0], materials.metal, true));
    stool.add(cylinder(0.22, 0.04, [0, 0.04, 0], materials.deskLeg, true));
    group.add(stool);
  }

  for (const [x, z] of [
    [10.25, 6.52],
    [10.9, 7.2],
    [9.45, 7.28],
    [8.72, 6.58],
  ] as const) {
    const smallTable = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.18, 24), materials.cafeteriaTop);
    smallTable.position.set(x, 0.42, z);
    smallTable.castShadow = true;
    group.add(smallTable);
  }
}
