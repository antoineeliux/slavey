import * as THREE from "three";

import type { FloorScene } from "../scene/createScene";
import type { ActorMap } from "../scene/updateActors";
import type { EmployeeFloorRuntimeProps } from "./runtimeTypes";
import { employeeIdForObject, officeHotspotIdForObject } from "./picking";

export function installPointerSelectionRuntime({
  canvas,
  floorScene,
  actors,
  getProps,
  markInteraction,
}: {
  canvas: HTMLCanvasElement;
  floorScene: FloorScene;
  actors: ActorMap;
  getProps: () => EmployeeFloorRuntimeProps;
  markInteraction: () => void;
}): { dispose: () => void } {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerStart = new THREE.Vector2();
  let activePointerId: number | null = null;

  const handlePointerMove = (event: PointerEvent) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) {
      return;
    }
    markInteraction();
    activePointerId = event.pointerId;
    pointerStart.set(event.clientX, event.clientY);
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled this pointer.
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    activePointerId = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // OrbitControls may have already released capture for the same pointer.
    }
    if (pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, floorScene.camera);
    const props = getProps();
    const hotspotHit = raycaster
      .intersectObject(floorScene.officeGroup, true)
      .find((intersection) => officeHotspotIdForObject(intersection.object));
    const hotspotId = hotspotHit ? officeHotspotIdForObject(hotspotHit.object) : null;
    if (hotspotId && props.onSelectHotspot) {
      event.preventDefault();
      props.onSelectHotspot(hotspotId);
      return;
    }

    const actorRoots = Array.from(actors.values()).map((actor) => actor.root);
    const hit = raycaster
      .intersectObjects(actorRoots, true)
      .find((intersection) => employeeIdForObject(intersection.object));
    const employeeId = hit ? employeeIdForObject(hit.object) : null;
    if (employeeId) {
      event.preventDefault();
      props.onSelectEmployee(employeeId);
    }
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId === event.pointerId) {
      activePointerId = null;
    }
  };

  const handleLostPointerCapture = (event: PointerEvent) => {
    if (activePointerId === event.pointerId) {
      activePointerId = null;
    }
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
  canvas.addEventListener("wheel", markInteraction, { passive: true });

  return {
    dispose: () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("lostpointercapture", handleLostPointerCapture);
      canvas.removeEventListener("wheel", markInteraction);
    },
  };
}
