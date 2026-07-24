import { defineConfig, devices } from "@playwright/test";

const inCi = process.env.CI === "true";

export default defineConfig({
  testDir: "./tests/release",
  outputDir: "output/playwright/release-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: inCi,
  retries: inCi ? 1 : 0,
  failOnFlakyTests: inCi,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: inCi
    ? [["line"], ["html", { outputFolder: "output/playwright/release-report", open: "never" }]]
    : [["list"]],
  use: {
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
