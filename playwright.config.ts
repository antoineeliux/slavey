import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm exec vite -- --host 127.0.0.1 --port 1421",
    env: {
      VITE_SLAVEY_E2E: "true",
    },
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
