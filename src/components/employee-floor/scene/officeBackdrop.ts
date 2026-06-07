import * as THREE from "three";

import type { FloorMaterials } from "./materials";
import { OFFICE_FLOOR } from "./officeLayoutManifest";
import { box, cylinder } from "./officePrimitives";

const FLOOR_WIDTH = OFFICE_FLOOR.width;
const FLOOR_DEPTH = OFFICE_FLOOR.depth;
const BACK_Z = OFFICE_FLOOR.backZ;

export function addCitySkyline(group: THREE.Group, materials: FloorMaterials): void {
  const city = new THREE.Group();
  city.name = "office-city-skyline";
  const litWindowMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8f7ff,
    emissive: 0xbceeff,
    emissiveIntensity: 1.55,
    metalness: 0,
    roughness: 0.28,
    transparent: true,
    opacity: 0.86,
  });
  const glassFacadeMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fc8d4,
    emissive: 0x3c879a,
    emissiveIntensity: 0.22,
    metalness: 0.02,
    roughness: 0.2,
    transparent: true,
    opacity: 0.38,
  });

  const towers = [
    [-38.5, -31.5, 5.1, 39.0, 5.0, 1.25, 0.06],
    [-31.8, -27.8, 8.4, 38.5, 5.8, 1.45, -0.03],
    [-22.5, -32.6, 5.4, 41.0, 5.2, 1.85, 0.04],
    [-15.2, -26.0, 7.8, 36.5, 5.6, 1.1, -0.02],
    [-6.2, -33.6, 5.2, 40.0, 5.2, 1.65, 0.03],
    [1.0, -27.4, 9.2, 41.5, 6.0, 1.95, -0.01],
    [11.2, -32.8, 5.6, 38.5, 5.3, 1.3, 0.04],
    [18.8, -26.8, 8.0, 37.0, 5.8, 1.18, -0.04],
    [28.0, -31.4, 5.2, 40.0, 5.0, 1.7, 0.03],
    [36.2, -27.5, 8.6, 39.0, 6.0, 1.45, -0.05],
    [-43.0, -18.2, 6.0, 36.0, 5.4, 1.0, 0.08],
    [-35.8, -12.0, 9.0, 34.0, 5.8, 0.8, -0.08],
    [-42.0, -3.6, 5.5, 37.5, 5.3, 1.25, 0.04],
    [-34.8, 4.8, 7.2, 35.0, 5.6, 0.95, -0.06],
    [-26.5, 12.0, 8.2, 36.5, 5.8, 1.15, 0.1],
    [43.0, -18.6, 6.2, 37.0, 5.5, 1.15, -0.08],
    [35.6, -10.8, 9.4, 35.5, 6.0, 1.0, 0.07],
    [42.2, -2.0, 5.8, 38.0, 5.4, 1.35, -0.03],
    [34.8, 6.2, 7.8, 34.5, 5.6, 0.9, 0.06],
    [26.4, 13.0, 8.6, 36.0, 5.9, 1.05, -0.1],
    [-16.0, 18.0, 8.8, 35.0, 6.0, 0.95, 0.2],
    [16.5, 18.8, 9.2, 36.5, 6.2, 1.12, -0.18],
    [-7.0, 25.0, 6.5, 38.5, 5.8, 1.35, 0.14],
    [7.8, 25.5, 6.8, 39.5, 5.8, 1.45, -0.14],
    [-56.0, -43.0, 7.8, 36.0, 6.0, 0.6, 0.08],
    [-44.5, -48.5, 10.2, 34.5, 6.5, 0.4, -0.04],
    [-31.5, -44.8, 6.6, 37.0, 5.8, 0.95, 0.05],
    [-18.5, -50.0, 11.4, 35.5, 6.8, 0.65, -0.03],
    [-4.5, -45.5, 7.2, 38.0, 6.0, 1.1, 0.02],
    [9.5, -50.8, 11.8, 36.0, 6.8, 0.8, -0.02],
    [24.5, -45.0, 7.4, 37.5, 6.0, 1.0, 0.04],
    [39.5, -49.5, 10.4, 35.0, 6.5, 0.55, -0.05],
    [54.5, -43.5, 7.8, 36.5, 6.0, 0.75, 0.06],
    [-58.0, -25.0, 9.6, 34.0, 6.2, 0.25, -0.12],
    [-59.5, -9.0, 7.0, 35.5, 5.8, 0.45, 0.06],
    [-57.0, 7.5, 11.0, 33.5, 6.7, 0.2, -0.08],
    [-51.5, 23.5, 7.6, 36.0, 5.8, 0.7, 0.12],
    [-42.0, 38.0, 10.8, 34.5, 6.8, 0.35, -0.16],
    [58.5, -24.0, 9.8, 34.5, 6.4, 0.35, 0.12],
    [60.0, -8.0, 7.2, 36.0, 5.8, 0.7, -0.06],
    [57.5, 8.5, 11.2, 34.0, 6.8, 0.3, 0.08],
    [51.0, 24.5, 7.8, 36.5, 5.8, 0.8, -0.12],
    [42.0, 39.0, 10.6, 35.0, 6.8, 0.45, 0.16],
    [-30.5, 43.0, 11.6, 34.0, 6.8, 0.25, 0.08],
    [-15.0, 47.0, 7.4, 36.0, 5.8, 0.75, -0.08],
    [0.0, 44.0, 12.4, 35.0, 7.0, 0.5, 0],
    [15.5, 47.5, 7.6, 36.5, 5.8, 0.85, 0.08],
    [31.0, 43.5, 11.4, 34.5, 6.8, 0.35, -0.08],
  ] as const;

  towers.forEach(([x, z, width, height, depth, topY, rotation], index) => {
    city.add(
      cityTower(
        materials,
        litWindowMaterial,
        glassFacadeMaterial,
        index,
        width,
        height,
        depth,
        [x, topY - height / 2, z],
        rotation,
      ),
    );
  });

  for (const [x, z, width, depth] of [
    [-20.0, -29.5, 12.8, 0.26],
    [0, -30.4, 15.4, 0.26],
    [20.0, -29.2, 12.8, 0.26],
    [-37.8, -5.5, 0.28, 22.0],
    [37.8, -5.5, 0.28, 22.0],
  ] as const) {
    city.add(box([width, 0.035, depth], [x, -13.2, z], materials.wallTrim, false, false));
  }

  group.add(city);
}

function cityTower(
  materials: FloorMaterials,
  litWindowMaterial: THREE.Material,
  glassFacadeMaterial: THREE.Material,
  index: number,
  width: number,
  height: number,
  depth: number,
  position: [number, number, number],
  rotation: number,
): THREE.Group {
  const tower = new THREE.Group();
  tower.position.set(...position);
  tower.rotation.y = rotation;

  const facade = index % 3 === 0 ? materials.buildingFacade : materials.buildingSide;
  const darkWindowMaterial = index % 4 === 0 ? materials.windowFrame : materials.buildingWindow;
  const style = index % 4;
  tower.add(box([width, height, depth], [0, 0, 0], facade, true, true));
  tower.add(box([width + 0.18, 0.18, depth + 0.18], [0, height / 2 + 0.08, 0], materials.wallTrim, true, true));
  tower.add(box([width + 0.06, 0.12, depth + 0.06], [0, -height / 2 + 0.08, 0], materials.wallTrim, true, true));
  if (width >= 7) {
    tower.add(box([0.14, height, depth + 0.1], [0, 0, 0], materials.wallTrim, false, false));
  }

  const rows = Math.max(10, Math.floor(height / 1.65));
  const frontCols = Math.max(3, Math.floor(width / 1.05));
  if (style === 2) {
    tower.add(
      box(
        [width * 0.92, height * 0.95, 0.08],
        [0, 0, depth / 2 + 0.075],
        glassFacadeMaterial,
        false,
        false,
      ),
    );
    tower.add(
      box(
        [0.08, height * 0.92, depth * 0.9],
        [width / 2 + 0.075, 0, 0],
        glassFacadeMaterial,
        false,
        false,
      ),
    );
  }

  for (let row = 0; row < rows; row += 1) {
    const wy = -height / 2 + 0.9 + row * 1.45;
    tower.add(box([width + 0.04, 0.025, 0.05], [0, wy + 0.58, depth / 2 + 0.045], materials.wallTrim, false, false));
    if (style === 1 && row % 2 === 0) {
      tower.add(
        box(
          [width * 0.82, 0.055, 0.32],
          [0, wy - 0.32, depth / 2 + 0.22],
          materials.wallTrim,
          false,
          false,
        ),
      );
    }
    for (let col = 0; col < frontCols; col += 1) {
      const lit = (row * 3 + col + index) % 7 !== 0;
      const wx = -width / 2 + 0.58 + col * 1.05;
      tower.add(
        box(
          [0.56, 0.42, 0.06],
          [wx, wy, depth / 2 + 0.055],
          lit ? litWindowMaterial : darkWindowMaterial,
          false,
          false,
        ),
      );
    }
  }

  const sideRows = Math.max(8, Math.floor(height / 2.05));
  const sideCols = Math.max(2, Math.floor(depth / 1.35));
  for (let row = 0; row < sideRows; row += 1) {
    for (let col = 0; col < sideCols; col += 1) {
      if ((row + col + index) % 4 === 0) continue;
      const wz = -depth / 2 + 0.68 + col * 1.35;
      const wy = -height / 2 + 1.0 + row * 1.85;
      tower.add(box([0.06, 0.36, 0.54], [width / 2 + 0.055, wy, wz], litWindowMaterial, false, false));
      tower.add(box([0.06, 0.36, 0.54], [-width / 2 - 0.055, wy, wz], litWindowMaterial, false, false));
    }
  }

  for (const x of [-width * 0.25, width * 0.25]) {
    tower.add(box([0.08, height, 0.07], [x, 0, depth / 2 + 0.07], materials.wallTrim, false, false));
  }
  if (style === 2) {
    for (const x of [-width * 0.36, -width * 0.12, width * 0.12, width * 0.36]) {
      tower.add(box([0.07, height * 0.96, 0.09], [x, 0, depth / 2 + 0.13], materials.windowFrame, false, false));
    }
  }
  if (style === 3) {
    for (const x of [-width * 0.42, width * 0.42]) {
      tower.add(box([0.16, height, depth + 0.18], [x, 0, 0], materials.wallTrim, false, false));
    }
    tower.add(cylinder(0.035, 2.4, [0, height / 2 + 1.45, 0], materials.metal, false));
  }

  tower.add(
    box(
      [width * 0.42, 0.32, depth * 0.34],
      [-width * 0.18, height / 2 + 0.32, -depth * 0.12],
      materials.buildingSide,
      true,
      true,
    ),
  );
  tower.add(
    box(
      [width * 0.2, 0.46, depth * 0.2],
      [width * 0.24, height / 2 + 0.42, depth * 0.18],
      materials.wallTrim,
      true,
      true,
    ),
  );
  if (index % 3 === 1) {
    tower.add(
      box(
        [width * 0.72, 0.12, depth * 0.18],
        [0, height / 2 + 0.62, -depth * 0.24],
        materials.lightPanel,
        false,
        false,
      ),
    );
  }

  return tower;
}

export function addSkyscraperCutaway(group: THREE.Group, materials: FloorMaterials): void {
  const building = new THREE.Group();
  building.name = "office-skyscraper-cutaway";
  const curtainGlass = new THREE.MeshStandardMaterial({
    color: 0xbfdce0,
    emissive: 0x62a8b8,
    emissiveIntensity: 0.18,
    metalness: 0.02,
    roughness: 0.18,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });
  const litGlass = curtainGlass.clone();
  litGlass.color.setHex(0xd8f3f0);
  litGlass.emissive.setHex(0xa6e4df);
  litGlass.emissiveIntensity = 0.36;
  litGlass.opacity = 0.56;
  const storyHeight = 3.15;
  const storyCount = 9;
  const topY = -0.38;
  const towerHeight = storyHeight * storyCount;
  const bottomY = topY - towerHeight;
  const centerY = (topY + bottomY) / 2;
  const frontZ = FLOOR_DEPTH / 2 + 0.36;
  const backZ = BACK_Z - 0.34;
  const leftX = -FLOOR_WIDTH / 2 - 0.24;
  const rightX = FLOOR_WIDTH / 2 + 0.24;

  building.add(box([FLOOR_WIDTH + 0.74, 0.3, FLOOR_DEPTH + 0.7], [0, -0.11, 0], materials.buildingFacade, true, true));
  building.add(box([FLOOR_WIDTH + 0.95, 0.26, FLOOR_DEPTH + 0.86], [0, topY - 0.08, 0], materials.wallTrim, true, true));
  building.add(box([FLOOR_WIDTH + 0.95, 0.32, FLOOR_DEPTH + 0.86], [0, bottomY - 0.16, 0], materials.wallTrim, true, true));

  for (const [x, z] of [
    [leftX, frontZ],
    [rightX, frontZ],
    [leftX, backZ],
    [rightX, backZ],
  ] as const) {
    building.add(box([0.42, towerHeight, 0.42], [x, centerY, z], materials.wallTrim, true, true));
  }

  for (let story = 0; story < storyCount; story += 1) {
    const floorY = topY - (story + 1) * storyHeight;
    const windowCenterY = floorY + storyHeight * 0.53;
    const windowHeight = storyHeight - 0.5;
    const storyGlass = story % 3 === 1 ? curtainGlass : litGlass;

    building.add(box([FLOOR_WIDTH + 1.0, 0.14, FLOOR_DEPTH + 0.84], [0, floorY, 0], materials.wallTrim, true, true));
    building.add(box([FLOOR_WIDTH - 1.05, 0.06, FLOOR_DEPTH - 1.1], [0, floorY + 0.08, 0], materials.buildingInterior, false, true));
    building.add(box([FLOOR_WIDTH + 0.95, 0.18, 0.5], [0, floorY + 0.02, frontZ + 0.04], materials.wallTrim, true, true));
    building.add(box([FLOOR_WIDTH + 0.95, 0.18, 0.5], [0, floorY + 0.02, backZ - 0.04], materials.wallTrim, true, true));
    building.add(box([0.5, 0.18, FLOOR_DEPTH + 0.76], [leftX, floorY + 0.02, 0], materials.wallTrim, true, true));
    building.add(box([0.5, 0.18, FLOOR_DEPTH + 0.76], [rightX, floorY + 0.02, 0], materials.wallTrim, true, true));

    for (const x of [-14.8, -9.85, -4.95, 0, 4.95, 9.85, 14.8]) {
      building.add(box([4.36, windowHeight, 0.07], [x, windowCenterY, frontZ + 0.24], storyGlass, false, false));
      building.add(box([4.36, windowHeight, 0.07], [x, windowCenterY, backZ - 0.24], storyGlass, false, false));
    }

    for (const z of [-9.2, -5.35, -1.5, 2.35, 6.2, 10.05]) {
      building.add(box([0.07, windowHeight, 3.25], [leftX - 0.24, windowCenterY, z], storyGlass, false, false));
      building.add(box([0.07, windowHeight, 3.25], [rightX + 0.24, windowCenterY, z], storyGlass, false, false));
    }

    for (const x of [-17.1, -12.35, -7.45, -2.48, 2.48, 7.45, 12.35, 17.1]) {
      building.add(box([0.095, windowHeight + 0.18, 0.16], [x, windowCenterY, frontZ + 0.28], materials.wallTrim, true, true));
      building.add(box([0.095, windowHeight + 0.18, 0.16], [x, windowCenterY, backZ - 0.28], materials.wallTrim, true, true));
    }

    for (const z of [-10.75, -7.38, -3.52, 0.32, 4.18, 8.02, 11.35]) {
      building.add(box([0.16, windowHeight + 0.18, 0.095], [leftX - 0.28, windowCenterY, z], materials.wallTrim, true, true));
      building.add(box([0.16, windowHeight + 0.18, 0.095], [rightX + 0.28, windowCenterY, z], materials.wallTrim, true, true));
    }

    for (const y of [windowCenterY - 0.74, windowCenterY + 0.74]) {
      building.add(box([FLOOR_WIDTH + 0.5, 0.055, 0.14], [0, y, frontZ + 0.3], materials.windowFrame, false, false));
      building.add(box([FLOOR_WIDTH + 0.5, 0.055, 0.14], [0, y, backZ - 0.3], materials.windowFrame, false, false));
    }
  }

  group.add(building);
}
