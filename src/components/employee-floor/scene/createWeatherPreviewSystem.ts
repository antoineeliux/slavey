import * as THREE from "three";

import { createNightSkySystem } from "./createNightSkySystem";
import { createRainSystem } from "./createRainSystem";
import { createSnowSystem } from "./createSnowSystem";

export type WeatherPreviewSystem = {
  group: THREE.Group;
  applyAtmosphere: (scene: THREE.Scene) => void;
  update: (delta: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

export type WeatherPreviewState = {
  rain: number;
  snow: number;
};

const WEATHER_RAIN_SECONDS = 60;
const WEATHER_SNOW_SECONDS = 60;
const WEATHER_CLEAR_SECONDS = 10 * 60;
const WEATHER_CYCLE_SECONDS =
  WEATHER_RAIN_SECONDS + WEATHER_CLEAR_SECONDS + WEATHER_SNOW_SECONDS + WEATHER_CLEAR_SECONDS;
const WEATHER_TRANSITION_SECONDS = 8;
const WEATHER_PREVIEW_ENABLED = false;

export function createWeatherPreviewSystem(): WeatherPreviewSystem {
  const group = new THREE.Group();
  group.name = "office-weather-preview-system";
  const night = createNightSkySystem();
  const rain = createRainSystem();
  const snow = createSnowSystem();
  let elapsed = 0;
  let activeScene: THREE.Scene | null = null;

  setLayerOpacity(rain.group, 0);
  setLayerOpacity(snow.group, 0);
  group.add(night.group, rain.group, snow.group);

  return {
    group,
    applyAtmosphere: (scene) => {
      activeScene = scene;
      night.applyAtmosphere(scene);
    },
    update: (delta, reducedMotion) => {
      night.update(delta, reducedMotion);
      if (!WEATHER_PREVIEW_ENABLED) {
        return;
      }
      if (!reducedMotion) {
        elapsed += delta;
      }
      const state = weatherPreviewStateForCycle(elapsed % WEATHER_CYCLE_SECONDS);
      applyWeatherAtmosphere(activeScene, state);
      setLayerOpacity(rain.group, state.rain);
      setLayerOpacity(snow.group, state.snow);
      if (state.rain > 0.01) {
        rain.update(delta, reducedMotion);
      }
      if (state.snow > 0.01) {
        snow.update(delta, reducedMotion);
      }
    },
    dispose: () => {
      night.dispose();
      rain.dispose();
      snow.dispose();
    },
  };
}

export function weatherPreviewStateForCycle(cycleSeconds: number): WeatherPreviewState {
  const transition = Math.min(
    WEATHER_TRANSITION_SECONDS,
    WEATHER_RAIN_SECONDS / 2,
    WEATHER_SNOW_SECONDS / 2,
    WEATHER_CLEAR_SECONDS / 2,
  );
  const rainStart = 0;
  const rainEnd = rainStart + WEATHER_RAIN_SECONDS;
  const snowStart = rainEnd + WEATHER_CLEAR_SECONDS;
  const snowEnd = snowStart + WEATHER_SNOW_SECONDS;

  if (cycleSeconds < rainEnd) {
    return { rain: weatherEventOpacity(cycleSeconds, rainStart, rainEnd, transition), snow: 0 };
  }

  if (cycleSeconds < snowStart) {
    return { rain: 0, snow: 0 };
  }

  if (cycleSeconds < snowEnd) {
    return { rain: 0, snow: weatherEventOpacity(cycleSeconds, snowStart, snowEnd, transition) };
  }

  return { rain: 0, snow: 0 };
}

function applyWeatherAtmosphere(
  scene: THREE.Scene | null,
  state: { rain: number; snow: number },
): void {
  if (!scene) return;
  const sky = new THREE.Color(0x070d19);
  const weatherColor = new THREE.Color(state.rain >= state.snow ? 0x0a101a : 0x101827);
  const amount = THREE.MathUtils.clamp(state.rain * 0.52 + state.snow * 0.36, 0, 0.66);
  sky.lerp(weatherColor, amount);
  scene.background = sky;
  const near = THREE.MathUtils.lerp(72, 52, Math.max(state.rain, state.snow));
  const far = THREE.MathUtils.lerp(220, 155, Math.max(state.rain, state.snow));
  scene.fog = new THREE.Fog(sky, near, far);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function weatherEventOpacity(
  cycleSeconds: number,
  start: number,
  end: number,
  transition: number,
): number {
  if (transition <= 0) return 1;
  if (cycleSeconds < start + transition) {
    return smoothstep(start, start + transition, cycleSeconds);
  }
  if (cycleSeconds > end - transition) {
    return 1 - smoothstep(end - transition, end, cycleSeconds);
  }
  return 1;
}

function setLayerOpacity(root: THREE.Object3D, scale: number): void {
  root.visible = scale > 0.01;
  root.traverse((object) => {
    const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      entry.transparent = true;
      if (entry.userData.previewBaseOpacity === undefined) {
        entry.userData.previewBaseOpacity = entry.opacity;
      }
      entry.opacity = (entry.userData.previewBaseOpacity as number) * scale;
    }
  });
}
