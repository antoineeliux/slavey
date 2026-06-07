import { expect, test, type Locator, type Page } from "@playwright/test";

test.describe("app shell browser smoke", () => {
  test("loads the app shell without a blank screen or console errors", async ({ page }) => {
    const consoleErrors = collectUnexpectedErrors(page);

    await openApp(page);

    await expect(page.locator("#root .app-shell")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Workspace" })).toBeVisible();
    await expect(workspaceTab(page, "Office")).toBeVisible();
    await expect(workspaceTab(page, "Terminal")).toBeVisible();
    await expect(page.locator("#root .app-shell.office-active")).toBeVisible();
    await expect.poll(() => consoleErrors).toEqual([]);
  });

  test("renders the lazy-loaded terminal tab", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Terminal").click();

    await expect(page.locator(".terminal-pane")).toBeVisible();
    await expect(page.locator(".terminal-host")).toBeVisible();
    await expect(page.locator(".terminal-session-bar").getByText("running")).toBeVisible();
    await expect(page.locator(".terminal-pane").getByText("Mock shell").first()).toBeVisible();
    await expect(page.getByText("Sessions").first()).toBeVisible();
  });

  test("renders the lazy-loaded editor tab", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Editor").click();

    await expect(page.locator(".editor-pane")).toBeVisible();
    await expect(page.locator(".file-tree .toolbar-title").getByText("Files")).toBeVisible();
    await expect(page.getByText("Recent files", { exact: true })).toBeVisible();
    await expect(page.getByText("smoke-fixture.ts")).toBeVisible();
    await expect(page.locator(".cm-editor")).toBeVisible();
  });

  test("renders settings workspace and diagnostics areas", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Settings").click();

    await expect(page.locator(".settings-pane")).toBeVisible();
    await expect(page.getByText("Current root")).toBeVisible();
    await expect(page.getByText("/workspace").first()).toBeVisible();
    await expect(page.getByText("Diagnostics", { exact: true })).toBeVisible();
    await expect(page.getByText("pending approval 1")).toBeVisible();
    await expect(page.getByText("pending 1")).toBeVisible();
    await expect(page.getByText("running 1")).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy diagnostics JSON/i })).toBeVisible();
  });

  test("renders selected terminal context without the employee side panel", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Terminal").click();

    const terminalPane = page.locator(".terminal-pane");
    await expect(terminalPane.locator(".toolbar-title")).toContainText("Mira Frontend");
    await expect(terminalPane.getByText("Mock shell").first()).toBeVisible();
    await expect(terminalPane.getByText("npm run test:web:run").first()).toBeVisible();
    await expect(page.locator(".details-panel")).toHaveCount(0);
    await expect(page.locator(".review-panel")).toHaveCount(0);
  });

  test("office terminal dock refreshes and reopens with visible content", async ({ page }) => {
    await openApp(page, { waitForOffice: true });

    const officePane = page.locator(".office-pane");
    const terminalDock = officePane.getByLabel("Mira Frontend terminal");
    const terminalAction = officePane
      .locator(".office-status-hud")
      .getByRole("button", { name: "Terminal" })
      .first();

    await terminalAction.click();
    await expect(terminalDock).toBeVisible();
    await expect(terminalDock.getByText("Mock shell · running")).toBeVisible();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();
    await terminalDock.getByRole("button", { name: "Refresh terminal rendering" }).click();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();
    await terminalDock.getByTitle("Close terminal").click();
    await expect(terminalDock).toBeHidden();

    await terminalAction.click();
    await expect(terminalDock).toBeVisible();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();
  });

  test("copy diagnostics action does not crash", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Settings").click();
    await page.getByRole("button", { name: /Copy diagnostics JSON/i }).click();

    await expect(page.locator("#root .app-shell")).toBeVisible();
    await expect(page.getByText("Diagnostics copied.")).toBeVisible();
  });

  test("captures the current office experience baseline", async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { deterministicRendering: true, waitForOffice: true });

    await workspaceTab(page, "Office").click();

    const officePane = page.locator(".office-pane");
    const canvas = officePane.locator(".employee-floor-webgl");
    await expect(officePane).toBeVisible();
    await expect(officePane.locator(".office-floating-toolbar")).toBeVisible();
    await expect(officePane.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible();
    await expect(canvas).toBeVisible();
    await expectCanvasToBeNonBlank(page, canvas);
    await expect(page).toHaveScreenshot("office-overview.png", screenshotOptions);

    const themeToggle = officePane.getByRole("radiogroup", { name: "Office color theme" });
    await expect(themeToggle.getByRole("radio", { name: "Warm" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await themeToggle.getByRole("radio", { name: "IDE" }).click();
    await expect(themeToggle.getByRole("radio", { name: "IDE" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await themeToggle.getByRole("radio", { name: "Warm" }).click();
    await expect(themeToggle.getByRole("radio", { name: "Warm" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await clickOfficeHotspot(page, "avatar_customizer");
    const avatarDialog = page.getByRole("dialog", { name: "Customize avatar" });
    await expect(avatarDialog).toBeVisible();
    await expect(avatarDialog.locator(".office-avatar-webgl")).toBeVisible();
    await expect(page).toHaveScreenshot("avatar-customizer.png", screenshotOptions);
    await avatarDialog.getByTitle("Close").click();
    await expect(avatarDialog).toBeHidden();

    const terminalDock = officePane.getByLabel("Mira Frontend terminal");
    const terminalAction = officePane
      .locator(".office-status-hud")
      .getByRole("button", { name: "Terminal" })
      .first();
    await expect(async () => {
      await terminalAction.click();
      await expect(terminalDock).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(terminalDock.getByText("Mock shell · running")).toBeVisible();
    await expect(terminalDock.locator(".office-terminal-host")).toBeVisible();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();
    await expect(page).toHaveScreenshot("terminal-dock.png", screenshotOptions);
    await terminalDock.getByTitle("Close terminal").click();
    await expect(terminalDock).toBeHidden();

    // Standby-slot creation is canvas-only today and has no actor projection debug helper.
    // The toolbar form covers the same mocked employee_create path without fragile coordinates.
    await officePane.locator(".office-floating-toolbar").getByLabel("Employee name").fill("Baseline Smoke");
    await officePane.locator(".office-floating-toolbar").getByLabel("Employee role").selectOption("tester");
    await officePane.locator(".office-floating-toolbar").getByTitle("Create employee").click();
    await expect(officePane.locator(".office-floating-toolbar").getByText("3 employees")).toBeVisible();
    await expect(officePane.locator(".office-status-hud").getByText("Baseline Smoke")).toBeVisible();

    await page
      .getByRole("tablist", { name: "Workspace" })
      .getByRole("button", { name: "Terminal" })
      .click();
    const terminalPane = page.locator(".terminal-pane");
    await expect(terminalPane).toBeVisible();
    await expect(terminalPane.locator(".toolbar-title")).toContainText("Baseline Smoke");
    await expect(terminalPane.getByText("No active terminal session.")).toBeVisible();
  });
});

type OpenAppOptions = {
  deterministicRendering?: boolean;
  waitForOffice?: boolean;
};

const screenshotOptions = {
  animations: "disabled",
  caret: "hide",
  maxDiffPixelRatio: 0.01,
} as const;

async function openApp(page: Page, options: OpenAppOptions = {}): Promise<void> {
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
  await page.goto("/");
  await expect(page.locator("#root .app-shell")).toBeVisible();
  await expect(page.locator("#root .app-shell")).toHaveAttribute("data-backend-ready", "true");
  await expect(workspaceTab(page, "Office")).toBeVisible();
  if (options.waitForOffice) {
    await expect(page.locator(".office-pane")).toBeVisible();
    await expect(page.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible();
  }
}

function workspaceTab(page: Page, name: string): Locator {
  return page
    .getByRole("tablist", { name: "Workspace" })
    .getByRole("button", { name });
}

async function expectCanvasToBeNonBlank(
  page: Page,
  canvas: Locator,
): Promise<void> {
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const webglCanvas = element as HTMLCanvasElement;
          return webglCanvas.width > 0 && webglCanvas.height > 0;
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        const box = await canvas.boundingBox();
        if (!box) {
          return false;
        }
        const stats = await screenshotStats(
          page,
          await page.screenshot({
            animations: "disabled",
            caret: "hide",
            clip: box,
          }),
        );
        return stats.uniqueColors >= 16 && stats.luminanceSpread >= 10;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function screenshotStats(
  page: Page,
  buffer: Buffer,
): Promise<{ uniqueColors: number; luminanceSpread: number }> {
  return page.evaluate(async (dataUrl) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("screenshot decode failed"));
      image.src = dataUrl;
    });

    const scratch = document.createElement("canvas");
    scratch.width = image.naturalWidth;
    scratch.height = image.naturalHeight;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return { uniqueColors: 0, luminanceSpread: 0 };
    }
    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
    const colors = new Set<string>();
    let minLuminance = 255;
    let maxLuminance = 0;
    const step = Math.max(4, Math.floor((scratch.width * scratch.height) / 2_000));

    for (let pixelIndex = 0; pixelIndex < scratch.width * scratch.height; pixelIndex += step) {
      const offset = pixelIndex * 4;
      const alpha = pixels[offset + 3];
      if (alpha < 12) continue;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      minLuminance = Math.min(minLuminance, luminance);
      maxLuminance = Math.max(maxLuminance, luminance);
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
    }

    return {
      uniqueColors: colors.size,
      luminanceSpread: maxLuminance - minLuminance,
    };
  }, `data:image/png;base64,${buffer.toString("base64")}`);
}

async function clickOfficeHotspot(page: Page, hotspotId: string): Promise<void> {
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

function collectUnexpectedErrors(page: Page): string[] {
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
