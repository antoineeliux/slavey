import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  configureOrbitDistanceLimits,
  constrainOrbitView,
  OFFICE_TARGET_BOUNDS,
} from "./cameraRuntime";
import {
  OVERVIEW_CAMERA_TARGET,
  type FloorScene,
} from "../scene/createScene";
import { sizeForContainer } from "./rendererRuntime";

export type EmployeeFloorOrbitRuntime = {
  controls: OrbitControls;
  initialOverviewDistance: number;
};

export function createEmployeeFloorOrbitRuntime(
  floorScene: FloorScene,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): EmployeeFloorOrbitRuntime {
  const controls = new OrbitControls(floorScene.camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = true;
  controls.zoomSpeed = 1.35;
  controls.enablePan = true;
  controls.panSpeed = 0.75;
  controls.screenSpacePanning = false;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.target.copy(OVERVIEW_CAMERA_TARGET);
  const initialOverviewDistance = floorScene.camera.position.distanceTo(controls.target);
  configureOrbitDistanceLimits(controls, width, height, initialOverviewDistance);
  controls.maxPolarAngle = Math.PI * 0.5;
  controls.update();
  constrainOrbitView(floorScene.camera, controls, OFFICE_TARGET_BOUNDS);

  return { controls, initialOverviewDistance };
}

export function installResizeRuntime({
  container,
  renderer,
  floorScene,
  controls,
  initialOverviewDistance,
}: {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  floorScene: FloorScene;
  controls: OrbitControls;
  initialOverviewDistance: number;
}): { dispose: () => void } {
  const resizeObserver = new ResizeObserver(() => {
    const nextSize = sizeForContainer(container);
    renderer.setSize(nextSize.width, nextSize.height, false);
    floorScene.resize(nextSize.width, nextSize.height);
    configureOrbitDistanceLimits(
      controls,
      nextSize.width,
      nextSize.height,
      initialOverviewDistance,
    );
    constrainOrbitView(floorScene.camera, controls, OFFICE_TARGET_BOUNDS);
  });
  resizeObserver.observe(container);

  return {
    dispose: () => resizeObserver.disconnect(),
  };
}

export function installOrbitInteractionRuntime(
  controls: OrbitControls,
  markInteraction: () => void,
): { dispose: () => void } {
  controls.addEventListener("start", markInteraction);
  return {
    dispose: () => controls.removeEventListener("start", markInteraction),
  };
}
