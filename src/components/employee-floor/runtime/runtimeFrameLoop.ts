import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { FloorScene } from "../scene/createScene";
import {
  updateActors,
  type ActorMap,
} from "../scene/updateActors";
import {
  applySelectionFollow,
  constrainOrbitView,
  OFFICE_TARGET_BOUNDS,
  updateSelectionFocus,
  type FocusMotion,
  type FocusRequest,
} from "./cameraRuntime";
import type { EmployeeFloorRuntimeProps } from "./runtimeTypes";

const TARGET_FRAME_INTERVAL_MS = 1000 / 30;

export type RuntimeFrameLoop = {
  markInteraction: () => void;
  start: () => void;
  wake: () => void;
  dispose: () => void;
};

export function createRuntimeFrameLoop({
  floorScene,
  actors,
  controls,
  renderer,
  getProps,
  getReducedMotion,
  getFocusRequest,
  setFocusRequest,
  isActive,
}: {
  floorScene: FloorScene;
  actors: ActorMap;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  getProps: () => EmployeeFloorRuntimeProps;
  getReducedMotion: () => boolean;
  getFocusRequest: () => FocusRequest | null;
  setFocusRequest: (focusRequest: FocusRequest | null) => void;
  isActive: () => boolean;
}): RuntimeFrameLoop {
  let disposed = false;
  let started = false;
  let framePending = false;
  let forcePendingFrame = false;
  let frameId = 0;
  let frameTimeoutId = 0;
  let lastFrameAt = performance.now();
  let lastRenderedAt = lastFrameAt;
  let elapsed = 0;
  let focusMotion: FocusMotion | null = null;
  let followedEmployeeId: string | null = null;
  let followOffset: THREE.Vector3 | null = null;

  const markInteraction = () => {
    focusMotion = null;
    followedEmployeeId = null;
    followOffset = null;
    setFocusRequest(null);
    wake();
  };

  const renderFrame = (frameTime: number) => {
    framePending = false;
    const forcedFrame = forcePendingFrame;
    forcePendingFrame = false;
    if (disposed) {
      return;
    }
    if (!forcedFrame && !isActive()) {
      return;
    }

    const props = getProps();
    const reducedMotion = getReducedMotion();
    const delta = Math.min((frameTime - lastFrameAt) / 1000, 0.05);
    lastFrameAt = frameTime;
    elapsed += delta;
    updateActors(floorScene, actors, props.viewModels, {
      elapsed,
      delta,
      reducedMotion,
    });
    floorScene.weather.update(delta, reducedMotion);

    if (props.enableSelectionFocus) {
      const focusRequest = getFocusRequest();
      const focusUpdate = updateSelectionFocus({
        camera: floorScene.camera,
        controls,
        actors,
        elapsed,
        reducedMotion,
        focusRequest,
        focusMotion,
      });
      focusMotion = focusUpdate.motion;
      if (focusUpdate.completed && focusUpdate.request) {
        if (getFocusRequest()?.version === focusUpdate.request.version) {
          setFocusRequest(null);
        }
        followedEmployeeId = focusUpdate.request.employeeId;
        followOffset = floorScene.camera.position.clone().sub(controls.target);
      }
      if (!focusMotion && followedEmployeeId) {
        const stillFollowing = applySelectionFollow({
          camera: floorScene.camera,
          controls,
          actors,
          employeeId: followedEmployeeId,
          delta,
          followOffset,
        });
        if (!stillFollowing) {
          followedEmployeeId = null;
          followOffset = null;
        }
      }
    } else {
      focusMotion = null;
      followedEmployeeId = null;
      followOffset = null;
    }

    controls.update();
    constrainOrbitView(floorScene.camera, controls, OFFICE_TARGET_BOUNDS);
    renderer.render(floorScene.scene, floorScene.camera);
    lastRenderedAt = frameTime;
    scheduleFrame();
  };

  const scheduleFrame = (force = false) => {
    if (disposed || !started || (!force && !isActive())) {
      return;
    }
    if (framePending) {
      if (!force) {
        return;
      }
      if (frameTimeoutId) {
        window.clearTimeout(frameTimeoutId);
        frameTimeoutId = 0;
        framePending = false;
      } else {
        forcePendingFrame = true;
        return;
      }
    }
    forcePendingFrame = force;
    framePending = true;
    const frameDelay = force
      ? 0
      : Math.max(0, TARGET_FRAME_INTERVAL_MS - (performance.now() - lastRenderedAt));
    if (frameDelay > 1) {
      frameTimeoutId = window.setTimeout(() => {
        frameTimeoutId = 0;
        if (disposed || (!forcePendingFrame && !isActive())) {
          framePending = false;
          return;
        }
        frameId = window.requestAnimationFrame(renderFrame);
      }, frameDelay);
    } else {
      frameId = window.requestAnimationFrame(renderFrame);
    }
  };

  function wake() {
    lastFrameAt = performance.now();
    scheduleFrame(true);
  };

  return {
    markInteraction,
    start: () => {
      if (started) {
        return;
      }
      started = true;
      wake();
    },
    wake,
    dispose: () => {
      disposed = true;
      if (frameTimeoutId) {
        window.clearTimeout(frameTimeoutId);
        frameTimeoutId = 0;
      }
      if (framePending) {
        window.cancelAnimationFrame(frameId);
        framePending = false;
      }
    },
  };
}
