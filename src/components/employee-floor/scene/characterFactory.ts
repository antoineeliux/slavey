import * as THREE from "three";

import type {
  EmployeeFloorPetVariant,
  EmployeeFloorViewModel,
} from "../employeeFloorViewModel";
import { hashUnit } from "./layout";
import type { FloorMaterials } from "./materials";
import { applyCharacterView } from "./characterAppearance";
import { createNameplate } from "./characterNameplate";
import { updatePose } from "./characterPose";
import type { CharacterParts, EmployeeActor, HairStyle } from "./characterTypes";

const skinPalette = [0xd79a73, 0xc98d67, 0xe2ad83, 0xd09a75, 0xd7a67f, 0xefbf95, 0xc89570, 0xe3b28d, 0xd2a17d, 0xf0c794];
const hairPalette = [0x172029, 0x6b452b, 0x211c1b, 0x382820, 0x79512f, 0x5a321f, 0x11181d, 0x8b4f31, 0x2f2d2b, 0xb9893d];
const EMPLOYEE_SHIRT_COLOR = 0xffffff;
const pantsPalette = [0x1d4ed8, 0x047857, 0x7c3aed, 0xbe123c, 0x0f766e, 0x9333ea, 0xea580c, 0x2563eb, 0x15803d, 0x4f46e5];
const hairStyles: HairStyle[] = ["bob", "crop", "long", "buzz", "sweep", "pigtails", "undercut", "lob", "curls", "pony"];

export function createCharacter(
  viewModel: EmployeeFloorViewModel,
  materials: FloorMaterials,
): EmployeeActor {
  if (viewModel.visualKind === "pet") {
    return createPetCharacter(viewModel, materials);
  }

  const root = new THREE.Group();
  root.name = `employee-${viewModel.id}`;
  root.userData.employeeId = viewModel.id;

  const seed = Math.floor(hashUnit(viewModel.id, 11) * 10);
  const height = 0.94 + hashUnit(viewModel.id, 29) * 0.22;
  const width = 0.88 + hashUnit(viewModel.id, 41) * 0.28;
  const skin = skinPalette[seed % skinPalette.length];
  const hair = hairPalette[(seed + 2) % hairPalette.length];
  const shirt = EMPLOYEE_SHIRT_COLOR;
  const pants = pantsPalette[(seed + 4) % pantsPalette.length];
  const accent = new THREE.Color(viewModel.markerColor).getHex();
  const hairStyle = hairStyles[seed % hairStyles.length];

  const mats = {
    skin: mat(skin),
    hair: mat(hair),
    shirt: mat(shirt),
    pants: mat(pants),
    shoe: mat(darken(pants, 0.46)),
    eye: new THREE.MeshBasicMaterial({ color: 0x171412 }),
    mouth: new THREE.MeshBasicMaterial({ color: darken(skin, 0.54) }),
    accent: mat(accent, 0.46, accent),
    phone: mat(0x11191b, 0.44, 0x457d9a),
    cup: mat(0xe3dbc8, 0.58),
  };
  mats.phone.emissiveIntensity = 0.1;

  const parts: CharacterParts = {
    body: block("body", [0.54 * width, 0.68 * height, 0.28], mats.shirt, [0, 1.08 * height, 0]),
    head: block("head", [0.48 * width, 0.48 * height, 0.48 * width], mats.skin, [0, 1.7 * height, -0.01]),
    neck: block("neck", [0.18 * width, 0.12 * height, 0.18 * width], mats.skin, [0, 1.39 * height, 0]),
    leftArm: limb("leftArm", mats.shirt, mats.skin, -1, height, width),
    rightArm: limb("rightArm", mats.shirt, mats.skin, 1, height, width),
    leftLeg: leg("leftLeg", mats.pants, mats.shoe, -1, height, width),
    rightLeg: leg("rightLeg", mats.pants, mats.shoe, 1, height, width),
    phone: block("phone", [0.13 * width, 0.22 * height, 0.035], mats.phone, [0, -0.73 * height, -0.14]),
    cup: handCup(mats.cup, height, width),
  };
  parts.phone.visible = false;
  parts.cup.visible = false;
  parts.rightArm.add(parts.phone, parts.cup);

  root.add(parts.body, parts.head, parts.neck, parts.leftArm, parts.rightArm, parts.leftLeg, parts.rightLeg);
  addFace(root, { height, width }, mats);
  addHair(root, { height, width, hairStyle }, mats);

  const statusRing = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.024, 8, 48), mats.accent);
  statusRing.name = "status-ring";
  statusRing.rotation.x = Math.PI * 0.5;
  statusRing.position.y = 0.035;
  root.add(statusRing);

  const marker = createMarker(accent, height);
  const nameplate = createNameplate(viewModel.name);
  marker.add(nameplate);
  root.add(marker);

  const selectionRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 8, 64), materials.selectionRing.clone());
  selectionRing.rotation.x = Math.PI * 0.5;
  selectionRing.position.y = 0.06;
  root.add(selectionRing);

  const target = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 2.1 * height, 0.7),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  target.userData.employeeId = viewModel.id;

  root.traverse((object) => {
    object.userData.employeeId = viewModel.id;
    if ((object as THREE.Mesh).isMesh) {
      (object as THREE.Mesh).castShadow = true;
      (object as THREE.Mesh).receiveShadow = true;
    }
  });

  const actor: EmployeeActor = {
    id: viewModel.id,
    root,
    target,
    parts,
    marker,
    nameplate,
    statusRing,
    selectionRing,
    viewModel,
    skin,
    hair,
    shirt,
    pants,
    accent,
    hairStyle,
    height,
    width,
    homeRotationY: Math.PI,
    visual: initialActorVisual(),
  };
  applyCharacterView(actor, viewModel, materials);
  updatePose(actor, 0, 0);
  return actor;
}

function createPetCharacter(
  viewModel: EmployeeFloorViewModel,
  materials: FloorMaterials,
): EmployeeActor {
  const root = new THREE.Group();
  root.name = `pet-${viewModel.id}`;
  root.userData.employeeId = viewModel.id;

  const variant = viewModel.petVariant ?? "dog";
  const profile = petProfile(variant, viewModel.id);
  const shape = petShape(variant);
  const accent = new THREE.Color(viewModel.markerColor).getHex();
  const height = shape.height;
  const width = shape.width;
  const bodyMat = mat(profile.body, 0.7, profile.emissive ?? 0x000000);
  const secondaryMat = mat(profile.secondary, 0.74);
  const darkMat = mat(profile.dark, 0.76);
  const accentMat = mat(accent, 0.46, accent);
  const eyeMat = new THREE.MeshBasicMaterial({ color: profile.eye });
  accentMat.emissiveIntensity = 0.16;

  const parts: CharacterParts = {
    body: block("pet-body", shape.bodySize, bodyMat, shape.bodyPosition),
    head: block("pet-head", shape.headSize, bodyMat, shape.headPosition),
    neck: block("pet-neck", shape.neckSize, bodyMat, shape.neckPosition),
    leftArm: petLeg("front-left-leg", secondaryMat, -1, shape.frontLegZ, shape),
    rightArm: petLeg("front-right-leg", secondaryMat, 1, shape.frontLegZ, shape),
    leftLeg: petLeg("back-left-leg", secondaryMat, -1, shape.backLegZ, shape),
    rightLeg: petLeg("back-right-leg", secondaryMat, 1, shape.backLegZ, shape),
    phone: block("pet-phone-placeholder", [0.01, 0.01, 0.01], darkMat, [0, 0, 0]),
    cup: block("pet-cup-placeholder", [0.01, 0.01, 0.01], darkMat, [0, 0, 0]),
  };
  parts.phone.visible = false;
  parts.cup.visible = false;

  root.add(parts.body, parts.head, parts.neck, parts.leftArm, parts.rightArm, parts.leftLeg, parts.rightLeg);
  addPetFace(root, variant, eyeMat, darkMat);
  addPetVariantDetails(root, parts, variant, { body: bodyMat, secondary: secondaryMat, dark: darkMat, accent: accentMat });

  const statusRing = new THREE.Mesh(new THREE.TorusGeometry(shape.statusRingRadius, 0.018, 8, 40), accentMat);
  statusRing.name = "status-ring";
  statusRing.rotation.x = Math.PI * 0.5;
  statusRing.position.y = 0.025;
  root.add(statusRing);

  const marker = createMarker(accent, height);
  const nameplate = createNameplate(viewModel.name);
  marker.add(nameplate);
  root.add(marker);

  const selectionRing = new THREE.Mesh(new THREE.TorusGeometry(shape.selectionRingRadius, 0.026, 8, 48), materials.selectionRing.clone());
  selectionRing.rotation.x = Math.PI * 0.5;
  selectionRing.position.y = 0.045;
  root.add(selectionRing);

  const target = new THREE.Mesh(
    new THREE.BoxGeometry(...shape.targetSize),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  target.userData.employeeId = viewModel.id;

  root.traverse((object) => {
    object.userData.employeeId = viewModel.id;
    if ((object as THREE.Mesh).isMesh) {
      (object as THREE.Mesh).castShadow = true;
      (object as THREE.Mesh).receiveShadow = true;
    }
  });

  const actor: EmployeeActor = {
    id: viewModel.id,
    root,
    target,
    parts,
    marker,
    nameplate,
    statusRing,
    selectionRing,
    viewModel,
    skin: profile.body,
    hair: profile.secondary,
    shirt: profile.body,
    pants: profile.secondary,
    accent,
    hairStyle: "buzz",
    height,
    width,
    homeRotationY: Math.PI,
    visual: initialActorVisual(),
  };
  applyCharacterView(actor, viewModel, materials);
  updatePose(actor, 0, 0);
  return actor;
}

function initialActorVisual(): EmployeeActor["visual"] {
  return {
    posture: "standing",
    location: "desk",
    activity: "none",
    desk: new THREE.Vector3(),
    cafeteria: new THREE.Vector3(),
    standby: new THREE.Vector3(),
    executive: new THREE.Vector3(),
    doneRoom: new THREE.Vector3(),
    officeA: new THREE.Vector3(),
    officeB: new THREE.Vector3(),
    officeTarget: new THREE.Vector3(),
    cafeteriaTarget: new THREE.Vector3(),
    standbyTarget: new THREE.Vector3(),
    doneRoomTarget: new THREE.Vector3(),
    roamIndex: 0,
    talkUntil: 0,
    socialIntent: "roaming",
    socialLookAt: null,
    action: null,
    heldProp: "none",
    path: [],
    pathDestinationKey: null,
    lastPosition: new THREE.Vector3(),
    lastMovedAt: 0,
    repathAt: 0,
    stuckCount: 0,
  };
}

function petProfile(
  variant: EmployeeFloorPetVariant,
  id: string,
): { body: number; secondary: number; dark: number; eye: number; emissive?: number } {
  if (variant === "robot") {
    return {
      body: 0xb8c3cc,
      secondary: 0x687586,
      dark: 0x27313a,
      eye: 0x75d7ff,
      emissive: 0x1b5b7c,
    };
  }

  if (variant === "cat") {
    const gray = hashUnit(id, 101) > 0.5;
    return {
      body: gray ? 0x8f9aa3 : 0xc6a177,
      secondary: gray ? 0x5b646b : 0x7a5235,
      dark: 0x1c2428,
      eye: 0x202820,
    };
  }

  const warm = hashUnit(id, 103) > 0.5;
  return {
    body: warm ? 0xa86f45 : 0xd2b07a,
    secondary: warm ? 0x6f432c : 0x8b6840,
    dark: 0x211813,
    eye: 0x171412,
  };
}

type PetShape = {
  height: number;
  width: number;
  bodySize: [number, number, number];
  bodyPosition: [number, number, number];
  headSize: [number, number, number];
  headPosition: [number, number, number];
  neckSize: [number, number, number];
  neckPosition: [number, number, number];
  legSize: [number, number, number];
  legX: number;
  legY: number;
  frontLegZ: number;
  backLegZ: number;
  statusRingRadius: number;
  selectionRingRadius: number;
  targetSize: [number, number, number];
};

function petShape(variant: EmployeeFloorPetVariant): PetShape {
  if (variant === "robot") {
    return {
      height: 0.58,
      width: 0.7,
      bodySize: [0.5, 0.4, 0.48],
      bodyPosition: [0, 0.39, 0.04],
      headSize: [0.44, 0.34, 0.36],
      headPosition: [0, 0.69, -0.34],
      neckSize: [0.18, 0.14, 0.14],
      neckPosition: [0, 0.54, -0.18],
      legSize: [0.12, 0.22, 0.14],
      legX: 0.2,
      legY: 0.24,
      frontLegZ: -0.14,
      backLegZ: 0.26,
      statusRingRadius: 0.44,
      selectionRingRadius: 0.56,
      targetSize: [0.84, 1.02, 0.86],
    };
  }

  if (variant === "cat") {
    return {
      height: 0.48,
      width: 0.56,
      bodySize: [0.4, 0.24, 0.56],
      bodyPosition: [0, 0.34, 0.06],
      headSize: [0.34, 0.3, 0.3],
      headPosition: [0, 0.52, -0.35],
      neckSize: [0.12, 0.12, 0.12],
      neckPosition: [0, 0.43, -0.2],
      legSize: [0.09, 0.26, 0.09],
      legX: 0.15,
      legY: 0.23,
      frontLegZ: -0.18,
      backLegZ: 0.3,
      statusRingRadius: 0.36,
      selectionRingRadius: 0.5,
      targetSize: [0.72, 0.86, 0.78],
    };
  }

  return {
    height: 0.54,
    width: 0.7,
    bodySize: [0.5, 0.3, 0.78],
    bodyPosition: [0, 0.34, 0.08],
    headSize: [0.36, 0.32, 0.34],
    headPosition: [0, 0.53, -0.46],
    neckSize: [0.16, 0.15, 0.16],
    neckPosition: [0, 0.43, -0.25],
    legSize: [0.12, 0.28, 0.12],
    legX: 0.18,
    legY: 0.24,
    frontLegZ: -0.25,
    backLegZ: 0.36,
    statusRingRadius: 0.44,
    selectionRingRadius: 0.58,
    targetSize: [0.9, 0.94, 1.02],
  };
}

function petLeg(
  name: string,
  material: THREE.Material,
  side: number,
  z: number,
  shape: PetShape,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(side * shape.legX, shape.legY, z);
  group.add(block(`${name}-paw`, shape.legSize, material, [0, -shape.legSize[1] * 0.42, 0]));
  return group;
}

function addPetFace(
  root: THREE.Group,
  variant: EmployeeFloorPetVariant,
  eyeMat: THREE.Material,
  darkMat: THREE.Material,
): void {
  const face = petFacePlacement(variant);
  for (const side of [-1, 1]) {
    root.add(block("pet-eye", face.eyeSize, eyeMat, [side * face.eyeX, face.eyeY, face.faceZ]));
  }
  root.add(block("pet-nose", face.noseSize, darkMat, [0, face.noseY, face.faceZ - 0.008]));
}

function petFacePlacement(variant: EmployeeFloorPetVariant): {
  eyeX: number;
  eyeY: number;
  faceZ: number;
  eyeSize: [number, number, number];
  noseY: number;
  noseSize: [number, number, number];
} {
  if (variant === "robot") {
    return {
      eyeX: 0.11,
      eyeY: 0.72,
      faceZ: -0.555,
      eyeSize: [0.07, 0.055, 0.014],
      noseY: 0.65,
      noseSize: [0.2, 0.028, 0.018],
    };
  }
  if (variant === "cat") {
    return {
      eyeX: 0.08,
      eyeY: 0.56,
      faceZ: -0.506,
      eyeSize: [0.048, 0.06, 0.014],
      noseY: 0.49,
      noseSize: [0.05, 0.035, 0.018],
    };
  }
  return {
    eyeX: 0.08,
    eyeY: 0.57,
    faceZ: -0.636,
    eyeSize: [0.052, 0.052, 0.014],
    noseY: 0.49,
    noseSize: [0.07, 0.04, 0.018],
  };
}

function addPetVariantDetails(
  root: THREE.Group,
  parts: CharacterParts,
  variant: EmployeeFloorPetVariant,
  mats: {
    body: THREE.Material;
    secondary: THREE.Material;
    dark: THREE.Material;
    accent: THREE.Material;
  },
): void {
  if (variant === "robot") {
    root.add(block("robot-faceplate", [0.3, 0.13, 0.018], mats.dark, [0, 0.7, -0.534]));
    root.add(block("robot-chest-panel", [0.28, 0.18, 0.018], mats.dark, [0, 0.42, -0.208]));
    root.add(block("robot-status-light", [0.08, 0.08, 0.022], mats.accent, [0.16, 0.45, -0.22]));
    root.add(block("robot-left-bolt", [0.06, 0.06, 0.024], mats.secondary, [-0.26, 0.68, -0.5]));
    root.add(block("robot-right-bolt", [0.06, 0.06, 0.024], mats.secondary, [0.26, 0.68, -0.5]));
    root.add(block("robot-left-foot", [0.2, 0.08, 0.22], mats.dark, [-0.2, 0.065, -0.12]));
    root.add(block("robot-right-foot", [0.2, 0.08, 0.22], mats.dark, [0.2, 0.065, -0.12]));
    root.add(block("robot-rear-left-foot", [0.18, 0.08, 0.2], mats.dark, [-0.2, 0.065, 0.28]));
    root.add(block("robot-rear-right-foot", [0.18, 0.08, 0.2], mats.dark, [0.2, 0.065, 0.28]));
    const antenna = new THREE.Group();
    antenna.name = "robot-antenna";
    antenna.add(block("robot-antenna-stem", [0.035, 0.16, 0.035], mats.secondary, [0, 0.08, 0]));
    antenna.add(new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 8), mats.accent));
    antenna.children[1].position.y = 0.19;
    antenna.position.set(0, 0.9, -0.34);
    parts.antenna = antenna;
    root.add(antenna);
    return;
  }

  if (variant === "cat") {
    root.add(block("cat-muzzle", [0.14, 0.075, 0.05], mats.body, [0, 0.49, -0.53]));
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.18, 4), mats.secondary);
      ear.name = "cat-ear";
      ear.position.set(side * 0.14, 0.72, -0.35);
      ear.rotation.z = side * -0.24;
      ear.rotation.y = Math.PI * 0.25;
      root.add(ear);
    }
    addCatWhiskers(root, mats.dark);
    root.add(block("cat-left-paw-tip", [0.11, 0.04, 0.08], mats.dark, [-0.15, 0.08, -0.19]));
    root.add(block("cat-right-paw-tip", [0.11, 0.04, 0.08], mats.dark, [0.15, 0.08, -0.19]));
    parts.tail = petTail("cat-tail", mats.secondary, 0.62, 0.56, [0.18, 0.48, 0.36]);
    root.add(parts.tail);
    return;
  }

  root.add(block("dog-snout", [0.2, 0.12, 0.22], mats.body, [0, 0.49, -0.69]));
  root.add(block("dog-nose-tip", [0.08, 0.05, 0.025], mats.dark, [0, 0.5, -0.815]));
  root.add(block("dog-left-ear", [0.1, 0.3, 0.08], mats.secondary, [-0.22, 0.53, -0.43]));
  root.add(block("dog-right-ear", [0.1, 0.3, 0.08], mats.secondary, [0.22, 0.53, -0.43]));
  root.add(block("dog-collar", [0.42, 0.055, 0.08], mats.accent, [0, 0.42, -0.31]));
  root.add(block("dog-chest-patch", [0.22, 0.16, 0.026], mats.secondary, [0, 0.34, -0.325]));
  parts.tail = petTail("dog-tail", mats.secondary, 0.38, 1.16, [0, 0.48, 0.53]);
  root.add(parts.tail);
}

function petTail(
  name: string,
  material: THREE.Material,
  length: number,
  rotationX: number,
  position: [number, number, number],
): THREE.Mesh {
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, length, 10), material);
  tail.name = name;
  tail.position.set(...position);
  tail.rotation.x = rotationX;
  return tail;
}

function addCatWhiskers(root: THREE.Group, material: THREE.Material): void {
  for (const side of [-1, 1]) {
    root.add(catWhisker(side, 0.505, 0.16));
    root.add(catWhisker(side, 0.47, 0));
    root.add(catWhisker(side, 0.435, -0.16));
  }

  function catWhisker(side: number, y: number, tilt: number): THREE.Mesh {
    const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 6), material);
    whisker.name = "cat-whisker";
    whisker.position.set(side * 0.16, y, -0.53);
    whisker.rotation.z = Math.PI * 0.5 + side * tilt;
    return whisker;
  }
}

function handCup(material: THREE.Material, h: number, w: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * w, 0.05 * w, 0.16 * h, 14), material);
  mesh.name = "hand-cup";
  mesh.position.set(0, -0.74 * h, -0.16);
  return mesh;
}

function limb(name: string, shirtMat: THREE.Material, skinMat: THREE.Material, side: number, h: number, w: number): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(side * 0.42 * w, 1.22 * h, 0);
  group.add(block(`${name}-upper`, [0.18 * w, 0.37 * h, 0.2], shirtMat, [0, -0.2 * h, 0]));
  group.add(block(`${name}-lower`, [0.16 * w, 0.34 * h, 0.18], skinMat, [0, -0.56 * h, -0.03]));
  return group;
}

function leg(name: string, pantsMat: THREE.Material, shoeMat: THREE.Material, side: number, h: number, w: number): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(side * 0.16 * w, 0.72 * h, 0);
  group.add(block(`${name}-upper`, [0.2 * w, 0.45 * h, 0.22], pantsMat, [0, -0.22 * h, 0]));
  group.add(block(`${name}-lower`, [0.18 * w, 0.45 * h, 0.2], pantsMat, [0, -0.68 * h, 0]));
  group.add(block(`${name}-foot`, [0.22 * w, 0.11 * h, 0.36], shoeMat, [0, -0.96 * h, -0.08]));
  return group;
}

function addFace(root: THREE.Group, profile: { height: number; width: number }, mats: Record<string, THREE.Material>): void {
  const h = profile.height;
  const w = profile.width;
  const y = 1.76 * h;
  const z = -0.253 * w;
  for (const side of [-1, 1]) {
    root.add(block("eye", [0.055 * w, 0.055 * h, 0.012], mats.eye, [side * 0.105 * w, y, z]));
  }
  root.add(block("mouth", [0.15 * w, 0.024 * h, 0.012], mats.mouth, [0, 1.63 * h, z]));
}

function addHair(root: THREE.Group, profile: { height: number; width: number; hairStyle: HairStyle }, mats: Record<string, THREE.Material>): void {
  const h = profile.height;
  const w = profile.width;
  const pieces = new THREE.Group();
  pieces.name = "hair";
  pieces.add(block("hair-cap", [0.54 * w, 0.13 * h, 0.54 * w], mats.hair, [0, 1.96 * h, -0.01]));
  pieces.add(block("hair-front-rim", [0.56 * w, 0.14 * h, 0.09], mats.hair, [0, 1.87 * h, -0.255 * w]));
  pieces.add(block("hair-left-rim", [0.09 * w, 0.22 * h, 0.5 * w], mats.hair, [-0.275 * w, 1.82 * h, -0.005]));
  pieces.add(block("hair-right-rim", [0.09 * w, 0.22 * h, 0.5 * w], mats.hair, [0.275 * w, 1.82 * h, -0.005]));
  pieces.add(block("hair-back-rim", [0.52 * w, 0.22 * h, 0.09], mats.hair, [0, 1.82 * h, 0.255 * w]));

  const frontY = 1.855 * h;
  const frontZ = -0.29 * w;
  if (profile.hairStyle === "buzz") {
    pieces.add(block("buzz-front", [0.54 * w, 0.075 * h, 0.1], mats.hair, [0, frontY, frontZ]));
  } else if (profile.hairStyle === "crop") {
    for (let i = 0; i < 4; i += 1) pieces.add(block("crop", [0.16 * w, 0.1 * h, 0.1], mats.hair, [(-0.18 + i * 0.12) * w, frontY, frontZ]));
  } else if (profile.hairStyle === "bob") {
    pieces.add(block("bob-l", [0.16 * w, 0.48 * h, 0.2], mats.hair, [-0.31 * w, 1.64 * h, -0.01]));
    pieces.add(block("bob-r", [0.16 * w, 0.48 * h, 0.2], mats.hair, [0.31 * w, 1.64 * h, -0.01]));
    pieces.add(block("bang", [0.42 * w, 0.12 * h, 0.1], mats.hair, [-0.04 * w, frontY, frontZ]));
  } else if (profile.hairStyle === "long" || profile.hairStyle === "lob") {
    pieces.add(block("long-l", [0.16 * w, profile.hairStyle === "long" ? 0.68 * h : 0.5 * h, 0.2], mats.hair, [-0.31 * w, profile.hairStyle === "long" ? 1.5 * h : 1.6 * h, 0]));
    pieces.add(block("long-r", [0.16 * w, profile.hairStyle === "long" ? 0.68 * h : 0.5 * h, 0.2], mats.hair, [0.31 * w, profile.hairStyle === "long" ? 1.5 * h : 1.6 * h, 0]));
    pieces.add(block("long-back", [0.5 * w, profile.hairStyle === "long" ? 0.58 * h : 0.42 * h, 0.13], mats.hair, [0, profile.hairStyle === "long" ? 1.48 * h : 1.56 * h, 0.27 * w]));
    pieces.add(block("bang", [0.42 * w, 0.12 * h, 0.1], mats.hair, [-0.06 * w, frontY, frontZ]));
  } else if (profile.hairStyle === "pigtails") {
    pieces.add(block("tail-l", [0.16 * w, 0.42 * h, 0.16], mats.hair, [-0.39 * w, 1.5 * h, 0.08]));
    pieces.add(block("tail-r", [0.16 * w, 0.42 * h, 0.16], mats.hair, [0.39 * w, 1.5 * h, 0.08]));
    pieces.add(block("bang", [0.36 * w, 0.1 * h, 0.1], mats.hair, [-0.02 * w, frontY, frontZ]));
  } else if (profile.hairStyle === "pony") {
    pieces.add(block("pony", [0.2 * w, 0.46 * h, 0.2], mats.hair, [0, 1.48 * h, 0.36 * w]));
    pieces.add(block("bang", [0.36 * w, 0.1 * h, 0.1], mats.hair, [-0.02 * w, frontY, frontZ]));
  } else if (profile.hairStyle === "curls") {
    for (let i = 0; i < 7; i += 1) pieces.add(block("curl", [0.13 * w, 0.13 * h, 0.11], mats.hair, [(-0.24 + i * 0.08) * w, frontY + Math.sin(i) * 0.025, frontZ]));
  } else if (profile.hairStyle === "undercut") {
    pieces.add(block("sweep", [0.42 * w, 0.13 * h, 0.11], mats.hair, [-0.08 * w, 1.88 * h, frontZ]));
    pieces.add(block("side", [0.12 * w, 0.32 * h, 0.16], mats.hair, [0.31 * w, 1.7 * h, 0]));
  } else {
    pieces.add(block("sweep", [0.42 * w, 0.13 * h, 0.11], mats.hair, [0.05 * w, 1.88 * h, frontZ]));
  }
  root.add(pieces);
}

function createMarker(accent: number, height: number): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "status-marker";
  marker.position.set(0, 2.62 * height, 0);
  const markerMat = mat(accent, 0.38, accent);
  markerMat.emissiveIntensity = 0.34;
  const topCone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), markerMat);
  topCone.position.y = 0.08;
  topCone.rotation.y = Math.PI * 0.25;
  const bottomCone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), markerMat.clone());
  bottomCone.position.y = -0.08;
  bottomCone.rotation.x = Math.PI;
  bottomCone.rotation.y = Math.PI * 0.25;
  marker.add(topCone, bottomCone);
  return marker;
}

function block(name: string, size: [number, number, number], material: THREE.Material, position: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  return mesh;
}

function mat(color: number, roughness = 0.74, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
    emissive,
    emissiveIntensity: emissive ? 0.18 : 0,
  });
}

function darken(color: number, amount: number): number {
  return new THREE.Color(color).multiplyScalar(amount).getHex();
}
