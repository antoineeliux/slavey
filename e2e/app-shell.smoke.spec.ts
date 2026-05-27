import { expect, test, type Page } from "@playwright/test";

test.describe("app shell browser smoke", () => {
  test("loads the app shell without a blank screen or console errors", async ({ page }) => {
    const consoleErrors = collectUnexpectedErrors(page);

    await openApp(page);

    await expect(page.locator("#root .app-shell")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Terminal/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Slavey" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mira Frontend" })).toBeVisible();
    await expect(page.getByText("Review needed").first()).toBeVisible();
    await expect.poll(() => consoleErrors).toEqual([]);
  });

  test("renders the lazy-loaded terminal tab", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: /Terminal/i }).click();

    await expect(page.locator(".terminal-pane")).toBeVisible();
    await expect(page.locator(".terminal-host")).toBeVisible();
    await expect(page.locator(".terminal-pane").getByText("Mock shell").first()).toBeVisible();
    await expect(page.getByText("Sessions").first()).toBeVisible();
  });

  test("renders the lazy-loaded editor tab", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: /Editor/i }).click();

    await expect(page.locator(".editor-pane")).toBeVisible();
    await expect(page.locator(".file-tree .toolbar-title").getByText("Files")).toBeVisible();
    await expect(page.getByText("Recent files")).toBeVisible();
    await expect(page.getByText("smoke-fixture.ts")).toBeVisible();
    await expect(page.locator(".cm-editor")).toBeVisible();
  });

  test("renders settings workspace and diagnostics areas", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: /Settings/i }).click();

    await expect(page.locator(".settings-pane")).toBeVisible();
    await expect(page.getByText("Current root")).toBeVisible();
    await expect(page.getByText("/workspace").first()).toBeVisible();
    await expect(page.getByText("Diagnostics", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy diagnostics JSON/i })).toBeVisible();
  });

  test("renders employee details with mocked activity and review data", async ({ page }) => {
    await openApp(page);

    await expect(page.getByRole("heading", { name: "Mira Frontend" })).toBeVisible();
    await expect(page.getByText("Applying layout smoke fixtures")).toBeVisible();
    await expect(page.getByText("2 changed, 1 staged, 1 untracked")).toBeVisible();
    await expect(page.getByText("Run workspace smoke command").first()).toBeVisible();
    await expect(page.locator(".review-panel").getByText("Review", { exact: true })).toBeVisible();
    await expect(
      page.locator(".review-file-list").getByText("src/components/EmployeeDashboard.tsx"),
    ).toBeVisible();
  });

  test("copy diagnostics action does not crash", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: /Settings/i }).click();
    await page.getByRole("button", { name: /Copy diagnostics JSON/i }).click();

    await expect(page.locator("#root .app-shell")).toBeVisible();
    await expect(page.getByText("Diagnostics copied.")).toBeVisible();
  });
});

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => undefined,
      },
    });
  });
  await page.goto("/");
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
