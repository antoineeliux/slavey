import * as THREE from "three";

import type { EmployeeFloorVisualState } from "../employeeFloorViewModel";
import {
  DEFAULT_OFFICE_COLOR_THEME,
  type OfficeColorTheme,
} from "../officeColorTheme";

export type FloorMaterials = {
  floor: THREE.MeshStandardMaterial;
  floorInset: THREE.MeshStandardMaterial;
  floorLane: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallTrim: THREE.MeshStandardMaterial;
  buildingFacade: THREE.MeshStandardMaterial;
  buildingSide: THREE.MeshStandardMaterial;
  buildingWindow: THREE.MeshStandardMaterial;
  buildingInterior: THREE.MeshStandardMaterial;
  column: THREE.MeshStandardMaterial;
  grid: THREE.MeshStandardMaterial;
  deskTop: THREE.MeshStandardMaterial;
  deskEdge: THREE.MeshStandardMaterial;
  deskLeg: THREE.MeshStandardMaterial;
  chair: THREE.MeshStandardMaterial;
  chairAccent: THREE.MeshStandardMaterial;
  keyboard: THREE.MeshStandardMaterial;
  monitorCase: THREE.MeshStandardMaterial;
  monitorScreen: THREE.MeshStandardMaterial;
  cafeteria: THREE.MeshStandardMaterial;
  cafeteriaTop: THREE.MeshStandardMaterial;
  sofa: THREE.MeshStandardMaterial;
  sofaAccent: THREE.MeshStandardMaterial;
  loungeRug: THREE.MeshStandardMaterial;
  lightPanel: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  cup: THREE.MeshStandardMaterial;
  plant: THREE.MeshStandardMaterial;
  planter: THREE.MeshStandardMaterial;
  windowGlass: THREE.MeshStandardMaterial;
  windowFrame: THREE.MeshStandardMaterial;
  selectionRing: THREE.MeshStandardMaterial;
  marker: Record<EmployeeFloorVisualState, THREE.MeshStandardMaterial>;
};

type MaterialSpec = {
  color: number;
  roughness: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
};

type MarkerSpec = {
  color: number;
  emissiveIntensity: number;
};

type OfficeMaterialPalette = {
  floor: MaterialSpec;
  floorInset: MaterialSpec;
  floorLane: MaterialSpec;
  wall: MaterialSpec;
  wallTrim: MaterialSpec;
  buildingFacade: MaterialSpec;
  buildingSide: MaterialSpec;
  buildingWindow: MaterialSpec;
  buildingInterior: MaterialSpec;
  column: MaterialSpec;
  grid: MaterialSpec;
  deskTop: MaterialSpec;
  deskEdge: MaterialSpec;
  deskLeg: MaterialSpec;
  chair: MaterialSpec;
  chairAccent: MaterialSpec;
  keyboard: MaterialSpec;
  monitorCase: MaterialSpec;
  monitorScreen: MaterialSpec;
  cafeteria: MaterialSpec;
  cafeteriaTop: MaterialSpec;
  sofa: MaterialSpec;
  sofaAccent: MaterialSpec;
  loungeRug: MaterialSpec;
  lightPanel: MaterialSpec;
  metal: MaterialSpec;
  cup: MaterialSpec;
  plant: MaterialSpec;
  planter: MaterialSpec;
  windowGlass: MaterialSpec;
  windowFrame: MaterialSpec;
  selectionRing: MaterialSpec;
  marker: Record<EmployeeFloorVisualState, MarkerSpec>;
};

const OFFICE_MATERIAL_PALETTES: Record<OfficeColorTheme, OfficeMaterialPalette> = {
  "light-warm": {
    windowGlass: {
      color: 0xdde8e4,
      roughness: 0.18,
      emissive: 0xfff0cf,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.3,
    },
    buildingWindow: {
      color: 0xf1e8d2,
      roughness: 0.2,
      emissive: 0xffd88f,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.54,
    },
    floor: { color: 0xd8cbb6, roughness: 0.78 },
    floorInset: { color: 0xe8dcc8, roughness: 0.82 },
    floorLane: { color: 0xcbbba1, roughness: 0.7 },
    wall: { color: 0xf0e4d0, roughness: 0.88 },
    wallTrim: { color: 0x7b674d, roughness: 0.66 },
    buildingFacade: { color: 0xbda98b, roughness: 0.82 },
    buildingSide: { color: 0x8f8068, roughness: 0.78 },
    buildingInterior: { color: 0xf3eadb, roughness: 0.9 },
    column: { color: 0xc3b49c, roughness: 0.8 },
    grid: { color: 0xaa987d, roughness: 0.78 },
    deskTop: { color: 0xa9784b, roughness: 0.58 },
    deskEdge: { color: 0x725037, roughness: 0.62 },
    deskLeg: { color: 0x4a3728, roughness: 0.5 },
    chair: { color: 0x80664b, roughness: 0.58 },
    chairAccent: { color: 0xb08c63, roughness: 0.62 },
    keyboard: { color: 0x2b2723, roughness: 0.72 },
    monitorCase: { color: 0x2b2723, roughness: 0.66 },
    monitorScreen: {
      color: 0x102136,
      roughness: 0.45,
      emissive: 0x6fb7ff,
      emissiveIntensity: 0.18,
    },
    cafeteria: { color: 0xd8cfb8, roughness: 0.72 },
    cafeteriaTop: { color: 0xbe8756, roughness: 0.5 },
    sofa: { color: 0xb79a74, roughness: 0.72 },
    sofaAccent: { color: 0xe6d7bd, roughness: 0.74 },
    loungeRug: { color: 0xc9b99d, roughness: 0.86 },
    lightPanel: {
      color: 0xfff5d7,
      roughness: 0.32,
      emissive: 0xffd88f,
      emissiveIntensity: 0.74,
    },
    metal: { color: 0xb1aa9d, roughness: 0.44 },
    cup: { color: 0xfff8e9, roughness: 0.5 },
    plant: { color: 0x6fa65f, roughness: 0.7 },
    planter: { color: 0x80604a, roughness: 0.7 },
    windowFrame: { color: 0x8a7559, roughness: 0.66 },
    selectionRing: {
      color: 0xfff4d6,
      roughness: 0.48,
      emissive: 0xd99f4a,
      emissiveIntensity: 0.5,
    },
    marker: {
      social_idle: { color: 0x9d8d76, emissiveIntensity: 0.26 },
      offline_stopped: { color: 0x8a7c69, emissiveIntensity: 0.16 },
      desk_terminal: { color: 0x4f9fd7, emissiveIntensity: 0.42 },
      desk_working: { color: 0x77a86b, emissiveIntensity: 0.46 },
      desk_waiting_instruction: { color: 0x6caed6, emissiveIntensity: 0.48 },
      desk_waiting_approval: { color: 0xd99f4a, emissiveIntensity: 0.5 },
      desk_review: { color: 0xb98ad6, emissiveIntensity: 0.44 },
      social_handoff_ready: { color: 0x84ad65, emissiveIntensity: 0.5 },
      desk_blocked: { color: 0xd96c5f, emissiveIntensity: 0.58 },
    },
  },
  "dark-ide": {
    windowGlass: {
      color: 0xaec7d8,
      roughness: 0.2,
      emissive: 0x4e87b8,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.26,
    },
    buildingWindow: {
      color: 0x8eb6d9,
      roughness: 0.24,
      emissive: 0x3f8fd2,
      emissiveIntensity: 0.24,
      transparent: true,
      opacity: 0.52,
    },
    floor: { color: 0x1e2630, roughness: 0.78 },
    floorInset: { color: 0x252e39, roughness: 0.82 },
    floorLane: { color: 0x303a46, roughness: 0.7 },
    wall: { color: 0x566579, roughness: 0.88 },
    wallTrim: { color: 0x151b23, roughness: 0.66 },
    buildingFacade: { color: 0x2f3b4a, roughness: 0.82 },
    buildingSide: { color: 0x18202a, roughness: 0.78 },
    buildingInterior: { color: 0x111821, roughness: 0.9 },
    column: { color: 0x3c4a5a, roughness: 0.8 },
    grid: { color: 0x566579, roughness: 0.78 },
    deskTop: { color: 0x7b5632, roughness: 0.58 },
    deskEdge: { color: 0x4a3422, roughness: 0.62 },
    deskLeg: { color: 0x10151b, roughness: 0.5 },
    chair: { color: 0x1f2b36, roughness: 0.58 },
    chairAccent: { color: 0x33465a, roughness: 0.62 },
    keyboard: { color: 0x0b0f14, roughness: 0.72 },
    monitorCase: { color: 0x0b0f14, roughness: 0.66 },
    monitorScreen: {
      color: 0x07111b,
      roughness: 0.45,
      emissive: 0x4daafc,
      emissiveIntensity: 0.2,
    },
    cafeteria: { color: 0x2f3d34, roughness: 0.72 },
    cafeteriaTop: { color: 0x9a6a3a, roughness: 0.5 },
    sofa: { color: 0x2f4254, roughness: 0.72 },
    sofaAccent: { color: 0x627486, roughness: 0.74 },
    loungeRug: { color: 0x273447, roughness: 0.86 },
    lightPanel: {
      color: 0xe8eef7,
      roughness: 0.32,
      emissive: 0x90c2ff,
      emissiveIntensity: 0.58,
    },
    metal: { color: 0x74808e, roughness: 0.44 },
    cup: { color: 0xd7dce2, roughness: 0.5 },
    plant: { color: 0x5fa56b, roughness: 0.7 },
    planter: { color: 0x2f2520, roughness: 0.7 },
    windowFrame: { color: 0x151b23, roughness: 0.66 },
    selectionRing: {
      color: 0xd7dce2,
      roughness: 0.48,
      emissive: 0x4daafc,
      emissiveIntensity: 0.5,
    },
    marker: {
      social_idle: { color: 0x8b949e, emissiveIntensity: 0.26 },
      offline_stopped: { color: 0x5f6874, emissiveIntensity: 0.16 },
      desk_terminal: { color: 0x4daafc, emissiveIntensity: 0.42 },
      desk_working: { color: 0x89d185, emissiveIntensity: 0.46 },
      desk_waiting_instruction: { color: 0x79c0ff, emissiveIntensity: 0.48 },
      desk_waiting_approval: { color: 0xe5c07b, emissiveIntensity: 0.5 },
      desk_review: { color: 0xc586f7, emissiveIntensity: 0.44 },
      social_handoff_ready: { color: 0x89d185, emissiveIntensity: 0.5 },
      desk_blocked: { color: 0xf48771, emissiveIntensity: 0.58 },
    },
  },
};

export function createMaterials(
  theme: OfficeColorTheme = DEFAULT_OFFICE_COLOR_THEME,
): FloorMaterials {
  const palette = OFFICE_MATERIAL_PALETTES[theme];
  const windowGlass = standardFromSpec(palette.windowGlass);
  const buildingWindow = standardFromSpec(palette.buildingWindow);

  return {
    floor: standardFromSpec(palette.floor),
    floorInset: standardFromSpec(palette.floorInset),
    floorLane: standardFromSpec(palette.floorLane),
    wall: standardFromSpec(palette.wall),
    wallTrim: standardFromSpec(palette.wallTrim),
    buildingFacade: standardFromSpec(palette.buildingFacade),
    buildingSide: standardFromSpec(palette.buildingSide),
    buildingWindow,
    buildingInterior: standardFromSpec(palette.buildingInterior),
    column: standardFromSpec(palette.column),
    grid: standardFromSpec(palette.grid),
    deskTop: standardFromSpec(palette.deskTop),
    deskEdge: standardFromSpec(palette.deskEdge),
    deskLeg: standardFromSpec(palette.deskLeg),
    chair: standardFromSpec(palette.chair),
    chairAccent: standardFromSpec(palette.chairAccent),
    keyboard: standardFromSpec(palette.keyboard),
    monitorCase: standardFromSpec(palette.monitorCase),
    monitorScreen: standardFromSpec(palette.monitorScreen),
    cafeteria: standardFromSpec(palette.cafeteria),
    cafeteriaTop: standardFromSpec(palette.cafeteriaTop),
    sofa: standardFromSpec(palette.sofa),
    sofaAccent: standardFromSpec(palette.sofaAccent),
    loungeRug: standardFromSpec(palette.loungeRug),
    lightPanel: standardFromSpec(palette.lightPanel),
    metal: standardFromSpec(palette.metal),
    cup: standardFromSpec(palette.cup),
    plant: standardFromSpec(palette.plant),
    planter: standardFromSpec(palette.planter),
    windowGlass,
    windowFrame: standardFromSpec(palette.windowFrame),
    selectionRing: standardFromSpec(palette.selectionRing),
    marker: {
      social_idle: markerMaterialFromSpec(palette.marker.social_idle),
      offline_stopped: markerMaterialFromSpec(palette.marker.offline_stopped),
      desk_terminal: markerMaterialFromSpec(palette.marker.desk_terminal),
      desk_working: markerMaterialFromSpec(palette.marker.desk_working),
      desk_waiting_instruction: markerMaterialFromSpec(palette.marker.desk_waiting_instruction),
      desk_waiting_approval: markerMaterialFromSpec(palette.marker.desk_waiting_approval),
      desk_review: markerMaterialFromSpec(palette.marker.desk_review),
      social_handoff_ready: markerMaterialFromSpec(palette.marker.social_handoff_ready),
      desk_blocked: markerMaterialFromSpec(palette.marker.desk_blocked),
    },
  };
}

export function applyMaterialsTheme(materials: FloorMaterials, theme: OfficeColorTheme): void {
  const palette = OFFICE_MATERIAL_PALETTES[theme];
  applyMaterialSpec(materials.floor, palette.floor);
  applyMaterialSpec(materials.floorInset, palette.floorInset);
  applyMaterialSpec(materials.floorLane, palette.floorLane);
  applyMaterialSpec(materials.wall, palette.wall);
  applyMaterialSpec(materials.wallTrim, palette.wallTrim);
  applyMaterialSpec(materials.buildingFacade, palette.buildingFacade);
  applyMaterialSpec(materials.buildingSide, palette.buildingSide);
  applyMaterialSpec(materials.buildingWindow, palette.buildingWindow);
  applyMaterialSpec(materials.buildingInterior, palette.buildingInterior);
  applyMaterialSpec(materials.column, palette.column);
  applyMaterialSpec(materials.grid, palette.grid);
  applyMaterialSpec(materials.deskTop, palette.deskTop);
  applyMaterialSpec(materials.deskEdge, palette.deskEdge);
  applyMaterialSpec(materials.deskLeg, palette.deskLeg);
  applyMaterialSpec(materials.chair, palette.chair);
  applyMaterialSpec(materials.chairAccent, palette.chairAccent);
  applyMaterialSpec(materials.keyboard, palette.keyboard);
  applyMaterialSpec(materials.monitorCase, palette.monitorCase);
  applyMaterialSpec(materials.monitorScreen, palette.monitorScreen);
  applyMaterialSpec(materials.cafeteria, palette.cafeteria);
  applyMaterialSpec(materials.cafeteriaTop, palette.cafeteriaTop);
  applyMaterialSpec(materials.sofa, palette.sofa);
  applyMaterialSpec(materials.sofaAccent, palette.sofaAccent);
  applyMaterialSpec(materials.loungeRug, palette.loungeRug);
  applyMaterialSpec(materials.lightPanel, palette.lightPanel);
  applyMaterialSpec(materials.metal, palette.metal);
  applyMaterialSpec(materials.cup, palette.cup);
  applyMaterialSpec(materials.plant, palette.plant);
  applyMaterialSpec(materials.planter, palette.planter);
  applyMaterialSpec(materials.windowGlass, palette.windowGlass);
  applyMaterialSpec(materials.windowFrame, palette.windowFrame);
  applyMaterialSpec(materials.selectionRing, palette.selectionRing);
  applyMarkerSpec(materials.marker.social_idle, palette.marker.social_idle);
  applyMarkerSpec(materials.marker.offline_stopped, palette.marker.offline_stopped);
  applyMarkerSpec(materials.marker.desk_terminal, palette.marker.desk_terminal);
  applyMarkerSpec(materials.marker.desk_working, palette.marker.desk_working);
  applyMarkerSpec(materials.marker.desk_waiting_instruction, palette.marker.desk_waiting_instruction);
  applyMarkerSpec(materials.marker.desk_waiting_approval, palette.marker.desk_waiting_approval);
  applyMarkerSpec(materials.marker.desk_review, palette.marker.desk_review);
  applyMarkerSpec(materials.marker.social_handoff_ready, palette.marker.social_handoff_ready);
  applyMarkerSpec(materials.marker.desk_blocked, palette.marker.desk_blocked);
}

export function disposeMaterials(materials: FloorMaterials): void {
  const seen = new Set<THREE.Material>();
  for (const value of Object.values(materials)) {
    if (value instanceof THREE.Material) {
      seen.add(value);
    } else {
      Object.values(value).forEach((material) => seen.add(material));
    }
  }
  seen.forEach((material) => material.dispose());
}

function standardFromSpec(spec: MaterialSpec): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: 0.02,
    emissive: spec.emissive ?? 0x000000,
    emissiveIntensity: spec.emissiveIntensity ?? 0,
  });
  material.transparent = spec.transparent ?? false;
  material.opacity = spec.opacity ?? 1;
  return material;
}

function markerMaterialFromSpec(spec: MarkerSpec): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    emissive: spec.color,
    emissiveIntensity: spec.emissiveIntensity,
    roughness: 0.38,
    metalness: 0.02,
  });
}

function applyMaterialSpec(material: THREE.MeshStandardMaterial, spec: MaterialSpec): void {
  material.color.setHex(spec.color);
  material.roughness = spec.roughness;
  material.emissive.setHex(spec.emissive ?? 0x000000);
  material.emissiveIntensity = spec.emissiveIntensity ?? 0;
  material.transparent = spec.transparent ?? false;
  material.opacity = spec.opacity ?? 1;
  material.needsUpdate = true;
}

function applyMarkerSpec(material: THREE.MeshStandardMaterial, spec: MarkerSpec): void {
  material.color.setHex(spec.color);
  material.emissive.setHex(spec.color);
  material.emissiveIntensity = spec.emissiveIntensity;
  material.needsUpdate = true;
}
