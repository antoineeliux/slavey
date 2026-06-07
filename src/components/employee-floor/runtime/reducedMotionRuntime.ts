export type ReducedMotionRuntime = {
  current: () => boolean;
  dispose: () => void;
};

export function createReducedMotionRuntime(): ReducedMotionRuntime {
  const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  let reducedMotion = reducedMotionQuery?.matches ?? false;
  const handleReducedMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
  };
  reducedMotionQuery?.addEventListener("change", handleReducedMotionChange);

  return {
    current: () => reducedMotion,
    dispose: () => reducedMotionQuery?.removeEventListener("change", handleReducedMotionChange),
  };
}
