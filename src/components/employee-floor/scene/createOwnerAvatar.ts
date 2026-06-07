import * as THREE from "three";

import {
  avatarAppearanceFingerprint,
  avatarPalette,
  type OwnerAvatarAppearance,
} from "../avatarAppearance";

export type OwnerAvatarPlacement = "office" | "preview";
export type OwnerAvatarPosture = "standing" | "sitting";

export type OwnerAvatarOptions = {
  placement?: OwnerAvatarPlacement;
  posture?: OwnerAvatarPosture;
  name?: string;
  nameplateScale?: number;
};

export function syncOwnerAvatar(
  group: THREE.Group,
  appearance: OwnerAvatarAppearance,
  visible: boolean,
  options: OwnerAvatarOptions | OwnerAvatarPlacement = "office",
): void {
  const normalized = normalizeOwnerAvatarOptions(options);
  const fingerprint = visible
    ? [
        normalized.placement,
        normalized.posture,
        normalized.name.trim(),
        normalized.nameplateScale,
        avatarAppearanceFingerprint(appearance),
      ].join(":")
    : "hidden";
  if (group.userData.avatarFingerprint === fingerprint) {
    group.visible = visible;
    return;
  }

  disposeObjectResources(group);
  group.clear();
  group.userData.avatarFingerprint = fingerprint;
  group.visible = visible;
  if (visible) {
    group.add(createOwnerAvatar(appearance, normalized));
  }
}

export function createOwnerAvatar(
  appearance: OwnerAvatarAppearance,
  options: OwnerAvatarOptions | OwnerAvatarPlacement = "office",
): THREE.Group {
  const normalized = normalizeOwnerAvatarOptions(options);
  const palette = avatarPalette(appearance);
  const sitting = normalized.posture === "sitting";
  const bodyWidth = appearance.bodyShape === "broad" ? 0.72 : appearance.bodyShape === "slim" ? 0.5 : 0.6;
  const bodyHeight = appearance.bodyShape === "slim" ? 0.76 : 0.7;
  const legWidth = appearance.legStyle === "joggers" ? 0.23 : 0.19;
  const mats = {
    skin: mat(palette.skinHex),
    hair: mat(palette.hairHex),
    shirt: mat(palette.shirtHex),
    jacket: mat(palette.jacketHex),
    pants: mat(palette.pantsHex),
    shoes: mat(palette.shoesHex),
    eye: new THREE.MeshBasicMaterial({ color: 0x171412 }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x3f231c }),
  };

  const root = new THREE.Group();
  root.name = "owner-avatar";
  if (normalized.placement === "office") {
    root.position.set(-14.46, 0, 8.38);
    root.rotation.y = -Math.PI * 0.5;
    root.scale.setScalar(1.02);
  } else {
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    root.scale.setScalar(1.18);
  }

  root.add(block("torso", [bodyWidth, bodyHeight, 0.3], mats.shirt, [0, 1.1, 0]));
  root.add(block("jacket-left", [0.17, bodyHeight * 0.96, 0.33], mats.jacket, [-bodyWidth * 0.34, 1.1, -0.01]));
  root.add(block("jacket-right", [0.17, bodyHeight * 0.96, 0.33], mats.jacket, [bodyWidth * 0.34, 1.1, -0.01]));
  root.add(block("neck", [0.18, 0.12, 0.16], mats.skin, [0, 1.5, 0]));
  root.add(block("head", [0.5, 0.48, 0.5], mats.skin, [0, 1.78, -0.01]));

  for (const side of [-1, 1]) {
    const arm = block("arm", [0.18, sitting ? 0.56 : 0.64, 0.18], mats.jacket, [side * (bodyWidth * 0.55), sitting ? 1.04 : 1.05, sitting ? -0.06 : 0]);
    if (sitting) {
      arm.rotation.x = Math.PI * 0.24;
      arm.rotation.z = side * 0.12;
    }
    root.add(arm);

    const hand = block("hand", [0.16, 0.16, 0.16], mats.skin, [side * (bodyWidth * 0.55), sitting ? 0.72 : 0.64, sitting ? -0.19 : -0.02]);
    root.add(hand);

    const leg = block("leg", [legWidth, sitting ? 0.52 : 0.66, 0.22], mats.pants, [side * 0.15, sitting ? 0.42 : 0.48, sitting ? -0.16 : 0]);
    if (sitting) {
      leg.rotation.x = Math.PI * 0.42;
    }
    root.add(leg);
    const shoeDepth = appearance.legStyle === "boots" ? 0.42 : 0.34;
    const shoeHeight = appearance.legStyle === "boots" ? 0.18 : 0.12;
    const shoe = block("shoe", [legWidth + 0.07, shoeHeight, shoeDepth], mats.shoes, [side * 0.15, sitting ? 0.16 : 0.12, sitting ? -0.46 : -0.05]);
    if (sitting) {
      shoe.rotation.x = Math.PI * 0.08;
    }
    root.add(shoe);
  }

  addFace(root, appearance, mats);
  addHair(root, appearance, mats);
  addNameplate(root, normalized.name, normalized.placement, normalized.nameplateScale);
  return root;
}

function normalizeOwnerAvatarOptions(
  options: OwnerAvatarOptions | OwnerAvatarPlacement,
): Required<OwnerAvatarOptions> {
  if (typeof options === "string") {
    return {
      placement: options,
      posture: "standing",
      name: "You",
      nameplateScale: 1,
    };
  }
  return {
    placement: options.placement ?? "office",
    posture: options.posture ?? "standing",
    name: options.name ?? "You",
    nameplateScale: normalizeNameplateScale(options.nameplateScale ?? 1),
  };
}

function addFace(
  root: THREE.Group,
  appearance: OwnerAvatarAppearance,
  mats: Record<string, THREE.Material>,
): void {
  const browY = appearance.faceStyle === "focused" || appearance.faceStyle === "bold" ? 1.89 : 1.87;
  for (const side of [-1, 1]) {
    const eye = block("eye", [0.068, 0.062, 0.02], mats.eye, [side * 0.105, 1.81, -0.286]);
    root.add(eye);
    if (appearance.faceStyle === "focused" || appearance.faceStyle === "bold") {
      const brow = block("brow", [0.13, 0.028, 0.02], mats.hair, [side * 0.105, browY, -0.292]);
      brow.rotation.z = side * (appearance.faceStyle === "bold" ? 0.18 : 0.1);
      root.add(brow);
    }
  }

  const smile = appearance.faceStyle === "smile";
  const mouth = block("mouth", [smile ? 0.18 : 0.15, smile ? 0.034 : 0.026, 0.02], mats.mouth, [0, 1.65, -0.288]);
  if (smile) mouth.rotation.z = 0.04;
  root.add(mouth);
}

function addHair(
  root: THREE.Group,
  appearance: OwnerAvatarAppearance,
  mats: Record<string, THREE.Material>,
): void {
  root.add(block("hair-cap", [0.54, 0.13, 0.54], mats.hair, [0, 2.03, -0.01]));
  root.add(block("hair-front", [0.52, 0.14, 0.1], mats.hair, [0, 1.94, -0.275]));
  if (appearance.hairStyle === "bob") {
    root.add(block("bob-left", [0.16, 0.42, 0.18], mats.hair, [-0.31, 1.76, -0.01]));
    root.add(block("bob-right", [0.16, 0.42, 0.18], mats.hair, [0.31, 1.76, -0.01]));
  } else if (appearance.hairStyle === "long") {
    root.add(block("long-back", [0.52, 0.58, 0.14], mats.hair, [0, 1.66, 0.26]));
    root.add(block("long-left", [0.14, 0.6, 0.18], mats.hair, [-0.31, 1.64, 0]));
    root.add(block("long-right", [0.14, 0.6, 0.18], mats.hair, [0.31, 1.64, 0]));
  } else if (appearance.hairStyle === "curls") {
    for (let index = 0; index < 7; index += 1) {
      root.add(block("curl", [0.12, 0.12, 0.1], mats.hair, [(-0.24 + index * 0.08), 1.94 + Math.sin(index) * 0.03, -0.29]));
    }
  } else if (appearance.hairStyle === "pony") {
    root.add(block("pony", [0.2, 0.48, 0.2], mats.hair, [0, 1.62, 0.38]));
  } else {
    root.add(block("crop-top", [0.34, 0.1, 0.12], mats.hair, [0.05, 2.08, -0.12]));
  }
}

function addNameplate(
  root: THREE.Group,
  name: string,
  placement: OwnerAvatarPlacement,
  nameplateScale: number,
): void {
  const label = name.trim();
  if (!label || typeof document === "undefined") {
    return;
  }

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createNameplateTexture(label),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.name = "owner-avatar-nameplate";
  sprite.position.set(0, placement === "office" ? 2.58 : 2.34, 0);
  sprite.scale.set(
    (placement === "office" ? 2.42 : 1.86) * nameplateScale,
    (placement === "office" ? 0.58 : 0.44) * nameplateScale,
    1,
  );
  sprite.renderOrder = 100;
  sprite.frustumCulled = false;
  root.add(sprite);
}

function createNameplateTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const displayName = fitName(name, 22);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(8, 12, 14, 0.84)";
    roundedRect(ctx, 42, 36, canvas.width - 84, 116, 34);
    ctx.fill();
    ctx.strokeStyle = "rgba(243, 239, 229, 0.28)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = "900 76px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    shrinkFontToFit(ctx, displayName, canvas.width - 148, 76);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.82)";
    ctx.strokeText(displayName, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = "#fff8e8";
    ctx.fillText(displayName, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
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
    context.font = `900 ${size}px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
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

function block(
  name: string,
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.66,
    metalness: 0.02,
  });
}

export function disposeOwnerAvatarResources(object: THREE.Object3D): void {
  disposeObjectResources(object);
}

function disposeObjectResources(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  object.traverse((item) => {
    const renderable = item as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    const sprite = item as THREE.Sprite;
    if (sprite.isSprite && sprite.material instanceof THREE.SpriteMaterial) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
      return;
    }
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
