import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  configureOrbitDistanceLimits,
  constrainOrbitView,
  OFFICE_TARGET_BOUNDS,
} from "./cameraRuntime";

describe("cameraRuntime", () => {
  it("uses wider distance limits for portrait viewports", () => {
    const controls = fakeControls(new THREE.Vector3(), 0, 0);

    configureOrbitDistanceLimits(controls, 320, 640, 20);

    expect(controls.minDistance).toBe(16);
    expect(controls.maxDistance).toBeCloseTo(20.8);
  });

  it("keeps camera offset while clamping the orbit target", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(40, 10, 40);
    const controls = fakeControls(new THREE.Vector3(30, 4, 30), 7.2, 80);
    const offsetBefore = camera.position.clone().sub(controls.target);

    constrainOrbitView(camera, controls, OFFICE_TARGET_BOUNDS);

    expect(controls.target.x).toBe(OFFICE_TARGET_BOUNDS.maxX);
    expect(controls.target.y).toBe(OFFICE_TARGET_BOUNDS.maxY);
    expect(controls.target.z).toBe(OFFICE_TARGET_BOUNDS.maxZ);
    expect(camera.position.clone().sub(controls.target).distanceTo(offsetBefore)).toBeLessThan(
      0.001,
    );
  });
});

function fakeControls(
  target: THREE.Vector3,
  minDistance: number,
  maxDistance: number,
): OrbitControls {
  return {
    target,
    minDistance,
    maxDistance,
  } as OrbitControls;
}
