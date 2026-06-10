import { expect, type Locator, type Page } from "@playwright/test";

export const OFFICE_READY_TIMEOUT = 30_000;

export type OpenAppOptions = {
  deterministicRendering?: boolean;
  preserveDrawingBuffer?: boolean;
  waitForOffice?: boolean;
};

export async function openApp(
  page: Page,
  options: OpenAppOptions = {},
): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => undefined,
      },
    });
  });
  if (options.deterministicRendering) {
    await page.addInitScript(() => {
      const fixedNow = 1_713_555_600_000;
      const fixedFrameTime = 1_000;

      Object.defineProperty(Date, "now", {
        configurable: true,
        value: () => fixedNow,
      });
      Object.defineProperty(window.performance, "now", {
        configurable: true,
        value: () => fixedFrameTime,
      });
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(fixedFrameTime), 16);
      window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    });
  }
  if (options.preserveDrawingBuffer) {
    await page.addInitScript(() => {
      (window as typeof window & { __slaveyE2ePreserveDrawingBuffer?: boolean })
        .__slaveyE2ePreserveDrawingBuffer = true;
    });
  }
  await page.goto("/");
  const appShell = page.locator("#root .app-shell");
  const officeTab = workspaceTab(page, "Office");
  await expect(appShell).toBeVisible();
  await expect(appShell).toHaveAttribute("data-backend-ready", "true");
  await expect(officeTab).toBeVisible();
  if (options.waitForOffice) {
    await officeTab.click();
    await expect(appShell).toHaveClass(/office-active/, { timeout: OFFICE_READY_TIMEOUT });
    const officePane = page.locator(".office-pane");
    await expect(officePane).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
    await expect(officePane.locator(".office-floating-toolbar")).toBeVisible({
      timeout: OFFICE_READY_TIMEOUT,
    });
    await expect(officePane.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible({
      timeout: OFFICE_READY_TIMEOUT,
    });
  }
}

export function workspaceTab(page: Page, name: string): Locator {
  return page
    .getByRole("tablist", { name: "Workspace" })
    .getByRole("button", { name });
}

export async function expectCanvasToBeNonBlank(canvas: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const webglCanvas = element as HTMLCanvasElement;
          return webglCanvas.width > 0 && webglCanvas.height > 0;
        }),
      { timeout: OFFICE_READY_TIMEOUT },
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const gl =
            canvas.getContext("webgl2") ??
            canvas.getContext("webgl") ??
            (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

          if (!gl || gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0) {
            return false;
          }

          const colors = new Set<string>();
          let minLuminance = 255;
          let maxLuminance = 0;
          const sampleColumns = 9;
          const sampleRows = 7;

          for (let row = 0; row < sampleRows; row += 1) {
            for (let column = 0; column < sampleColumns; column += 1) {
              const x = Math.min(
                gl.drawingBufferWidth - 1,
                Math.max(0, Math.round(((column + 0.5) / sampleColumns) * gl.drawingBufferWidth)),
              );
              const y = Math.min(
                gl.drawingBufferHeight - 1,
                Math.max(0, Math.round(((row + 0.5) / sampleRows) * gl.drawingBufferHeight)),
              );
              const pixel = new Uint8Array(4);
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              const alpha = pixel[3];
              if (alpha < 12) {
                continue;
              }
              const red = pixel[0];
              const green = pixel[1];
              const blue = pixel[2];
              const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
              minLuminance = Math.min(minLuminance, luminance);
              maxLuminance = Math.max(maxLuminance, luminance);
              colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
            }
          }

          return colors.size >= 8 && maxLuminance - minLuminance >= 8;
        }),
      { timeout: OFFICE_READY_TIMEOUT },
    )
    .toBe(true);
}

export async function clickOfficeHotspot(page: Page, hotspotId: string): Promise<void> {
  const handle = await page.waitForFunction((id) => {
    const debugWindow = window as typeof window & {
      __slaveyOfficeDebug?: {
        projectHotspot: (hotspotId: string) => { x: number; y: number } | null;
      };
    };
    return debugWindow.__slaveyOfficeDebug?.projectHotspot(id) ?? null;
  }, hotspotId);
  const point = await handle.jsonValue();
  await page.mouse.click(point.x, point.y);
}

export function collectUnexpectedErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}
