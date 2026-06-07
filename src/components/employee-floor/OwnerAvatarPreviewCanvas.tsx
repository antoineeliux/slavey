import { useEffect, useRef } from "react";
import * as THREE from "three";

import {
  avatarAppearanceFingerprint,
  type OwnerAvatarAppearance,
} from "./avatarAppearance";
import {
  createOwnerAvatar,
  disposeOwnerAvatarResources,
} from "./scene/createOwnerAvatar";
import { disposeWebGLRenderer } from "./runtime/rendererRuntime";
import { createRuntimeVisibility } from "./runtime/runtimeVisibility";

type PreviewState = {
  avatarRoot: THREE.Group;
  avatar: THREE.Group | null;
  fingerprint: string | null;
};

const MAX_PREVIEW_PIXEL_RATIO = 1.25;
const PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;

export function OwnerAvatarPreviewCanvas({
  appearance,
  ownerName,
}: {
  appearance: OwnerAvatarAppearance;
  ownerName: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<PreviewState | null>(null);
  const appearanceRef = useRef(appearance);

  useEffect(() => {
    appearanceRef.current = appearance;
    const preview = previewRef.current;
    if (preview) {
      syncPreviewAvatar(preview, appearance, ownerName);
    }
  }, [appearance, ownerName]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof window.WebGLRenderingContext === "undefined") {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PREVIEW_PIXEL_RATIO));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    renderer.domElement.className = "office-avatar-webgl";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);
    const visibilityRuntime = createRuntimeVisibility(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    camera.position.set(0, 1.22, 5.35);
    camera.lookAt(0, 1.12, 0);

    scene.add(new THREE.HemisphereLight(0xf2eadc, 0x1d2d2b, 1.24));
    const key = new THREE.DirectionalLight(0xffdfb2, 1.05);
    key.position.set(-2.8, 4.2, 5.4);
    key.castShadow = false;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ed0ff, 0.52);
    rim.position.set(3.4, 2.4, -3.6);
    scene.add(rim);

    const avatarRoot = new THREE.Group();
    scene.add(avatarRoot);
    const preview: PreviewState = {
      avatarRoot,
      avatar: null,
      fingerprint: null,
    };
    previewRef.current = preview;
    syncPreviewAvatar(preview, appearanceRef.current, ownerName);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 48),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
    );
    shadow.name = "owner-avatar-preview-shadow";
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.set(0, 0.035, 0.05);
    shadow.scale.set(1.42, 0.52, 1);
    scene.add(shadow);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width || host.clientWidth || 320));
      const height = Math.max(1, Math.floor(rect.height || host.clientHeight || 280));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    let disposed = false;
    let framePending = false;
    let forcePendingFrame = false;
    let frameId = 0;
    let frameTimeoutId = 0;
    let lastRenderedAt = performance.now();
    const renderFrame = (timeMs: number) => {
      framePending = false;
      const forcedFrame = forcePendingFrame;
      forcePendingFrame = false;
      if (disposed || (!forcedFrame && !visibilityRuntime.isActive())) {
        return;
      }
      const time = timeMs / 1000;
      const avatar = preview.avatar;
      if (avatar) {
        avatar.position.y = 0.22 + Math.sin(time * 2.2) * 0.055;
        avatar.rotation.y = Math.PI + Math.sin(time * 0.72) * 0.18;
      }
      shadow.scale.set(1.42 + Math.sin(time * 2.2) * 0.08, 0.52, 1);
      renderer.render(scene, camera);
      lastRenderedAt = timeMs;
      scheduleFrame();
    };
    const scheduleFrame = (force = false) => {
      if (disposed || (!force && !visibilityRuntime.isActive())) {
        return;
      }
      if (framePending) {
        if (!force) {
          return;
        }
        if (frameTimeoutId) {
          window.clearTimeout(frameTimeoutId);
          frameTimeoutId = 0;
          framePending = false;
        } else {
          forcePendingFrame = true;
          return;
        }
      }
      forcePendingFrame = force;
      framePending = true;
      const frameDelay = force
        ? 0
        : Math.max(0, PREVIEW_FRAME_INTERVAL_MS - (performance.now() - lastRenderedAt));
      if (frameDelay > 1) {
        frameTimeoutId = window.setTimeout(() => {
          frameTimeoutId = 0;
          if (disposed || (!forcePendingFrame && !visibilityRuntime.isActive())) {
            framePending = false;
            return;
          }
          frameId = window.requestAnimationFrame(renderFrame);
        }, frameDelay);
      } else {
        frameId = window.requestAnimationFrame(renderFrame);
      }
    };
    visibilityRuntime.setWakeHandler(() => scheduleFrame(true));
    scheduleFrame(true);

    return () => {
      disposed = true;
      if (frameTimeoutId) {
        window.clearTimeout(frameTimeoutId);
      }
      if (framePending) {
        window.cancelAnimationFrame(frameId);
      }
      visibilityRuntime.dispose();
      resizeObserver.disconnect();
      if (preview.avatar) {
        preview.avatar.removeFromParent();
        disposeOwnerAvatarResources(preview.avatar);
      }
      previewRef.current = null;
      shadow.geometry.dispose();
      if (shadow.material instanceof THREE.Material) shadow.material.dispose();
      disposeWebGLRenderer(renderer);
    };
  }, []);

  return <div className="office-avatar-preview" ref={hostRef} />;
}

function syncPreviewAvatar(
  preview: PreviewState,
  appearance: OwnerAvatarAppearance,
  ownerName: string,
): void {
  const fingerprint = avatarAppearanceFingerprint(appearance);
  const nextFingerprint = `${ownerName.trim()}:${fingerprint}`;
  if (preview.fingerprint === nextFingerprint) {
    return;
  }

  if (preview.avatar) {
    preview.avatar.removeFromParent();
    disposeOwnerAvatarResources(preview.avatar);
  }

  const avatar = createOwnerAvatar(appearance, {
    placement: "preview",
    posture: "standing",
    name: ownerName,
  });
  preview.avatar = avatar;
  preview.fingerprint = nextFingerprint;
  preview.avatarRoot.add(avatar);
}
