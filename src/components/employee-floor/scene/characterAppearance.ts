import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { FloorMaterials } from "./materials";
import type { EmployeeActor } from "./characterTypes";
import { updateNameplate } from "./characterNameplate";

export function applyCharacterView(
  actor: EmployeeActor,
  viewModel: EmployeeFloorViewModel,
  materials: FloorMaterials,
): void {
  actor.viewModel = viewModel;
  const isStandby = viewModel.kind === "standby";
  actor.selectionRing.visible = viewModel.selected && !isStandby;
  actor.root.visible = true;
  updateNameplate(actor, viewModel.name);
  actor.statusRing.visible = !isStandby;
  actor.marker.visible = !isStandby && viewModel.name.trim().length > 0;
  actor.nameplate.visible = !isStandby && viewModel.name.trim().length > 0;
  const stateMaterial = materials.marker[viewModel.visualState];
  actor.selectionRing.material.color.copy(materials.selectionRing.color);
  actor.selectionRing.material.emissive.copy(materials.selectionRing.emissive);
  actor.selectionRing.material.emissiveIntensity = materials.selectionRing.emissiveIntensity;
  actor.statusRing.material.color.copy(stateMaterial.color);
  actor.statusRing.material.emissive.copy(stateMaterial.emissive);
  actor.marker.children.forEach((child) => {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    if (mesh.isMesh) {
      mesh.material.color.copy(stateMaterial.color);
      mesh.material.emissive.copy(stateMaterial.emissive);
    }
  });
  actor.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.opacity = viewModel.muted ? 0.56 : 1;
      mesh.material.transparent = viewModel.muted;
    }
  });
}
