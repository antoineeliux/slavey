import * as THREE from "three";

import type {
  CharacterActivity,
  CharacterLocation,
  CharacterPosture,
} from "../characterBehavior";
import type {
  CharacterActionKind,
  CharacterHeldProp,
} from "./characterActionTypes";

export type OfficeActionSlot = {
  id: string;
  target: THREE.Vector3;
  location: CharacterLocation;
  posture: CharacterPosture;
  activity: CharacterActivity;
  lookAt?: THREE.Vector3;
  facing?: number;
  heldProp?: CharacterHeldProp;
};

export type OfficeActionScene = {
  id: string;
  kind: CharacterActionKind;
  minActors: number;
  maxActors: number;
  durationSeconds: number;
  slots: OfficeActionSlot[];
};

export const OFFICE_ACTION_SCENES: readonly OfficeActionScene[] = [
  {
    id: "entertainment-conversation",
    kind: "conversation",
    minActors: 2,
    maxActors: 2,
    durationSeconds: 18,
    slots: [
      socialSlot("entertainment-conversation-a", [-14.25, -4.15], [-14.25, -3.3], "office"),
      socialSlot("entertainment-conversation-b", [-14.25, -2.45], [-14.25, -3.3], "office"),
    ],
  },
  {
    id: "cafeteria-stools",
    kind: "cafeteria_stool",
    minActors: 1,
    maxActors: 2,
    durationSeconds: 24,
    slots: [
      seatedDrinkSlot("cafeteria-stool-a", [5.35, 6.18], [6.55, 7.1]),
      seatedDrinkSlot("cafeteria-stool-b", [6.45, 6.18], [6.55, 7.1]),
    ],
  },
  {
    id: "meeting-right-presentation",
    kind: "meeting_presentation",
    minActors: 3,
    maxActors: 4,
    durationSeconds: 30,
    slots: [
      {
        id: "meeting-right-presenter",
        target: point(5.35, -7.38),
        location: "meeting",
        posture: "standing",
        activity: "presenting",
        lookAt: point(5.35, -8.85),
        heldProp: "none",
      },
      meetingSeat("meeting-right-seat-a", [3.7, -10.08], [5.35, -7.38]),
      meetingSeat("meeting-right-seat-b", [5.35, -10.08], [5.35, -7.38]),
      meetingSeat("meeting-right-seat-c", [7.0, -10.08], [5.35, -7.38]),
    ],
  },
  {
    id: "entertainment-phone-rest",
    kind: "rest_phone",
    minActors: 1,
    maxActors: 2,
    durationSeconds: 26,
    slots: [
      phoneRestSlot("entertainment-phone-a", [-15.55, 2.04], [-14.25, 1.35]),
      phoneRestSlot("entertainment-phone-b", [-14.85, 2.04], [-14.25, 1.35]),
    ],
  },
  {
    id: "cafeteria-drink-counter",
    kind: "cafeteria_drink",
    minActors: 1,
    maxActors: 1,
    durationSeconds: 14,
    slots: [
      {
        id: "cafeteria-counter-drink",
        target: point(4.25, 7.65),
        location: "cafeteria",
        posture: "standing",
        activity: "drinking",
        lookAt: point(5.4, 7.15),
        heldProp: "cup",
      },
    ],
  },
  {
    id: "meeting-left-discussion",
    kind: "meeting_discussion",
    minActors: 2,
    maxActors: 4,
    durationSeconds: 28,
    slots: [
      meetingSeat("meeting-left-seat-a", [-7.0, -7.55], [-5.35, -8.85]),
      meetingSeat("meeting-left-seat-b", [-5.35, -7.55], [-5.35, -8.85]),
      meetingSeat("meeting-left-seat-c", [-3.7, -10.08], [-5.35, -8.85]),
      meetingSeat("meeting-left-seat-d", [-5.35, -10.08], [-5.35, -8.85]),
    ],
  },
] as const;

function socialSlot(
  id: string,
  target: [number, number],
  lookAt: [number, number],
  location: CharacterLocation,
): OfficeActionSlot {
  return {
    id,
    target: point(...target),
    location,
    posture: "standing",
    activity: "talking",
    lookAt: point(...lookAt),
    heldProp: "none",
  };
}

function seatedDrinkSlot(
  id: string,
  target: [number, number],
  lookAt: [number, number],
): OfficeActionSlot {
  return {
    id,
    target: point(...target),
    location: "cafeteria",
    posture: "sitting",
    activity: "drinking",
    lookAt: point(...lookAt),
    heldProp: "cup",
  };
}

function meetingSeat(
  id: string,
  target: [number, number],
  lookAt: [number, number],
): OfficeActionSlot {
  return {
    id,
    target: point(...target),
    location: "meeting",
    posture: "sitting",
    activity: "meeting",
    lookAt: point(...lookAt),
    heldProp: "none",
  };
}

function phoneRestSlot(
  id: string,
  target: [number, number],
  lookAt: [number, number],
): OfficeActionSlot {
  return {
    id,
    target: point(...target),
    location: "lounge",
    posture: "sitting",
    activity: "phone",
    lookAt: point(...lookAt),
    heldProp: "phone",
  };
}

function point(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, z);
}
