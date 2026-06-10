import * as THREE from "three";

export type EmployeeFloorRendererRuntime = {
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
};

const MAX_OFFICE_PIXEL_RATIO = 1.25;

export function createEmployeeFloorRenderer(
  container: HTMLElement,
): EmployeeFloorRendererRuntime | null {
  if (typeof window.WebGLRenderingContext === "undefined") {
    return null;
  }

  const { width, height } = sizeForContainer(container);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: e2ePreserveDrawingBufferEnabled(),
    });
  } catch {
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_OFFICE_PIXEL_RATIO));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "employee-floor-webgl";
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "Animated employee floor");
  container.appendChild(renderer.domElement);

  return { renderer, width, height };
}

function e2ePreserveDrawingBufferEnabled(): boolean {
  if (import.meta.env.VITE_SLAVEY_E2E !== "true" || typeof window === "undefined") {
    return false;
  }
  return (
    window as typeof window & { __slaveyE2ePreserveDrawingBuffer?: boolean }
  ).__slaveyE2ePreserveDrawingBuffer === true;
}

export function sizeForContainer(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(rect.width || container.clientWidth || 320)),
    height: Math.max(1, Math.floor(rect.height || container.clientHeight || 240)),
  };
}

export function disposeWebGLRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.renderLists.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}
