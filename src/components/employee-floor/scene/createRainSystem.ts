import * as THREE from "three";

export type RainSystem = {
  group: THREE.Group;
  update: (delta: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

type RainDrop = {
  x: number;
  y: number;
  z: number;
  speed: number;
  length: number;
  windX: number;
  windZ: number;
  zone: RainZone;
};

type GlassStreak = {
  x: number;
  y: number;
  z: number;
  length: number;
  speed: number;
  sideOffsetX: number;
  sideOffsetZ: number;
};

type RainZone = "front" | "back" | "left" | "right";

const DROP_COUNT = 1_800;
const GLASS_STREAK_COUNT = 180;
const MIN_Y = -38;
const MAX_Y = 10.8;
const BUILDING_MIN_X = -17.6;
const BUILDING_MAX_X = 17.6;
const BUILDING_MIN_Z = -12.3;
const BUILDING_MAX_Z = 12.3;
const EXTERIOR_MARGIN = 0.85;
const PRECIP_MIN_X = -58;
const PRECIP_MAX_X = 58;
const PRECIP_MIN_Z = -46;
const PRECIP_MAX_Z = 46;

export function createRainSystem(): RainSystem {
  const group = new THREE.Group();
  group.name = "office-rain-system";

  const drops = Array.from({ length: DROP_COUNT }, (_, index) => createDrop(index));
  const glassStreaks = Array.from({ length: GLASS_STREAK_COUNT }, (_, index) =>
    createGlassStreak(index),
  );
  const positions = new Float32Array(DROP_COUNT * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const glassPositions = new Float32Array(GLASS_STREAK_COUNT * 2 * 3);
  const glassGeometry = new THREE.BufferGeometry();
  glassGeometry.setAttribute("position", new THREE.BufferAttribute(glassPositions, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xd0edf2,
    transparent: true,
    opacity: 0.38,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  material.toneMapped = false;

  const rain = new THREE.LineSegments(geometry, material);
  rain.name = "office-rain-streaks";
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  group.add(rain);
  writeDrops(drops, positions);

  const glassMaterial = new THREE.LineBasicMaterial({
    color: 0xe3f8fb,
    transparent: true,
    opacity: 0.22,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  glassMaterial.toneMapped = false;
  const glassRain = new THREE.LineSegments(glassGeometry, glassMaterial);
  glassRain.name = "office-rain-glass-runoff";
  glassRain.frustumCulled = false;
  glassRain.renderOrder = 5;
  group.add(glassRain);
  writeGlassStreaks(glassStreaks, glassPositions);

  return {
    group,
    update: (delta, reducedMotion) => {
      if (reducedMotion) return;
      for (const drop of drops) {
        drop.y -= drop.speed * delta;
        drop.x += drop.windX * delta;
        drop.z += drop.windZ * delta;
        if (drop.y < MIN_Y || insideBuildingFootprint(drop.x, drop.z)) {
          resetDrop(drop);
        }
      }
      for (const streak of glassStreaks) {
        streak.y -= streak.speed * delta;
        if (streak.y < MIN_Y) {
          resetGlassStreak(streak);
        }
      }
      writeDrops(drops, positions);
      writeGlassStreaks(glassStreaks, glassPositions);
      geometry.attributes.position.needsUpdate = true;
      glassGeometry.attributes.position.needsUpdate = true;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      glassGeometry.dispose();
      glassMaterial.dispose();
    },
  };
}

function createDrop(index: number): RainDrop {
  const drop = {
    x: 0,
    y: MAX_Y,
    z: 0,
    speed: 11,
    length: 0.65,
    windX: -0.18,
    windZ: 0.08,
    zone: zoneForSeed(index),
  };
  resetDrop(drop, index);
  drop.y = MIN_Y + seeded(index, 2) * (MAX_Y - MIN_Y);
  return drop;
}

function resetDrop(drop: RainDrop, index = Math.floor(Math.random() * 10_000)): void {
  drop.zone = zoneForSeed(index);
  const xRand = seeded(index, 23);
  const zRand = seeded(index, 37);

  switch (drop.zone) {
    case "front":
      drop.x = PRECIP_MIN_X + xRand * (PRECIP_MAX_X - PRECIP_MIN_X);
      drop.z = BUILDING_MAX_Z + EXTERIOR_MARGIN + zRand * (PRECIP_MAX_Z - BUILDING_MAX_Z - EXTERIOR_MARGIN);
      break;
    case "back":
      drop.x = PRECIP_MIN_X + xRand * (PRECIP_MAX_X - PRECIP_MIN_X);
      drop.z = PRECIP_MIN_Z + zRand * (BUILDING_MIN_Z - EXTERIOR_MARGIN - PRECIP_MIN_Z);
      break;
    case "left":
      drop.x = PRECIP_MIN_X + xRand * (BUILDING_MIN_X - EXTERIOR_MARGIN - PRECIP_MIN_X);
      drop.z = PRECIP_MIN_Z + zRand * (PRECIP_MAX_Z - PRECIP_MIN_Z);
      break;
    case "right":
      drop.x = BUILDING_MAX_X + EXTERIOR_MARGIN + xRand * (PRECIP_MAX_X - BUILDING_MAX_X - EXTERIOR_MARGIN);
      drop.z = PRECIP_MIN_Z + zRand * (PRECIP_MAX_Z - PRECIP_MIN_Z);
      break;
  }

  drop.y = MAX_Y + seeded(index, 41) * 7;
  drop.speed = 10.5 + seeded(index, 53) * 9.5;
  drop.length = 0.42 + seeded(index, 67) * 0.62;
  drop.windX = -0.55 - seeded(index, 79) * 0.42;
  drop.windZ = 0.08 + seeded(index, 83) * 0.24;
}

function writeDrops(drops: RainDrop[], positions: Float32Array): void {
  drops.forEach((drop, index) => {
    const offset = index * 6;
    positions[offset] = drop.x;
    positions[offset + 1] = drop.y;
    positions[offset + 2] = drop.z;
    positions[offset + 3] = drop.x + drop.windX * 0.28;
    positions[offset + 4] = drop.y - drop.length;
    positions[offset + 5] = drop.z + drop.windZ * 0.28;
  });
}

function createGlassStreak(index: number): GlassStreak {
  const streak = {
    x: 0,
    y: 0,
    z: 0,
    length: 0.72,
    speed: 1.8,
    sideOffsetX: 0,
    sideOffsetZ: 0,
  };
  resetGlassStreak(streak, index);
  streak.y = MIN_Y + seeded(index, 101) * (MAX_Y - MIN_Y);
  return streak;
}

function resetGlassStreak(
  streak: GlassStreak,
  index = Math.floor(Math.random() * 10_000),
): void {
  const zone = zoneForSeed(index + 911);
  const xRand = seeded(index, 113);
  const zRand = seeded(index, 127);

  streak.y = MAX_Y + seeded(index, 131) * 5.5;
  streak.length = 0.45 + seeded(index, 137) * 0.78;
  streak.speed = 1.25 + seeded(index, 149) * 2.2;
  streak.sideOffsetX = 0;
  streak.sideOffsetZ = 0;

  switch (zone) {
    case "front":
      streak.x = -16.2 + xRand * 32.4;
      streak.z = BUILDING_MAX_Z + 0.62;
      streak.sideOffsetX = -0.07;
      break;
    case "back":
      streak.x = -16.2 + xRand * 32.4;
      streak.z = BUILDING_MIN_Z - 0.62;
      streak.sideOffsetX = 0.07;
      break;
    case "left":
      streak.x = BUILDING_MIN_X - 0.56;
      streak.z = BUILDING_MIN_Z + zRand * (BUILDING_MAX_Z - BUILDING_MIN_Z);
      streak.sideOffsetZ = 0.07;
      break;
    case "right":
      streak.x = BUILDING_MAX_X + 0.56;
      streak.z = BUILDING_MIN_Z + zRand * (BUILDING_MAX_Z - BUILDING_MIN_Z);
      streak.sideOffsetZ = -0.07;
      break;
  }
}

function writeGlassStreaks(streaks: GlassStreak[], positions: Float32Array): void {
  streaks.forEach((streak, index) => {
    const offset = index * 6;
    positions[offset] = streak.x;
    positions[offset + 1] = streak.y;
    positions[offset + 2] = streak.z;
    positions[offset + 3] = streak.x + streak.sideOffsetX;
    positions[offset + 4] = streak.y - streak.length;
    positions[offset + 5] = streak.z + streak.sideOffsetZ;
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

function zoneForSeed(index: number): RainZone {
  const value = seeded(index, 11);
  if (value < 0.25) return "front";
  if (value < 0.5) return "back";
  if (value < 0.75) return "left";
  return "right";
}

function seeded(index: number, salt: number): number {
  let value = Math.imul(index + 1, 374_761_393) ^ Math.imul(salt + 1, 668_265_263);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}
