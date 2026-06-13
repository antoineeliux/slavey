import type { EmployeeActor } from "./characterTypes";

export function updatePose(actor: EmployeeActor, time: number, index: number): void {
  if (actor.viewModel.visualKind === "pet") {
    updatePetPose(actor, time, index);
    return;
  }

  const p = actor.parts;
  const posture = actor.visual.posture;
  const activity = actor.visual.activity;
  const phase = time + index * 0.6;
  const bob = posture === "walking" ? Math.abs(Math.sin(phase * 7)) * 0.045 : Math.sin(phase * 2.1) * 0.01;
  actor.root.position.y = bob;
  p.phone.visible = actor.visual.heldProp === "phone";
  p.cup.visible = actor.visual.heldProp === "cup";

  p.leftArm.rotation.set(0.08, 0, 0.12);
  p.rightArm.rotation.set(0.08, 0, -0.12);
  p.leftLeg.rotation.set(0, 0, 0.02);
  p.rightLeg.rotation.set(0, 0, -0.02);
  p.head.rotation.set(0, 0, 0);

  if (posture === "sitting") {
    p.leftLeg.rotation.set(1.08, 0, 0.05);
    p.rightLeg.rotation.set(1.08, 0, -0.05);
  } else if (posture === "walking") {
    const stride = Math.sin(phase * 7);
    p.leftArm.rotation.set(-0.55 * stride, 0, 0.12);
    p.rightArm.rotation.set(0.55 * stride, 0, -0.12);
    p.leftLeg.rotation.set(0.55 * stride, 0, 0.04);
    p.rightLeg.rotation.set(-0.55 * stride, 0, -0.04);
    return;
  }

  if (activity === "typing" || activity === "terminal") {
    const tap = Math.sin(phase * 9) * 0.08;
    p.leftArm.rotation.set(1.05 + tap, 0, 0.18);
    p.rightArm.rotation.set(1.05 - tap, 0, -0.18);
  } else if (activity === "waiting_instruction") {
    const wave = Math.sin(phase * 5.2) * 0.26;
    p.leftArm.rotation.set(2.05 + wave, 0, 0.5);
    p.rightArm.rotation.set(2.25 - wave, 0, -0.5);
    p.head.rotation.set(0, Math.sin(phase * 1.3) * 0.12, 0);
  } else if (activity === "reviewing") {
    p.leftArm.rotation.set(0.72, 0, 0.12);
    p.rightArm.rotation.set(1.25, 0, -0.34);
  } else if (activity === "blocked") {
    p.leftArm.rotation.set(1.92, 0, 0.36);
    p.rightArm.rotation.set(1.92, 0, -0.36);
  } else if (activity === "chilling") {
    p.leftArm.rotation.set(0.18, 0, 0.42);
    p.rightArm.rotation.set(0.18, 0, -0.42);
    p.leftLeg.rotation.set(0.16, 0, 0.05);
    p.rightLeg.rotation.set(-0.04, 0, -0.05);
  } else if (activity === "drinking") {
    p.leftArm.rotation.set(posture === "sitting" ? 0.42 : 0.24, 0, 0.28);
    p.rightArm.rotation.set(1.64 + Math.sin(phase * 2.2) * 0.08, 0, -0.34);
    p.head.rotation.set(0.06, Math.sin(phase * 0.8) * 0.08, 0);
  } else if (activity === "meeting") {
    const gesture = Math.sin(phase * 2.1) * 0.11;
    p.leftArm.rotation.set(0.58 + gesture, 0, 0.22);
    p.rightArm.rotation.set(0.82 - gesture, 0, -0.28);
    p.head.rotation.set(0, Math.sin(phase * 0.9) * 0.1, 0);
  } else if (activity === "phone") {
    p.leftArm.rotation.set(0.2, 0, 0.34);
    p.rightArm.rotation.set(1.58, 0, -0.22);
    p.head.rotation.set(0.22, -0.08 + Math.sin(phase * 0.7) * 0.04, 0);
  } else if (activity === "presenting") {
    const gesture = Math.sin(phase * 3) * 0.2;
    p.leftArm.rotation.set(0.46, 0, 0.3);
    p.rightArm.rotation.set(2.18 + gesture, 0, -0.42);
    p.head.rotation.set(0, Math.sin(phase * 0.8) * 0.08, 0);
  } else if (activity === "approval") {
    p.leftArm.rotation.set(0.24, 0, 0.22);
    p.rightArm.rotation.set(2.35 + Math.sin(phase * 6) * 0.2, 0, -0.24);
  } else if (activity === "thinking") {
    p.leftArm.rotation.set(0.24, 0, 0.24);
    p.rightArm.rotation.set(1.7, 0, -0.24);
  } else if (activity === "talking") {
    const gesture = Math.sin(phase * 3.4) * 0.18;
    p.leftArm.rotation.set(0.28 + gesture, 0, 0.42);
    p.rightArm.rotation.set(0.74 - gesture, 0, -0.52);
  }
}

function updatePetPose(actor: EmployeeActor, time: number, index: number): void {
  const p = actor.parts;
  const phase = time + index * 0.6;
  const isWalking = actor.visual.posture === "walking";
  const isSitting = actor.visual.posture === "sitting";
  const needsAttention = actor.visual.activity === "approval";
  const pose = petPoseSpec(actor.viewModel.petVariant ?? "dog");
  const bob = isWalking
    ? Math.abs(Math.sin(phase * 8.6)) * 0.038
    : isSitting
      ? Math.sin(phase * 1.6) * 0.006
      : Math.sin(phase * 2.1) * 0.012;
  actor.root.position.y = bob;
  p.phone.visible = false;
  p.cup.visible = false;

  const stride = isWalking ? Math.sin(phase * 8.6) : Math.sin(phase * 2.4) * 0.12;
  const oppositeStride = -stride;
  const leftLift = isWalking ? Math.max(0, stride) * 0.09 : 0;
  const rightLift = isWalking ? Math.max(0, oppositeStride) * 0.09 : 0;
  p.body.rotation.set(isSitting ? -0.12 : 0, 0, 0);
  p.leftArm.position.set(-pose.legX, pose.legY + leftLift, pose.frontZ + stride * pose.stride);
  p.rightArm.position.set(pose.legX, pose.legY + rightLift, pose.frontZ + oppositeStride * pose.stride);
  p.leftLeg.position.set(-pose.legX, pose.legY + rightLift, pose.backZ + oppositeStride * pose.stride);
  p.rightLeg.position.set(pose.legX, pose.legY + leftLift, pose.backZ + stride * pose.stride);
  p.leftArm.rotation.set(0.62 * stride, 0, 0.02);
  p.rightArm.rotation.set(0.62 * oppositeStride, 0, -0.02);
  p.leftLeg.rotation.set(0.62 * oppositeStride, 0, 0.02);
  p.rightLeg.rotation.set(0.62 * stride, 0, -0.02);

  if (isSitting) {
    p.leftArm.position.set(-pose.legX, pose.legY, pose.sitFrontZ);
    p.rightArm.position.set(pose.legX, pose.legY, pose.sitFrontZ);
    p.leftLeg.position.set(-pose.legX, pose.sitBackY, pose.sitBackZ);
    p.rightLeg.position.set(pose.legX, pose.sitBackY, pose.sitBackZ);
    p.leftArm.rotation.set(0.08, 0, 0.04);
    p.rightArm.rotation.set(-0.08, 0, -0.04);
    p.leftLeg.rotation.set(-0.82, 0, 0.08);
    p.rightLeg.rotation.set(0.82, 0, -0.08);
  }

  p.head.rotation.set(
    needsAttention ? Math.sin(phase * 7.8) * 0.14 : 0,
    Math.sin(phase * 1.6) * 0.1,
    0,
  );
  if (p.tail) {
    p.tail.rotation.y = Math.sin(phase * (needsAttention ? 9 : 4.4)) * (needsAttention ? 0.45 : 0.22);
  }
  if (p.antenna) {
    p.antenna.rotation.z = Math.sin(phase * 5.4) * (needsAttention ? 0.18 : 0.05);
  }
}

function petPoseSpec(variant: "dog" | "cat" | "robot"): {
  legX: number;
  legY: number;
  frontZ: number;
  backZ: number;
  stride: number;
  sitFrontZ: number;
  sitBackY: number;
  sitBackZ: number;
} {
  switch (variant) {
    case "cat":
      return {
        legX: 0.15,
        legY: 0.23,
        frontZ: -0.18,
        backZ: 0.3,
        stride: 0.1,
        sitFrontZ: -0.22,
        sitBackY: 0.17,
        sitBackZ: 0.2,
      };
    case "robot":
      return {
        legX: 0.2,
        legY: 0.24,
        frontZ: -0.14,
        backZ: 0.26,
        stride: 0.08,
        sitFrontZ: -0.16,
        sitBackY: 0.18,
        sitBackZ: 0.18,
      };
    case "dog":
    default:
      return {
        legX: 0.18,
        legY: 0.24,
        frontZ: -0.25,
        backZ: 0.36,
        stride: 0.12,
        sitFrontZ: -0.29,
        sitBackY: 0.18,
        sitBackZ: 0.24,
      };
  }
}
