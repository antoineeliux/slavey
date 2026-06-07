import * as THREE from "three";

import type { DeskObject } from "./createDesk";
import { createOffice } from "./createOffice";
import {
  createWeatherPreviewSystem,
  type WeatherPreviewSystem,
} from "./createWeatherPreviewSystem";
import {
  applyMaterialsTheme,
  createMaterials,
  disposeMaterials,
  type FloorMaterials,
} from "./materials";
import {
  DEFAULT_OFFICE_COLOR_THEME,
  type OfficeColorTheme,
} from "../officeColorTheme";

export const OVERVIEW_CAMERA_TARGET = new THREE.Vector3(0.1, 0.95, 0.35);
const OVERVIEW_CAMERA_OFFSET = new THREE.Vector3(15.7, 7.95, 23.15);

export type FloorScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  officeGroup: THREE.Group;
  deskGroup: THREE.Group;
  actorGroup: THREE.Group;
  ownerAvatarGroup: THREE.Group;
  weather: WeatherPreviewSystem;
  desks: Map<number, DeskObject>;
  materials: FloorMaterials;
  resize: (width: number, height: number) => void;
  applyTheme: (theme: OfficeColorTheme) => void;
  dispose: () => void;
};

type SceneLights = {
  ambient: THREE.AmbientLight;
  hemisphere: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  rearFill: THREE.DirectionalLight;
};

type ScenePalette = {
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ambientColor: number;
  ambientIntensity: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  keyColor: number;
  keyIntensity: number;
  rimColor: number;
  rimIntensity: number;
  rearFillColor: number;
  rearFillIntensity: number;
};

const SCENE_PALETTES: Record<OfficeColorTheme, ScenePalette> = {
  "light-warm": {
    background: 0x17110c,
    fog: 0x17110c,
    fogNear: 46,
    fogFar: 104,
    ambientColor: 0xffedd2,
    ambientIntensity: 0.26,
    hemisphereSky: 0xfff3d5,
    hemisphereGround: 0x5f4a32,
    hemisphereIntensity: 0.98,
    keyColor: 0xffdfaa,
    keyIntensity: 0.46,
    rimColor: 0xf5c98e,
    rimIntensity: 0.34,
    rearFillColor: 0xffecd0,
    rearFillIntensity: 0.42,
  },
  "dark-ide": {
    background: 0x0b0f14,
    fog: 0x0b0f14,
    fogNear: 46,
    fogFar: 104,
    ambientColor: 0x8fb8d8,
    ambientIntensity: 0.34,
    hemisphereSky: 0xc8d7ff,
    hemisphereGround: 0x263342,
    hemisphereIntensity: 0.92,
    keyColor: 0xd8e7ff,
    keyIntensity: 0.38,
    rimColor: 0x88c7ff,
    rimIntensity: 0.42,
    rearFillColor: 0xaed7ff,
    rearFillIntensity: 0.58,
  },
};

export function createScene(
  width: number,
  height: number,
  theme: OfficeColorTheme = DEFAULT_OFFICE_COLOR_THEME,
): FloorScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_PALETTES[theme].background);
  scene.fog = new THREE.Fog(
    SCENE_PALETTES[theme].fog,
    SCENE_PALETTES[theme].fogNear,
    SCENE_PALETTES[theme].fogFar,
  );

  const camera = new THREE.PerspectiveCamera(43, width / Math.max(1, height), 0.1, 260);
  camera.position.copy(overviewCameraPosition(width, height));
  camera.lookAt(OVERVIEW_CAMERA_TARGET);

  const materials = createMaterials(theme);
  const officeGroup = createOffice(materials);
  const deskGroup = new THREE.Group();
  deskGroup.name = "employee-floor-desks";
  const actorGroup = new THREE.Group();
  actorGroup.name = "employee-floor-actors";
  const ownerAvatarGroup = new THREE.Group();
  ownerAvatarGroup.name = "employee-floor-owner-avatar";
  const weather = createWeatherPreviewSystem();
  weather.applyAtmosphere(scene);

  const ambient = new THREE.AmbientLight();
  scene.add(ambient);

  const hemisphere = new THREE.HemisphereLight();
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight();
  key.position.set(-7, 7, 6);
  key.castShadow = false;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  scene.add(key);

  const rim = new THREE.DirectionalLight();
  rim.position.set(5, 3, -4);
  scene.add(rim);

  const rearFill = new THREE.DirectionalLight();
  rearFill.position.set(-4, 6, -12);
  rearFill.castShadow = false;
  scene.add(rearFill);

  const lights = { ambient, hemisphere, key, rim, rearFill };
  applyScenePalette(scene, lights, theme);

  scene.add(officeGroup, deskGroup, actorGroup, ownerAvatarGroup, weather.group);

  const floorScene: FloorScene = {
    scene,
    camera,
    officeGroup,
    deskGroup,
    actorGroup,
    ownerAvatarGroup,
    weather,
    desks: new Map(),
    materials,
    resize: (nextWidth, nextHeight) => resizeCamera(camera, nextWidth, nextHeight),
    applyTheme: (nextTheme) => {
      applyMaterialsTheme(materials, nextTheme);
      applyScenePalette(scene, lights, nextTheme);
    },
    dispose: () => {
      disposeObjectResources(officeGroup);
      disposeObjectResources(ownerAvatarGroup);
      weather.dispose();
      disposeMaterials(materials);
    },
  };

  floorScene.resize(width, height);
  return floorScene;
}

function applyScenePalette(
  scene: THREE.Scene,
  lights: SceneLights,
  theme: OfficeColorTheme,
): void {
  const palette = SCENE_PALETTES[theme];
  scene.background = new THREE.Color(palette.background);
  scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);
  lights.ambient.color.setHex(palette.ambientColor);
  lights.ambient.intensity = palette.ambientIntensity;
  lights.hemisphere.color.setHex(palette.hemisphereSky);
  lights.hemisphere.groundColor.setHex(palette.hemisphereGround);
  lights.hemisphere.intensity = palette.hemisphereIntensity;
  lights.key.color.setHex(palette.keyColor);
  lights.key.intensity = palette.keyIntensity;
  lights.rim.color.setHex(palette.rimColor);
  lights.rim.intensity = palette.rimIntensity;
  lights.rearFill.color.setHex(palette.rearFillColor);
  lights.rearFill.intensity = palette.rearFillIntensity;
}

function resizeCamera(camera: THREE.PerspectiveCamera, width: number, height: number): void {
  camera.aspect = Math.max(1, width) / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function overviewCameraPosition(width: number, height: number): THREE.Vector3 {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const distanceScale = aspect < 0.8 ? 2.2 : aspect < 1.15 ? 1.25 : 1;
  return OVERVIEW_CAMERA_TARGET.clone().add(
    OVERVIEW_CAMERA_OFFSET.clone().multiplyScalar(distanceScale),
  );
}

function disposeObjectResources(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  object.traverse((item) => {
    const renderable = item as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => materials.add(entry));
    } else if (material) {
      materials.add(material);
    }
  });
  materials.forEach((material) => material.dispose());
}
