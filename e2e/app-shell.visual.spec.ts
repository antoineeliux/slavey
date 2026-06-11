import { expect, test } from "@playwright/test";

import {
  clickOfficeHotspot,
  collectUnexpectedErrors,
  openApp,
  workspaceTab,
} from "./helpers";

const screenshotOptions = {
  animations: "disabled",
  caret: "hide",
  maxDiffPixelRatio: 0.01,
} as const;

test.describe("app shell visual baselines", () => {
  test("captures the current office experience baseline", async ({ page }) => {
    test.setTimeout(90_000);
    const consoleErrors = collectUnexpectedErrors(page);
    await openApp(page, { deterministicRendering: true, waitForOffice: true });

    await workspaceTab(page, "Office").click();

    const officePane = page.locator(".office-pane");
    const canvas = officePane.locator(".employee-floor-webgl");
    await expect(officePane).toBeVisible();
    await expect(officePane.locator(".office-floating-toolbar")).toBeVisible();
    await expect(officePane.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible();
    await expect(canvas).toBeVisible();
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
    await expect.poll(() => consoleErrors).toEqual([]);
  });
});
