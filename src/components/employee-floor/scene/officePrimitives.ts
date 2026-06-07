import * as THREE from "three";

import type { FloorMaterials } from "./materials";

export const SHOW_INTERIOR_GLASS_PARTITIONS = true;

export type InteriorGlassMaterials = {
  glass: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  sill: THREE.MeshStandardMaterial;
};

export function interiorGlassMaterials(materials: FloorMaterials): InteriorGlassMaterials {
  const cached = materials.windowGlass.userData.interiorGlassMaterials as InteriorGlassMaterials | undefined;
  if (cached) return cached;

  const glass = materials.windowGlass.clone();
  glass.name = "minimal-interior-glass";
  glass.color.setHex(0xf4fbf7);
  glass.emissive.setHex(0xddeee8);
  glass.emissiveIntensity = 0.018;
  glass.opacity = 0.085;
  glass.transparent = true;
  glass.depthWrite = false;
  glass.roughness = 0.16;

  const frame = materials.windowFrame.clone();
  frame.name = "minimal-interior-window-frame";
  frame.color.setHex(0xc3cec6);
  frame.emissive.setHex(0xdbe7de);
  frame.emissiveIntensity = 0.026;
  frame.opacity = 0.17;
  frame.transparent = true;
  frame.depthWrite = false;

  const sill = frame.clone();
  sill.name = "minimal-interior-window-sill";
  sill.opacity = 0.13;

  const next = { glass, frame, sill };
  materials.windowGlass.userData.interiorGlassMaterials = next;
  return next;
}

export function markOfficeHotspot(object: THREE.Object3D, hotspotId: string): void {
  object.traverse((child) => {
    child.userData.officeHotspotId = hotspotId;
  });
}

export function cup(position: [number, number, number], materials: FloorMaterials): THREE.Group {
  const item = new THREE.Group();
  item.position.set(...position);
  item.add(cylinder(0.09, 0.18, [0, 0, 0], materials.cup, true));
  item.add(box([0.09, 0.03, 0.11], [0.11, 0.02, 0], materials.cup, true, false));
  return item;
}

export function cylinder(
  radius: number,
  height: number,
  position: [number, number, number],
  material: THREE.Material,
  castShadow: boolean,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 18), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

export function box(
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  castShadow: boolean,
  receiveShadow: boolean,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}
