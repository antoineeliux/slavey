import { expect, test as base, type Locator, type Page } from "@playwright/test";

import {
  collectUnexpectedErrors,
  expectCanvasToBeNonBlank,
  OFFICE_READY_TIMEOUT,
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
    test.setTimeout(60_000);
    await openApp(page, { preserveDrawingBuffer: true, waitForOffice: true });

    const officePane = page.locator(".office-pane");
    const canvas = officePane.locator(".employee-floor-webgl");
    await expect(officePane).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
    await expect(officePane.locator(".office-floating-toolbar")).toBeVisible({
      timeout: OFFICE_READY_TIMEOUT,
    });
    await expect(officePane.locator(".office-status-hud").getByText("Mira Frontend")).toBeVisible({
      timeout: OFFICE_READY_TIMEOUT,
    });
    await expect(canvas).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
    await expectCanvasToBeNonBlank(canvas);
  });

  test("opens refreshes closes and reopens the office terminal dock", async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page, { waitForOffice: true });

    const officePane = page.locator(".office-pane");
    const statusHud = officePane.locator(".office-status-hud");
    const terminalDock = officePane.locator(
      'section.office-terminal-dock[aria-label="Mira Frontend terminal"]',
    );
    const terminalActions = statusHud.locator(".office-status-actions");

    await expect(statusHud).toContainText("Mira Frontend", { timeout: OFFICE_READY_TIMEOUT });
    await expect(statusHud).toContainText("session linked", { timeout: OFFICE_READY_TIMEOUT });
    await expect(statusHud).toContainText("frontend-smoke", { timeout: OFFICE_READY_TIMEOUT });

    await openTerminalDock(terminalActions, terminalDock);
    await expectTerminalDockContent(terminalDock);

    await clickRenderedButton(terminalDock, "Refresh terminal rendering");
    await expectTerminalDockContent(terminalDock);

    await closeTerminalDock(terminalDock);

    await openTerminalDock(terminalActions, terminalDock);
    await expectTerminalDockContent(terminalDock);
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

async function expectTerminalDockContent(terminalDock: Locator): Promise<void> {
  await expect(terminalDock).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
  await expect
    .poll(
      () =>
        terminalDock.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const host = element.querySelector(".office-terminal-host");
          const hostRect = host?.getBoundingClientRect();
          const renderedText = (element.textContent ?? "").replace(/\s+/g, " ").trim();
          const refreshButton = element.querySelector(
            'button[aria-label="Refresh terminal rendering"]',
          );
          const closeButton = element.querySelector('button[aria-label="Close terminal"]');
          return {
            hasEmployeeName: renderedText.includes("Mira Frontend"),
            hasRefreshAction: Boolean(refreshButton),
            hasCloseAction: Boolean(closeButton),
            hasVisibleHost:
              Boolean(host) &&
              Boolean(hostRect) &&
              hostRect.width >= 240 &&
              hostRect.height >= 80,
            hasVisibleShell: rect.width >= 320 && rect.height >= 180,
          };
        }),
      { timeout: OFFICE_READY_TIMEOUT },
    )
    .toEqual({
      hasEmployeeName: true,
      hasRefreshAction: true,
      hasCloseAction: true,
      hasVisibleHost: true,
      hasVisibleShell: true,
    });
}

async function openTerminalDock(terminalActions: Locator, terminalDock: Locator): Promise<void> {
  await expect(terminalActions).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
  await clickRenderedButton(terminalActions, "Terminal");
  await expect(terminalDock).toHaveCount(1, { timeout: OFFICE_READY_TIMEOUT });
  await expect(terminalDock).toBeVisible({ timeout: OFFICE_READY_TIMEOUT });
}

async function closeTerminalDock(terminalDock: Locator): Promise<void> {
  await clickRenderedButton(terminalDock, "Close terminal");
  await expect(terminalDock).toHaveCount(0, { timeout: OFFICE_READY_TIMEOUT });
}

async function clickRenderedButton(
  container: Locator,
  label: string,
  timeout = OFFICE_READY_TIMEOUT,
): Promise<void> {
  const button = container.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible({ timeout });
  await expect(button).toBeEnabled({ timeout });
  await button.click({ force: true, timeout });
}
