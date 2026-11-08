import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // The admin settings scenario changes global server settings, so it runs
  // separately against its own disposable stack.
  ...(process.env.E2E_MAIL_DISABLED_TEST === "1"
    ? { testMatch: "**/mail-disabled.spec.ts" }
    : { testIgnore: "**/mail-disabled.spec.ts" }),
  fullyParallel: true,
  // The lifecycle flows in cards/ and boards/ are long (create, archive,
  // restore and reload in one user journey); 30 s left no headroom on a
  // loaded CI runner once the shared stack warms up.
  timeout: 60_000,
  workers: process.env.CI ? 4 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    locale: "en-US",
    baseURL: process.env.E2E_SITE_URL ?? "http://127.0.0.1:4300/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome" }],
});
