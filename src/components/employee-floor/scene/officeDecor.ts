import * as THREE from "three";

import type { FloorMaterials } from "./materials";
import { box, cylinder } from "./officePrimitives";

const OVERHEAD_LIGHT_COLOR = 0xffefd0;
const OVERHEAD_LIGHT_FLOOR_Y = 0.72;

export function addPlants(group: THREE.Group, materials: FloorMaterials): void {
  for (const [x, z, scale, variant] of [
    [-15.9, -10.15, 1.25, "spike"],
    [15.9, -10.1, 1.25, "broad"],
    [-15.4, 10.35, 1.15, "tall"],
    [15.2, 10.25, 1.15, "fern"],
    [-10.0, 5.85, 1.05, "broad"],
    [10.0, 5.85, 1.05, "spike"],
    [-1.25, 5.72, 0.95, "fern"],
    [1.25, 5.74, 0.95, "tall"],
    [-13.65, 6.15, 0.86, "broad"],
    [-3.15, 10.65, 0.82, "cactus"],
    [3.05, 10.58, 0.82, "fern"],
    [13.85, 5.95, 0.9, "cactus"],
    [-11.42, -10.55, 0.72, "fern"],
    [11.42, -10.55, 0.72, "broad"],
  ] as const) {
    const plant = plantGroup(materials, scale, variant);
    plant.position.set(x, 0, z);
    group.add(plant);
  }
}

export function addDecorDetails(group: THREE.Group, materials: FloorMaterials): void {
  for (const [x, z, rotation, width] of [
    [-8.25, 6.62, 0, 3.4],
    [8.25, 6.62, 0, 3.4],
    [-14.25, -9.72, Math.PI * 0.5, 2.2],
    [14.25, -9.72, -Math.PI * 0.5, 2.2],
  ] as const) {
    const shelf = new THREE.Group();
    shelf.position.set(x, 0, z);
    shelf.rotation.y = rotation;
    shelf.add(box([width, 0.16, 0.28], [0, 0.82, 0], materials.deskEdge, true, true));
    shelf.add(box([width, 0.08, 0.32], [0, 1.22, 0], materials.deskEdge, true, true));
    for (let index = 0; index < 7; index += 1) {
      const material = index % 3 === 0 ? materials.marker.desk_review : index % 3 === 1 ? materials.marker.desk_terminal : materials.cup;
      shelf.add(box([0.14, 0.34 + (index % 2) * 0.12, 0.18], [-width / 2 + 0.42 + index * 0.34, 1.02, 0.03], material, true, true));
    }
    group.add(shelf);
  }

  for (const [x, z, rotation, color] of [
    [-15.62, -6.9, Math.PI * 0.5, 0x75bdff],
    [-15.62, 0.2, Math.PI * 0.5, 0xc798ff],
    [15.62, -6.8, -Math.PI * 0.5, 0xf1ce73],
    [15.62, 0.25, -Math.PI * 0.5, 0x76e084],
    [-1.9, -10.82, 0, 0x8ec5d8],
    [1.9, -10.82, 0, 0xff7a70],
  ] as const) {
    group.add(wallArt(materials, [x, 1.8, z], rotation, color));
  }

  for (const [x, z, rotation] of [
    [-7.85, 10.75, 0],
    [-3.85, 9.7, Math.PI * 0.12],
    [4.15, 8.25, -Math.PI * 0.08],
    [13.78, 6.1, Math.PI * 0.5],
  ] as const) {
    const stack = new THREE.Group();
    stack.position.set(x, 0, z);
    stack.rotation.y = rotation;
    stack.add(box([0.52, 0.04, 0.36], [0, 0.12, 0], materials.marker.desk_terminal, true, true));
    stack.add(box([0.46, 0.04, 0.32], [0.02, 0.18, -0.02], materials.marker.desk_review, true, true));
    stack.add(box([0.42, 0.04, 0.3], [-0.02, 0.24, 0.02], materials.cup, true, true));
    group.add(stack);
  }
}

export function addLightingDetails(group: THREE.Group, materials: FloorMaterials): void {
  for (const [x, z, width] of [
    [-6.4, -2.1, 4.2],
    [0, -2.1, 4.2],
    [6.4, -2.1, 4.2],
    [-14.0, -8.35, 2.5],
    [-14.0, -3.3, 2.5],
    [-14.0, 1.75, 2.5],
    [14.0, -8.35, 2.5],
    [14.0, -3.3, 2.5],
    [14.0, 1.75, 2.5],
    [-5.35, -8.65, 4.3],
    [5.35, -8.65, 4.3],
    [-8.25, 8.35, 5.2],
    [8.25, 8.35, 5.2],
  ] as const) {
    group.add(box([width, 0.05, 0.28], [x, 3.36, z], materials.lightPanel, false, false));
    group.add(box([width + 0.16, 0.04, 0.04], [x, 3.32, z - 0.18], materials.metal, false, false));
    group.add(box([width + 0.16, 0.04, 0.04], [x, 3.32, z + 0.18], materials.metal, false, false));
    group.add(overheadPanelLight([x, 3.2, z], { width, depth: 0.28 }));
  }

  for (const [x, z, color, intensity] of [
    [-15.0, 6.18, 0xffdfaa, 0.75],
    [-2.35, 10.35, 0xffe6bd, 0.62],
    [3.5, 10.25, 0xffe6bd, 0.58],
    [13.85, 6.05, 0xcfe8ff, 0.68],
    [-14.95, -9.55, 0xd4eaff, 0.54],
    [14.95, -9.55, 0xffd7a6, 0.54],
  ] as const) {
    const lamp = floorLamp(materials, color, intensity);
    lamp.position.set(x, 0, z);
    group.add(lamp);
  }
}

function floorLamp(materials: FloorMaterials, color: number, intensity: number): THREE.Group {
  const lamp = new THREE.Group();
  lamp.name = "floor-lamp";
  lamp.add(cylinder(0.16, 0.06, [0, 0.03, 0], materials.deskLeg, true));
  lamp.add(cylinder(0.035, 1.48, [0, 0.76, 0], materials.metal, true));
  lamp.add(box([0.48, 0.22, 0.48], [0, 1.54, 0], materials.lightPanel, true, false));
  const bulb = new THREE.PointLight(color, Math.max(7.5, intensity * 11), 7.2, 1.22);
  bulb.name = "floor-lamp-light";
  bulb.position.set(0, 1.52, 0);
  lamp.add(bulb);
  return lamp;
}

export function overheadPanelLight(
  position: [number, number, number],
  size: { width: number; depth: number },
  color = OVERHEAD_LIGHT_COLOR,
  intensity = 7.8,
): THREE.Group {
  const [x, y, z] = position;
  const spread = Math.max(size.width, size.depth);
  const lightGroup = new THREE.Group();
  lightGroup.name = "overhead-panel-light";
  lightGroup.position.set(x, y, z);

  const light = new THREE.SpotLight(
    color,
    intensity + spread * 0.22,
    Math.max(6.4, spread * 1.5),
    Math.PI * 0.43,
    0.6,
    1.14,
  );
  light.name = "overhead-panel-light-source";
  light.position.set(0, 0, 0);

  const target = new THREE.Object3D();
  target.name = "overhead-panel-light-target";
  target.position.set(0, -(y - OVERHEAD_LIGHT_FLOOR_Y), 0);
  light.target = target;

  lightGroup.add(light, target);
  return lightGroup;
}

export function deskLamp(
  position: [number, number, number],
  materials: FloorMaterials,
  color: number,
  intensity: number,
): THREE.Group {
  const lamp = new THREE.Group();
  lamp.position.set(...position);
  lamp.add(cylinder(0.11, 0.04, [0, 0.02, 0], materials.deskLeg, true));
  const arm = cylinder(0.025, 0.38, [0, 0.23, 0], materials.metal, true);
  arm.rotation.z = -0.28;
  lamp.add(arm);
  lamp.add(box([0.36, 0.12, 0.26], [0.08, 0.46, 0], materials.lightPanel, true, false));
  const bulb = new THREE.PointLight(color, Math.max(4.8, intensity * 8.5), 4.4, 1.22);
  bulb.name = "desk-lamp-light";
  bulb.position.set(0.08, 0.44, 0);
  lamp.add(bulb);
  return lamp;
}

function wallArt(
  materials: FloorMaterials,
  position: [number, number, number],
  rotationY: number,
  color: number,
): THREE.Group {
  const art = new THREE.Group();
  art.position.set(...position);
  art.rotation.y = rotationY;
  const artMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.16,
    roughness: 0.5,
    metalness: 0.02,
  });
  art.add(box([1.04, 0.7, 0.04], [0, 0, 0], artMaterial, false, false));
  art.add(box([1.16, 0.06, 0.07], [0, -0.42, 0.01], materials.windowFrame, false, false));
  art.add(box([1.16, 0.06, 0.07], [0, 0.42, 0.01], materials.windowFrame, false, false));
  art.add(box([0.06, 0.78, 0.07], [-0.6, 0, 0.01], materials.windowFrame, false, false));
  art.add(box([0.06, 0.78, 0.07], [0.6, 0, 0.01], materials.windowFrame, false, false));
  return art;
}

export function loungeChair(materials: FloorMaterials): THREE.Group {
  const chair = new THREE.Group();
  chair.add(box([0.82, 0.32, 0.78], [0, 0.28, 0], materials.sofa, true, true));
  chair.add(box([0.86, 0.8, 0.22], [0, 0.66, 0.38], materials.sofa, true, true));
  chair.add(box([0.16, 0.52, 0.78], [-0.5, 0.46, 0], materials.sofaAccent, true, true));
  chair.add(box([0.16, 0.52, 0.78], [0.5, 0.46, 0], materials.sofaAccent, true, true));
  return chair;
}

function plantGroup(
  materials: FloorMaterials,
  scale: number,
  variant: "spike" | "broad" | "tall" | "fern" | "cactus",
): THREE.Group {
  const plant = new THREE.Group();
  plant.scale.setScalar(scale);
  plant.add(box([0.46, 0.38, 0.46], [0, 0.19, 0], materials.planter, true, true));
  if (variant === "cactus") {
    plant.add(cylinder(0.13, 0.95, [0, 0.82, 0], materials.plant, true));
    for (const side of [-1, 1]) {
      const arm = cylinder(0.055, 0.42, [side * 0.18, 0.92, 0], materials.plant, true);
      arm.rotation.z = side * 0.7;
      plant.add(arm);
    }
  } else if (variant === "broad") {
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const leaf = box([0.1, 0.5, 0.28], [Math.cos(angle) * 0.18, 0.62, Math.sin(angle) * 0.18], materials.plant, true, false);
      leaf.rotation.y = angle;
      leaf.rotation.z = Math.sin(angle) * 0.56;
      plant.add(leaf);
    }
  } else if (variant === "tall") {
    plant.add(cylinder(0.045, 1.15, [0, 0.78, 0], materials.plant, true));
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      const leaf = box([0.08, 0.36, 0.2], [Math.cos(angle) * 0.14, 1.25, Math.sin(angle) * 0.14], materials.plant, true, false);
      leaf.rotation.y = angle;
      leaf.rotation.z = Math.sin(angle) * 0.45;
      plant.add(leaf);
    }
  } else if (variant === "fern") {
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const leaf = box([0.055, 0.34, 0.14], [Math.cos(angle) * 0.22, 0.54, Math.sin(angle) * 0.22], materials.plant, true, false);
      leaf.rotation.y = angle;
      leaf.rotation.x = 0.8;
      leaf.rotation.z = Math.sin(angle) * 0.9;
      plant.add(leaf);
    }
  } else {
    for (let index = 0; index < 7; index += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.78, 5), materials.plant);
      const angle = (index / 7) * Math.PI * 2;
      leaf.position.set(Math.cos(angle) * 0.14, 0.62 + index * 0.025, Math.sin(angle) * 0.14);
      leaf.rotation.z = Math.sin(angle) * 0.38;
      leaf.rotation.x = Math.cos(angle) * 0.28;
      leaf.castShadow = true;
      plant.add(leaf);
    }
  }
  return plant;
}
