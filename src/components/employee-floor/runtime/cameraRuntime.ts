import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ActorMap } from "../scene/updateActors";

export type FocusRequest = { employeeId: string; version: number };

export type FocusMotion = {
  version: number;
  employeeId: string;
  startedAt: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
};

export type IdleCameraMotion = {
  startedAt: number;
  target: THREE.Vector3;
  spherical: THREE.Spherical;
};

export type OrbitBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export const OFFICE_TARGET_BOUNDS: OrbitBounds = {
  minX: -12.4,
  maxX: 12.4,
  minY: 0.58,
  maxY: 2.35,
  minZ: -8.9,
  maxZ: 8.95,
};

export function applyIdleCameraMotion(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  elapsed: number,
  lastInteractionAt: number,
  reducedMotion: boolean,
  setIdleMotion: (value: IdleCameraMotion | null) => void,
  idleMotion: IdleCameraMotion | null,
): void {
  if (reducedMotion || elapsed - lastInteractionAt < 2.4) {
    setIdleMotion(null);
    return;
  }

  let motion = idleMotion;
  if (!motion) {
    const offset = camera.position.clone().sub(controls.target);
    motion = {
      startedAt: elapsed,
      target: controls.target.clone(),
      spherical: new THREE.Spherical().setFromVector3(offset),
    };
    setIdleMotion(motion);
  }

  const time = elapsed - motion.startedAt;
  const yaw = Math.sin(time * 0.18) * 0.055;
  const targetSway = Math.sin(time * 0.14) * 0.16;
  const spherical = motion.spherical.clone();
  spherical.theta += yaw;
  const nextTarget = motion.target.clone();
  nextTarget.x += targetSway;
  const nextPosition = new THREE.Vector3().setFromSpherical(spherical).add(nextTarget);
  camera.position.copy(nextPosition);
  controls.target.copy(nextTarget);
}

export function configureOrbitDistanceLimits(
  controls: OrbitControls,
  width: number,
  height: number,
  overviewDistance: number,
): void {
  const aspect = Math.max(1, width) / Math.max(1, height);
  controls.minDistance = aspect < 0.8 ? 16 : 7.2;
  controls.maxDistance = Math.max(controls.minDistance + 1, overviewDistance * 1.04);
}

export function constrainOrbitView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  bounds: OrbitBounds,
): void {
  const previousTarget = controls.target.clone();
  controls.target.set(
    THREE.MathUtils.clamp(controls.target.x, bounds.minX, bounds.maxX),
    THREE.MathUtils.clamp(controls.target.y, bounds.minY, bounds.maxY),
    THREE.MathUtils.clamp(controls.target.z, bounds.minZ, bounds.maxZ),
  );
  camera.position.add(controls.target.clone().sub(previousTarget));

  const nextOffset = camera.position.clone().sub(controls.target);
  const distance = nextOffset.length();
  if (distance <= 0.001) {
    return;
  }

  const clampedDistance = THREE.MathUtils.clamp(
    distance,
    controls.minDistance,
    controls.maxDistance,
  );
  if (Math.abs(clampedDistance - distance) > 0.001) {
    camera.position.copy(controls.target).add(nextOffset.setLength(clampedDistance));
  }
}

export function updateSelectionFocus({
  camera,
  controls,
  actors,
  elapsed,
  reducedMotion,
  focusRequest,
  focusMotion,
}: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  actors: ActorMap;
  elapsed: number;
  reducedMotion: boolean;
  focusRequest: FocusRequest | null;
  focusMotion: FocusMotion | null;
}): { motion: FocusMotion | null; completed: boolean; request: FocusRequest | null } {
  if (!focusRequest) {
    return { motion: null, completed: false, request: null };
  }

  let motion = focusMotion;
  if (!motion || motion.version !== focusRequest.version) {
    const actor = actors.get(focusRequest.employeeId);
    if (!actor) {
      return { motion: null, completed: true, request: focusRequest };
    }

    const actorPosition = actor.root.position.clone();
    const toTarget = new THREE.Vector3(actorPosition.x - 0.28, 0.92, actorPosition.z + 0.08);
    const currentOffset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(currentOffset.length(), 10.4, 14.2);
    const direction = currentOffset.lengthSq() > 0
      ? currentOffset.normalize()
      : new THREE.Vector3(0.58, 0.42, 0.7).normalize();
    direction.y = THREE.MathUtils.clamp(direction.y, 0.36, 0.62);
    direction.normalize();
    const toPosition = toTarget.clone().add(direction.multiplyScalar(distance));

    motion = {
      version: focusRequest.version,
      employeeId: focusRequest.employeeId,
      startedAt: elapsed,
      duration: reducedMotion ? 0.01 : 0.9,
      fromTarget: controls.target.clone(),
      toTarget,
      fromPosition: camera.position.clone(),
      toPosition,
    };
  }

  const progress = THREE.MathUtils.clamp(
    (elapsed - motion.startedAt) / Math.max(0.01, motion.duration),
    0,
    1,
  );
  const eased = easeOutCubic(progress);
  camera.position.copy(motion.fromPosition).lerp(motion.toPosition, eased);
  controls.target.copy(motion.fromTarget).lerp(motion.toTarget, eased);

  if (progress >= 1) {
    return { motion: null, completed: true, request: focusRequest };
  }
  return { motion, completed: false, request: focusRequest };
}

export function applySelectionFollow({
  camera,
  controls,
  actors,
  employeeId,
  delta,
  followOffset,
}: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  actors: ActorMap;
  employeeId: string;
  delta: number;
  followOffset: THREE.Vector3 | null;
}): boolean {
  const actor = actors.get(employeeId);
  if (!actor || !followOffset) {
    return false;
  }

  const actorPosition = actor.root.position;
  const target = new THREE.Vector3(actorPosition.x - 0.28, 0.92, actorPosition.z + 0.08);
  const position = target.clone().add(followOffset);
  const smoothing = 1 - Math.exp(-delta * 4.8);
  controls.target.lerp(target, smoothing);
  camera.position.lerp(position, smoothing);
  return true;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
