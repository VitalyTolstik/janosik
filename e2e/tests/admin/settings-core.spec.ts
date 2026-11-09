import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster, ownerCredentials } from "@/helpers/admin.js";

/** Core settings screens that do not mutate the global transport. */

test("S1: email service shows the env transport and all presets", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("email"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-email-status")).toContainText(
    "Delivery is active via the server's SMTP_* env bootstrap",
  );
  await expect(
    page.locator('[data-testid^="admin-email-preset-"]'),
  ).toHaveCount(7);
  await expect(page.getByTestId("admin-email-preset-mailpit")).toBeVisible();
  await expect(page.getByTestId("admin-email-test-to")).toBeVisible();
  await expect(page.getByTestId("admin-email-save")).toBeVisible();
});

test("S20: observability shows runtime, frontend, jobs, tables and health", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("observability"), {
    waitUntil: "domcontentloaded",
  });

  for (const label of [
    "Version",
    "Environment",
    "Uptime",
    "Database size",
    "Commit",
    "Started",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByTestId("admin-observability-frontend")).toBeVisible();
  await expect(page.getByText("Jobs", { exact: true })).toBeVisible();
  await expect(page.getByText("Biggest tables", { exact: true })).toBeVisible();
  const health = page.getByText("Health", { exact: true }).locator("xpath=..");
  for (const name of ["database", "realtime", "maintenance"]) {
    await expect(health.getByText(name, { exact: true })).toBeVisible();
  }
});
