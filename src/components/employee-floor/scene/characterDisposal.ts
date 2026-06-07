import * as THREE from "three";

import type { EmployeeActor } from "./characterTypes";

export function disposeCharacter(actor: EmployeeActor): void {
  actor.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
    const sprite = object as THREE.Sprite;
    if (sprite.isSprite && sprite.material instanceof THREE.SpriteMaterial) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  });
  if (actor.target.material instanceof THREE.Material) actor.target.material.dispose();
  actor.target.geometry.dispose();
}
