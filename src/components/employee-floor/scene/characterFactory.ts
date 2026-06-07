import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
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
    visual: {
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
    },
  };
  applyCharacterView(actor, viewModel, materials);
  updatePose(actor, 0, 0);
  return actor;
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
