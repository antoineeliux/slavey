import * as THREE from "three";

export type NightSkySystem = {
  group: THREE.Group;
  applyAtmosphere: (scene: THREE.Scene) => void;
  update: (delta: number, reducedMotion: boolean) => void;
  dispose: () => void;
};

const NIGHT_SKY = 0x070d19;
const NIGHT_FOG = 0x09111f;

export function createNightSkySystem(): NightSkySystem {
  const group = new THREE.Group();
  group.name = "office-night-sky-system";

  const moonMaterial = new THREE.SpriteMaterial({
    map: createMoonTexture(),
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  moonMaterial.toneMapped = false;
  const moon = new THREE.Sprite(moonMaterial);
  moon.name = "night-sky-moon";
  moon.position.set(22, 18, -72);
  moon.scale.set(11.5, 11.5, 1);
  group.add(moon);

  const moonlight = new THREE.DirectionalLight(0xa8c3ff, 0.42);
  moonlight.name = "night-sky-moonlight";
  moonlight.position.set(12, 14, -18);
  group.add(moonlight);

  return {
    group,
    applyAtmosphere: (scene) => {
      scene.background = new THREE.Color(NIGHT_SKY);
      scene.fog = new THREE.Fog(NIGHT_FOG, 72, 220);
    },
    update: () => {},
    dispose: () => {
      moonMaterial.map?.dispose();
      moonMaterial.dispose();
    },
  };
}

function createMoonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = "round";
    context.lineCap = "round";

    const crescent = new Path2D();
    crescent.moveTo(83, 15);
    crescent.bezierCurveTo(43, 20, 20, 42, 20, 64);
    crescent.bezierCurveTo(20, 86, 43, 108, 83, 113);
    crescent.bezierCurveTo(60, 95, 49, 79, 49, 64);
    crescent.bezierCurveTo(49, 49, 60, 33, 83, 15);
    crescent.closePath();

    context.fillStyle = "rgba(246, 229, 151, 1)";
    context.fill(crescent);
    context.strokeStyle = "rgba(255, 247, 190, 0.98)";
    context.lineWidth = 3.5;
    context.stroke(crescent);

    context.fillStyle = "rgba(211, 178, 88, 0.38)";
    context.beginPath();
    context.ellipse(40, 55, 4.5, 7.2, 0.35, 0, Math.PI * 2);
    context.ellipse(36, 78, 3.5, 5.8, -0.2, 0, Math.PI * 2);
    context.ellipse(55, 39, 2.8, 4.5, 0.45, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
