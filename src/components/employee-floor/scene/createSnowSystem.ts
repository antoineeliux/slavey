import * as THREE from "three";

export type SnowSystem = {
  group: THREE.Group;
  update: (delta: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

type SnowFlake = {
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  sway: number;
  phase: number;
  zone: SnowZone;
};

type SnowZone = "front" | "back" | "left" | "right";

const FLAKE_COUNT = 1_700;
const MIN_Y = -38;
const MAX_Y = 10.8;
const BUILDING_MIN_X = -17.6;
const BUILDING_MAX_X = 17.6;
const BUILDING_MIN_Z = -12.3;
const BUILDING_MAX_Z = 12.3;
const EXTERIOR_MARGIN = 0.9;
const PRECIP_MIN_X = -58;
const PRECIP_MAX_X = 58;
const PRECIP_MIN_Z = -46;
const PRECIP_MAX_Z = 46;

export function createSnowSystem(): SnowSystem {
  const group = new THREE.Group();
  group.name = "office-snow-system";

  const flakes = Array.from({ length: FLAKE_COUNT }, (_, index) => createFlake(index));
  const positions = new Float32Array(FLAKE_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xf5fbff,
    map: createSnowTexture(),
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.88,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  material.toneMapped = false;

  const snow = new THREE.Points(geometry, material);
  snow.name = "office-snow-flakes";
  snow.frustumCulled = false;
  snow.renderOrder = 4;
  group.add(snow);
  writeFlakes(flakes, positions);

  return {
    group,
    update: (delta, reducedMotion) => {
      if (reducedMotion) return;
      for (const flake of flakes) {
        flake.phase += delta * flake.sway;
        flake.y -= flake.speed * delta;
        flake.x += Math.sin(flake.phase) * flake.drift * delta - 0.09 * delta;
        flake.z += Math.cos(flake.phase * 0.72) * flake.drift * delta * 0.42;
        if (flake.y < MIN_Y || insideBuildingFootprint(flake.x, flake.z)) {
          resetFlake(flake);
        }
      }
      writeFlakes(flakes, positions);
      geometry.attributes.position.needsUpdate = true;
    },
    dispose: () => {
      material.map?.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}

function createFlake(index: number): SnowFlake {
  const flake = {
    x: 0,
    y: MAX_Y,
    z: 0,
    speed: 1.8,
    drift: 0.35,
    sway: 1.0,
    phase: seeded(index, 3) * Math.PI * 2,
    zone: zoneForSeed(index),
  };
  resetFlake(flake, index);
  flake.y = MIN_Y + seeded(index, 5) * (MAX_Y - MIN_Y);
  return flake;
}

function resetFlake(flake: SnowFlake, index = Math.floor(Math.random() * 10_000)): void {
  flake.zone = zoneForSeed(index);
  const xRand = seeded(index, 23);
  const zRand = seeded(index, 37);

  switch (flake.zone) {
    case "front":
      flake.x = PRECIP_MIN_X + xRand * (PRECIP_MAX_X - PRECIP_MIN_X);
      flake.z = BUILDING_MAX_Z + EXTERIOR_MARGIN + zRand * (PRECIP_MAX_Z - BUILDING_MAX_Z - EXTERIOR_MARGIN);
      break;
    case "back":
      flake.x = PRECIP_MIN_X + xRand * (PRECIP_MAX_X - PRECIP_MIN_X);
      flake.z = PRECIP_MIN_Z + zRand * (BUILDING_MIN_Z - EXTERIOR_MARGIN - PRECIP_MIN_Z);
      break;
    case "left":
      flake.x = PRECIP_MIN_X + xRand * (BUILDING_MIN_X - EXTERIOR_MARGIN - PRECIP_MIN_X);
      flake.z = PRECIP_MIN_Z + zRand * (PRECIP_MAX_Z - PRECIP_MIN_Z);
      break;
    case "right":
      flake.x = BUILDING_MAX_X + EXTERIOR_MARGIN + xRand * (PRECIP_MAX_X - BUILDING_MAX_X - EXTERIOR_MARGIN);
      flake.z = PRECIP_MIN_Z + zRand * (PRECIP_MAX_Z - PRECIP_MIN_Z);
      break;
  }

  flake.y = MAX_Y + seeded(index, 41) * 7;
  flake.speed = 0.85 + seeded(index, 53) * 2.1;
  flake.drift = 0.18 + seeded(index, 67) * 0.56;
  flake.sway = 0.5 + seeded(index, 79) * 1.6;
  flake.phase = seeded(index, 83) * Math.PI * 2;
}

function writeFlakes(flakes: SnowFlake[], positions: Float32Array): void {
  flakes.forEach((flake, index) => {
    const offset = index * 3;
    positions[offset] = flake.x;
    positions[offset + 1] = flake.y;
    positions[offset + 2] = flake.z;
  });
}

function insideBuildingFootprint(x: number, z: number): boolean {
  return (
    x > BUILDING_MIN_X &&
    x < BUILDING_MAX_X &&
    z > BUILDING_MIN_Z &&
    z < BUILDING_MAX_Z
  );
}

function zoneForSeed(index: number): SnowZone {
  const value = seeded(index, 11);
  if (value < 0.25) return "front";
  if (value < 0.5) return "back";
  if (value < 0.75) return "left";
  return "right";
}

function createSnowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 28);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    gradient.addColorStop(0.45, "rgba(245, 252, 255, 0.72)");
    gradient.addColorStop(1, "rgba(245, 252, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function seeded(index: number, salt: number): number {
  let value = Math.imul(index + 1, 374_761_393) ^ Math.imul(salt + 1, 668_265_263);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}
