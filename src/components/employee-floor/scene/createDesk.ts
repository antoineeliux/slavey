import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import { deskAnchorForIndex } from "./layout";
import type { FloorMaterials } from "./materials";

export type DeskObject = {
  index: number;
  root: THREE.Group;
  screenMaterials: THREE.MeshStandardMaterial[];
};

export function createDesk(index: number, materials: FloorMaterials): DeskObject {
  const anchor = deskAnchorForIndex(index);
  const root = new THREE.Group();
  root.name = `desk-${index}`;

  const dir = anchor.row === 0 ? 1 : -1;
  const position = anchor.desk;
  const z = position.z + dir * 1.02;

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.16, 1.18), materials.deskTop);
  top.position.set(position.x, 0.78, z);
  top.castShadow = true;
  top.receiveShadow = true;

  const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.18, 0.12), materials.deskEdge);
  frontEdge.position.set(position.x, 0.67, z - dir * 0.62);
  frontEdge.castShadow = true;
  frontEdge.receiveShadow = true;

  const privacyPanel = new THREE.Mesh(new THREE.BoxGeometry(2.56, 0.5, 0.08), materials.deskEdge);
  privacyPanel.position.set(position.x, 0.48, z + dir * 0.5);
  privacyPanel.castShadow = true;
  privacyPanel.receiveShadow = true;

  const screenA = materials.monitorScreen.clone();
  const mainMonitor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.055), screenA);
  mainMonitor.position.set(position.x - 0.26, 1.22, z + dir * 0.28);
  mainMonitor.rotation.y = dir > 0 ? -0.08 : Math.PI + 0.08;
  mainMonitor.castShadow = true;

  const mainStand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), materials.monitorCase);
  mainStand.position.set(position.x - 0.26, 1.0, z + dir * 0.18);
  mainStand.castShadow = true;

  const screenB = materials.monitorScreen.clone();
  const sideMonitor = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.055), screenB);
  sideMonitor.position.set(position.x + 0.48, 1.16, z + dir * 0.24);
  sideMonitor.rotation.y = dir > 0 ? 0.12 : Math.PI - 0.12;
  sideMonitor.castShadow = true;

  const sideStand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.055), materials.monitorCase);
  sideStand.position.set(position.x + 0.48, 0.98, z + dir * 0.16);
  sideStand.castShadow = true;

  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.22), materials.keyboard);
  keyboard.position.set(position.x - 0.08, 0.89, z - dir * 0.23);
  keyboard.castShadow = true;
  keyboard.receiveShadow = true;

  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.12), materials.keyboard);
  mouse.position.set(position.x + 0.52, 0.89, z - dir * 0.23);
  mouse.castShadow = true;
  mouse.receiveShadow = true;

  const deskPad = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.025, 0.42), materials.floorLane);
  deskPad.position.set(position.x + 0.04, 0.87, z - dir * 0.2);
  deskPad.receiveShadow = true;

  const lamp = createDeskLamp(position.x + 1.02, z - dir * 0.24, dir, materials);
  const chair = createChair(position.x, position.z - dir * 0.02, dir, materials);

  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.76, 0.1), materials.deskLeg);
      leg.position.set(position.x + xSide * 1.14, 0.4, z + zSide * 0.47);
      leg.castShadow = true;
      root.add(leg);
    }
  }

  root.add(
    top,
    frontEdge,
    privacyPanel,
    mainMonitor,
    mainStand,
    sideMonitor,
    sideStand,
    deskPad,
    keyboard,
    mouse,
    lamp,
    chair,
  );
  return { index, root, screenMaterials: [screenA, screenB] };
}

function createDeskLamp(x: number, z: number, dir: number, materials: FloorMaterials): THREE.Group {
  const lamp = new THREE.Group();
  lamp.name = "desk-lamp";
  lamp.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.035, 16), materials.deskLeg);
  base.position.y = 0.92;
  base.castShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), materials.metal);
  stem.position.y = 1.08;
  stem.rotation.x = dir * 0.22;
  stem.castShadow = true;
  const shade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.24), materials.lightPanel);
  shade.position.set(0, 1.25, -dir * 0.08);
  shade.castShadow = true;
  const bulb = new THREE.PointLight(0xffdfaa, 4.8, 4.2, 1.22);
  bulb.name = "desk-lamp-light";
  bulb.position.set(0, 1.2, -dir * 0.08);
  lamp.add(base, stem, shade, bulb);
  return lamp;
}

function createChair(x: number, z: number, dir: number, materials: FloorMaterials): THREE.Group {
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.68), materials.chairAccent);
  seat.position.set(x, 0.36, z);
  seat.castShadow = true;
  seat.receiveShadow = true;
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.56), materials.chair);
  cushion.position.set(x, 0.5, z);
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.82, 0.16), materials.chair);
  back.position.set(x, 0.82, z - dir * 0.38);
  back.rotation.x = -dir * 0.1;
  back.castShadow = true;
  back.receiveShadow = true;
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.58), materials.chair);
  leftArm.position.set(x - 0.44, 0.55, z - dir * 0.02);
  leftArm.castShadow = true;
  const rightArm = leftArm.clone();
  rightArm.position.x = x + 0.44;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.34, 12), materials.deskLeg);
  base.position.set(x, 0.18, z);
  base.castShadow = true;
  const wheelBase = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 18), materials.deskLeg);
  wheelBase.position.set(x, 0.05, z);
  wheelBase.castShadow = true;
  wheelBase.receiveShadow = true;
  chair.add(seat, cushion, back, leftArm, rightArm, base, wheelBase);
  return chair;
}

export function updateDeskState(
  desk: DeskObject,
  viewModel: EmployeeFloorViewModel | null,
  elapsed: number,
  reducedMotion: boolean,
): void {
  const color = viewModel ? screenColorForState(viewModel) : 0x101817;
  const pulse = reducedMotion ? 0.5 : Math.sin(elapsed * 4.8 + desk.index) * 0.5 + 0.5;
  desk.screenMaterials.forEach((material) => {
    material.color.setHex(0x101817);
    material.emissive.setHex(color);
    material.emissiveIntensity = viewModel?.worksAtDesk ? 0.16 + pulse * 0.34 : 0.05;
  });
}

export function disposeDesk(desk: DeskObject): void {
  desk.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
    }
  });
  desk.screenMaterials.forEach((material) => material.dispose());
}

function screenColorForState(viewModel: EmployeeFloorViewModel): number {
  switch (viewModel.visualState) {
    case "desk_terminal":
      return 0x75bdff;
    case "desk_waiting_instruction":
      return 0x8ec5d8;
    case "desk_waiting_approval":
      return 0xf1ce73;
    case "desk_review":
      return 0xc798ff;
    case "desk_blocked":
      return 0xff7a70;
    case "desk_working":
    default:
      return 0x76e084;
  }
}
