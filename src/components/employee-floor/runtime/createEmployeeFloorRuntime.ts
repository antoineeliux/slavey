import {
  createScene,
} from "../scene/createScene";
import { syncOwnerAvatar } from "../scene/createOwnerAvatar";
import { updateNameplateScale } from "../scene/characterNameplate";
import {
  disposeActors,
  disposeDesks,
  syncActors,
  type ActorMap,
} from "../scene/updateActors";
import type { FocusRequest } from "./cameraRuntime";
import {
  installOfficeDebugHotspots,
  uninstallOfficeDebugHotspots,
} from "./debugHotspots";
import {
  createEmployeeFloorOrbitRuntime,
  installOrbitInteractionRuntime,
  installResizeRuntime,
} from "./orbitControlsRuntime";
import { installPointerSelectionRuntime } from "./pointerSelectionRuntime";
import { createReducedMotionRuntime } from "./reducedMotionRuntime";
import {
  createEmployeeFloorRenderer,
  disposeWebGLRenderer,
} from "./rendererRuntime";
import { createRuntimeFrameLoop } from "./runtimeFrameLoop";
import { createRuntimeVisibility } from "./runtimeVisibility";
import type {
  EmployeeFloorRuntime,
  EmployeeFloorRuntimeProps,
} from "./runtimeTypes";

export type {
  EmployeeFloorRuntime,
  EmployeeFloorRuntimeProps,
} from "./runtimeTypes";

export function createEmployeeFloorRuntime(
  container: HTMLElement,
  initialProps: EmployeeFloorRuntimeProps,
): EmployeeFloorRuntime | null {
  const rendererRuntime = createEmployeeFloorRenderer(container);
  if (!rendererRuntime) {
    return null;
  }

  const { renderer, width, height } = rendererRuntime;
  const floorScene = createScene(width, height, initialProps.officeColorTheme);
  const actors: ActorMap = new Map();
  let props = initialProps;
  let disposed = false;
  let focusRequest: FocusRequest | null = null;
  let lastFocusedEmployeeId: string | null = null;

  syncOwnerAvatar(
    floorScene.ownerAvatarGroup,
    props.avatarAppearance,
    props.showOwnerAvatar,
    {
      placement: "office",
      posture: "sitting",
      name: props.ownerName,
      nameplateScale: props.nameplateScale,
    },
  );
  syncActors(floorScene, actors, props.viewModels, props.minimumDeskCount, props.nameplateScale);
  const initialSelected = props.enableSelectionFocus
    ? props.viewModels.find((viewModel) => viewModel.selected) ?? null
    : null;
  if (initialSelected) {
    lastFocusedEmployeeId = initialSelected.id;
    focusRequest = {
      employeeId: initialSelected.id,
      version: 1,
    };
  }

  installOfficeDebugHotspots(floorScene, renderer.domElement);

  const { controls, initialOverviewDistance } = createEmployeeFloorOrbitRuntime(
    floorScene,
    renderer.domElement,
    width,
    height,
  );
  const resizeRuntime = installResizeRuntime({
    container,
    renderer,
    floorScene,
    controls,
    initialOverviewDistance,
  });
  const reducedMotionRuntime = createReducedMotionRuntime();
  const visibilityRuntime = createRuntimeVisibility(renderer.domElement);
  const frameLoop = createRuntimeFrameLoop({
    floorScene,
    actors,
    controls,
    renderer,
    getProps: () => props,
    getReducedMotion: reducedMotionRuntime.current,
    getFocusRequest: () => focusRequest,
    setFocusRequest: (nextFocusRequest) => {
      focusRequest = nextFocusRequest;
    },
    isActive: visibilityRuntime.isActive,
  });
  visibilityRuntime.setWakeHandler(frameLoop.wake);
  const orbitInteractionRuntime = installOrbitInteractionRuntime(
    controls,
    frameLoop.markInteraction,
  );
  const pointerSelectionRuntime = installPointerSelectionRuntime({
    canvas: renderer.domElement,
    floorScene,
    actors,
    getProps: () => props,
    markInteraction: frameLoop.markInteraction,
  });
  frameLoop.start();

  const updateProps = (nextProps: EmployeeFloorRuntimeProps) => {
    if (disposed) {
      return;
    }

    const previousProps = props;
    props = nextProps;

    if (
      previousProps.viewModels !== nextProps.viewModels ||
      previousProps.enableSelectionFocus !== nextProps.enableSelectionFocus ||
      previousProps.minimumDeskCount !== nextProps.minimumDeskCount
    ) {
      if (!nextProps.enableSelectionFocus) {
        lastFocusedEmployeeId = null;
        focusRequest = null;
      } else {
        const selected = nextProps.viewModels.find((viewModel) => viewModel.selected) ?? null;
        if (selected && selected.id !== lastFocusedEmployeeId) {
          lastFocusedEmployeeId = selected.id;
          focusRequest = {
            employeeId: selected.id,
            version: (focusRequest?.version ?? 0) + 1,
          };
        } else if (!selected) {
          lastFocusedEmployeeId = null;
          focusRequest = null;
        }
      }
      syncActors(
        floorScene,
        actors,
        nextProps.viewModels,
        nextProps.minimumDeskCount,
        nextProps.nameplateScale,
      );
    }

    if (previousProps.officeColorTheme !== nextProps.officeColorTheme) {
      floorScene.applyTheme(nextProps.officeColorTheme);
      syncActors(
        floorScene,
        actors,
        nextProps.viewModels,
        nextProps.minimumDeskCount,
        nextProps.nameplateScale,
      );
    }

    if (previousProps.nameplateScale !== nextProps.nameplateScale) {
      actors.forEach((actor) => updateNameplateScale(actor, nextProps.nameplateScale));
    }

    if (
      previousProps.avatarAppearance !== nextProps.avatarAppearance ||
      previousProps.ownerName !== nextProps.ownerName ||
      previousProps.showOwnerAvatar !== nextProps.showOwnerAvatar ||
      previousProps.nameplateScale !== nextProps.nameplateScale
    ) {
      syncOwnerAvatar(
        floorScene.ownerAvatarGroup,
        nextProps.avatarAppearance,
        nextProps.showOwnerAvatar,
        {
          placement: "office",
          posture: "sitting",
          name: nextProps.ownerName,
          nameplateScale: nextProps.nameplateScale,
        },
      );
    }
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    frameLoop.dispose();
    visibilityRuntime.dispose();
    pointerSelectionRuntime.dispose();
    orbitInteractionRuntime.dispose();
    reducedMotionRuntime.dispose();
    resizeRuntime.dispose();
    controls.dispose();
    disposeActors(actors);
    disposeDesks(floorScene);
    floorScene.dispose();
    uninstallOfficeDebugHotspots();
    disposeWebGLRenderer(renderer);
  };

  return { updateProps, dispose };
}
