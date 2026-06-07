export type RuntimeVisibility = {
  isActive: () => boolean;
  setWakeHandler: (handler: () => void) => void;
  dispose: () => void;
};

export function createRuntimeVisibility(target: Element): RuntimeVisibility {
  let documentVisible = !document.hidden;
  let viewportVisible = true;
  let wakeHandler: (() => void) | null = null;

  const isActive = () => documentVisible && viewportVisible && target.isConnected;
  const wakeIfActive = () => {
    if (isActive()) {
      wakeHandler?.();
    }
  };

  const handleVisibilityChange = () => {
    documentVisible = !document.hidden;
    wakeIfActive();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          viewportVisible = entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio > 0,
          );
          wakeIfActive();
        });
  intersectionObserver?.observe(target);

  return {
    isActive,
    setWakeHandler: (handler) => {
      wakeHandler = handler;
      wakeIfActive();
    },
    dispose: () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      intersectionObserver?.disconnect();
      wakeHandler = null;
    },
  };
}
