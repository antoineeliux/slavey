import * as THREE from "three";

import type {
  CharacterActivity,
  CharacterLocation,
  CharacterPosture,
} from "../characterBehavior";

export type CharacterActionKind =
  | "conversation"
  | "cafeteria_drink"
  | "cafeteria_stool"
  | "meeting_discussion"
  | "meeting_presentation"
  | "rest_phone";

export type CharacterHeldProp = "none" | "cup" | "phone";

export type CharacterActionAssignment = {
  id: string;
  kind: CharacterActionKind;
  slotId: string;
  target: THREE.Vector3;
  location: CharacterLocation;
  posture: CharacterPosture;
  activity: CharacterActivity;
  lookAt: THREE.Vector3 | null;
  facing: number | null;
  heldProp: CharacterHeldProp;
  startsAt: number;
  endsAt: number;
};
