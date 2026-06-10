import { expect, test as base, type Page } from "@playwright/test";

import {
  collectUnexpectedErrors,
  expectCanvasToBeNonBlank,
  openApp,
  workspaceTab,
} from "./helpers";

const test = base.extend<{ failOnConsoleErrors: void }>({
  failOnConsoleErrors: [
    async ({ page }, use) => {
      const consoleErrors = collectUnexpectedErrors(page);
      await use();
      expect(consoleErrors).toEqual([]);
    },
    { auto: true },
  ],
});

test.describe("app shell CI smoke", () => {
  test("loads the app shell and workspace tabs without a blank screen", async ({ page }) => {
    await openApp(page);

    await expectAppShellToBeNonBlank(page);
    await expect(page.getByRole("tablist", { name: "Workspace" })).toBeVisible();
    await expect(workspaceTab(page, "Office")).toBeVisible();
    await expect(workspaceTab(page, "Terminal")).toBeVisible();
    await expect(workspaceTab(page, "Editor")).toBeVisible();
    await expect(workspaceTab(page, "Settings")).toBeVisible();
    await expect(page.locator("#root .app-shell.office-active")).toBeVisible();
  });

  test("lazy-loads the terminal tab with mocked terminal content", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Terminal").click();

    const terminalPane = page.locator(".terminal-pane");
    await expect(terminalPane).toBeVisible();
    await expect(terminalPane.locator(".toolbar-title")).toContainText("Mira Frontend");
    await expect(terminalPane.locator(".terminal-host")).toBeVisible();
    await expect(terminalPane.getByText("Mock shell").first()).toBeVisible();
    await expect(terminalPane.getByText("npm run test:web:run").first()).toBeVisible();
    await expect(page.locator(".details-panel")).toHaveCount(0);
    await expect(page.locator(".review-panel")).toHaveCount(0);
  });

  test("lazy-loads the editor tab", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Editor").click();

    await expect(page.locator(".editor-pane")).toBeVisible();
    await expect(page.locator(".file-tree .toolbar-title").getByText("Files")).toBeVisible();
    await expect(page.getByText("Recent files", { exact: true })).toBeVisible();
    await expect(page.getByText("smoke-fixture.ts")).toBeVisible();
    await expect(page.locator(".cm-editor")).toBeVisible();
  });

  test("renders settings diagnostics and copies diagnostics without crashing", async ({ page }) => {
    await openApp(page);

    await workspaceTab(page, "Settings").click();

    const settingsPane = page.locator(".settings-pane");
    await expect(settingsPane).toBeVisible();
    await expect(settingsPane.getByText("Current root")).toBeVisible();
    await expect(settingsPane.getByText("/workspace").first()).toBeVisible();
    await expect(settingsPane.locator(".diagnostics-section")).toBeVisible();
    await expect(settingsPane.getByText("Diagnostics", { exact: true })).toBeVisible();
    await expect(settingsPane.getByText("pending approval 1")).toBeVisible();
    await expect(settingsPane.getByText("pending 1")).toBeVisible();
    await expect(settingsPane.getByText("running 1")).toBeVisible();

    await settingsPane.getByRole("button", { name: /Copy diagnostics JSON/i }).click();

    await expect(page.locator("#root .app-shell")).toBeVisible();
    await expect(settingsPane.getByText("Diagnostics copied.")).toBeVisible();
  });

  test("renders the office pane and nonblank WebGL canvas", async ({ page }) => {
    await openApp(page, { preserveDrawingBuffer: true, waitForOffice: true });

    await workspaceTab(page, "Office").click();

    const officePane = page.locator(".office-pane");
    const canvas = officePane.locator(".employee-floor-webgl");
    await expect(officePane).toBeVisible();
    await expect(officePane.locator(".office-floating-toolbar")).toBeVisible();
    await expect(officePane.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible();
    await expect(canvas).toBeVisible();
    await expectCanvasToBeNonBlank(canvas);
  });

  test("opens refreshes closes and reopens the office terminal dock", async ({ page }) => {
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
    await expect(terminalDock.locator(".office-terminal-host")).toBeVisible();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();

    await terminalDock.getByRole("button", { name: "Refresh terminal rendering" }).click();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();

    await terminalDock.getByTitle("Close terminal").click();
    await expect(terminalDock).toBeHidden();

    await terminalAction.click();
    await expect(terminalDock).toBeVisible();
    await expect(terminalDock.getByText("npm run test:web:run").first()).toBeVisible();
  });
});

async function expectAppShellToBeNonBlank(page: Page): Promise<void> {
  const shell = page.locator("#root .app-shell");
  await expect(shell).toBeVisible();
  await expect
    .poll(() =>
      shell.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const visibleTextLength = (element.textContent ?? "").replace(/\s+/g, "").length;
        return rect.width >= 320 && rect.height >= 240 && visibleTextLength >= 20;
      }),
    )
    .toBe(true);
}
