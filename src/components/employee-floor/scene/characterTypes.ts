import * as THREE from "three";

import type { EmployeeFloorViewModel } from "../employeeFloorViewModel";
import type { CharacterActivity, CharacterLocation, CharacterPosture } from "./characterBehavior";
import type {
  CharacterActionAssignment,
  CharacterHeldProp,
} from "./actions/characterActionTypes";

export type CharacterParts = {
  body: THREE.Mesh;
  head: THREE.Mesh;
  neck: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  phone: THREE.Mesh;
  cup: THREE.Mesh;
  tail?: THREE.Object3D;
  antenna?: THREE.Object3D;
};

export type HairStyle = "bob" | "crop" | "long" | "buzz" | "sweep" | "pigtails" | "undercut" | "lob" | "curls" | "pony";

export type EmployeeActor = {
  id: string;
  root: THREE.Group;
  target: THREE.Mesh;
  parts: CharacterParts;
  marker: THREE.Group;
  nameplate: THREE.Sprite;
  statusRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  selectionRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  viewModel: EmployeeFloorViewModel;
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  accent: number;
  hairStyle: HairStyle;
  height: number;
  width: number;
  homeRotationY: number;
  visual: {
    posture: CharacterPosture;
    location: CharacterLocation;
    activity: CharacterActivity;
    desk: THREE.Vector3;
    cafeteria: THREE.Vector3;
    standby: THREE.Vector3;
    executive: THREE.Vector3;
    doneRoom: THREE.Vector3;
    officeA: THREE.Vector3;
    officeB: THREE.Vector3;
    officeTarget: THREE.Vector3;
    cafeteriaTarget: THREE.Vector3;
    standbyTarget: THREE.Vector3;
    doneRoomTarget: THREE.Vector3;
    roamIndex: number;
    talkUntil: number;
    socialIntent: "roaming" | "talking";
    socialLookAt: THREE.Vector3 | null;
    action: CharacterActionAssignment | null;
    heldProp: CharacterHeldProp;
    path: THREE.Vector3[];
    pathDestinationKey: string | null;
    lastPosition: THREE.Vector3;
    lastMovedAt: number;
    repathAt: number;
    stuckCount: number;
  };
};
