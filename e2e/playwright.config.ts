import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suites (TASK-162):
 * - `browser-e2e` runs the app/site/docs suites and ignores the master panel;
 * - `browser-e2e-admin` runs `tests/admin` on its own disposable stack;
 * - the global admin half changes server-wide settings and only runs when
 *   `E2E_ADMIN_GLOBAL_TEST=1`, pinned to one worker;
 * - `E2E_MAIL_DISABLED_TEST=1` keeps its dedicated no-mail scenario.
 */
const mailDisabled = process.env.E2E_MAIL_DISABLED_TEST === "1";
const globalAdmin = process.env.E2E_ADMIN_GLOBAL_TEST === "1";
const adminSuite = process.env.E2E_ADMIN_TEST === "1";
const emailSavePhase = process.env.E2E_ADMIN_EMAIL_SAVE_TEST === "1";

/**
 * Global email settings are the last mail-dependent scenario: the saved row
 * overrides the SMTP_* env bootstrap for the rest of the stack's life, so the
 * save test gets its own disposable stack after every other global test.
 */
const filter = mailDisabled
  ? { testMatch: "**/mail-disabled.spec.ts" }
  : globalAdmin
    ? emailSavePhase
      ? { testMatch: "**/admin/global/email.spec.ts" }
      : {
          testMatch: "**/admin/global/**/*.spec.ts",
          testIgnore: "**/admin/global/email.spec.ts",
        }
    : adminSuite
      ? {
          testMatch: "**/admin/**/*.spec.ts",
          testIgnore: "**/admin/global/**",
        }
      : {
          testIgnore: ["**/mail-disabled.spec.ts", "**/admin/**"],
        };

export default defineConfig({
  testDir: "./tests",
  ...filter,
  fullyParallel: !globalAdmin,
  workers: globalAdmin ? 1 : process.env.CI ? 4 : undefined,
  // The lifecycle flows in cards/ and boards/ are long (create, archive,
  // restore and reload in one user journey); 30 s left no headroom on a
  // loaded CI runner once the shared stack warms up.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: globalAdmin ? 0 : process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder:
          process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? "playwright-report",
      },
    ],
  ],
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
