import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeVisibility } from "./runtimeVisibility";

describe("runtimeVisibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("treats connected visible targets as active", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const target = document.createElement("canvas");
    document.body.appendChild(target);

    const visibility = createRuntimeVisibility(target);
    const wake = vi.fn();
    visibility.setWakeHandler(wake);

    expect(visibility.isActive()).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);

    visibility.dispose();
  });

  it("wakes the runtime when the document becomes visible again", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const target = document.createElement("canvas");
    document.body.appendChild(target);
    const visibility = createRuntimeVisibility(target);
    const wake = vi.fn();
    visibility.setWakeHandler(wake);

    expect(visibility.isActive()).toBe(false);
    expect(wake).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(visibility.isActive()).toBe(true);
    expect(wake).toHaveBeenCalledTimes(1);

    visibility.dispose();
  });

  it("tracks viewport intersection when the browser supports it", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let callback: IntersectionObserverCallback | null = null;
    const disconnect = vi.fn();
    class MockIntersectionObserver {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
      }

      observe() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const target = document.createElement("canvas");
    document.body.appendChild(target);
    const visibility = createRuntimeVisibility(target);
    const wake = vi.fn();
    visibility.setWakeHandler(wake);

    emitIntersection(callback, false);
    expect(visibility.isActive()).toBe(false);

    emitIntersection(callback, true);
    expect(visibility.isActive()).toBe(true);
    expect(wake).toHaveBeenCalledTimes(2);

    visibility.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

function emitIntersection(
  callback: IntersectionObserverCallback | null,
  isIntersecting: boolean,
): void {
  if (!callback) {
    throw new Error("IntersectionObserver callback was not installed");
  }
  callback(
    [
      {
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}
