import * as THREE from "three";

import type { EmployeeActor } from "./characterTypes";

const NAMEPLATE_BASE_SCALE = { x: 2.55, y: 0.62, z: 1 };

export function createNameplate(name: string): THREE.Sprite {
  const texture = createNameplateTexture(name);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "employee-nameplate";
  sprite.position.set(0, -0.6, 0);
  sprite.scale.set(NAMEPLATE_BASE_SCALE.x, NAMEPLATE_BASE_SCALE.y, NAMEPLATE_BASE_SCALE.z);
  sprite.renderOrder = 20;
  sprite.userData.nameplateText = name;
  return sprite;
}

export function updateNameplateScale(actor: EmployeeActor, scale: number): void {
  const normalized = normalizeNameplateScale(scale);
  actor.nameplate.scale.set(
    NAMEPLATE_BASE_SCALE.x * normalized,
    NAMEPLATE_BASE_SCALE.y * normalized,
    NAMEPLATE_BASE_SCALE.z,
  );
}

export function updateNameplate(actor: EmployeeActor, name: string): void {
  if (actor.nameplate.userData.nameplateText === name) return;
  const material = actor.nameplate.material;
  material.map?.dispose();
  material.map = createNameplateTexture(name);
  material.needsUpdate = true;
  actor.nameplate.userData.nameplateText = name;
}

function createNameplateTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const displayName = fitName(name.trim(), 22);
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(8, 12, 14, 0.84)";
  roundedRect(context, 42, 36, canvas.width - 84, 116, 34);
  context.fill();
  context.strokeStyle = "rgba(240, 234, 220, 0.28)";
  context.lineWidth = 4;
  context.stroke();

  context.font = "900 76px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  shrinkFontToFit(context, displayName, canvas.width - 148, 76);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 9;
  context.strokeStyle = "rgba(0, 0, 0, 0.82)";
  context.strokeText(displayName, canvas.width / 2, 96);
  context.fillStyle = "#fff8e8";
  context.fillText(displayName, canvas.width / 2, 96);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function fitName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, Math.max(1, maxLength - 1))}...`;
}

function normalizeNameplateScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(Math.max(scale, 0.7), 2.2) : 1;
}

function shrinkFontToFit(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
): void {
  let size = maxSize;
  while (size > 46) {
    context.font = `900 ${size}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    if (context.measureText(text).width <= maxWidth) {
      return;
    }
    size -= 3;
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
