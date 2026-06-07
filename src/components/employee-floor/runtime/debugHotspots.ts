import * as THREE from "three";

import type { FloorScene } from "../scene/createScene";

type OfficeDebugWindow = Window & {
  __slaveyOfficeDebug?: {
    projectHotspot: (hotspotId: string) => { x: number; y: number } | null;
  };
};

export function installOfficeDebugHotspots(
  floorScene: FloorScene,
  canvas: HTMLCanvasElement,
): void {
  if (import.meta.env.PROD && import.meta.env.VITE_SLAVEY_E2E !== "true") {
    return;
  }

  (window as OfficeDebugWindow).__slaveyOfficeDebug = {
    projectHotspot: (hotspotId: string) => {
      const target = findOfficeHotspotObject(floorScene.officeGroup, hotspotId);
      if (!target) return null;
      target.updateWorldMatrix(true, false);
      const center = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
      center.project(floorScene.camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + ((center.x + 1) / 2) * rect.width,
        y: rect.top + ((-center.y + 1) / 2) * rect.height,
      };
    },
  };
}

export function uninstallOfficeDebugHotspots(): void {
  const debugWindow = window as OfficeDebugWindow;
  if (debugWindow.__slaveyOfficeDebug) {
    delete debugWindow.__slaveyOfficeDebug;
  }
}

function findOfficeHotspotObject(root: THREE.Object3D, hotspotId: string): THREE.Object3D | null {
  let target: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!target && object.userData.officeHotspotId === hotspotId) {
      target = object;
    }
  });
  return target;
}
