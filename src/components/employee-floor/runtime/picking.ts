import * as THREE from "three";

export function employeeIdForObject(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const employeeId = current.userData.employeeId;
    if (typeof employeeId === "string") {
      return employeeId;
    }
    current = current.parent;
  }
  return null;
}

export function officeHotspotIdForObject(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const hotspotId = current.userData.officeHotspotId;
    if (typeof hotspotId === "string") {
      return hotspotId;
    }
    current = current.parent;
  }
  return null;
}
