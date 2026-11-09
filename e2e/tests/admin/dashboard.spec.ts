import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster, ownerCredentials } from "@/helpers/admin.js";

/** Dashboard (TASK-162.15 full): counters, runtime, both charts and the feed. */

test("D1: dashboard shows counters, runtime, charts and recent audit", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());

  for (const key of [
    "users",
    "disabled",
    "boards",
    "cards",
    "commands",
    "sessions",
    "comments",
    "admins",
  ]) {
    await expect(page.getByTestId(`admin-stat-${key}`)).toBeVisible();
    await expect(page.getByTestId(`admin-stat-${key}`)).toContainText(/\d/);
  }

  await expect(page.getByText("Version", { exact: true })).toBeVisible();
  await expect(page.getByText("Uptime", { exact: true })).toBeVisible();
  await expect(page.getByText("Database", { exact: true })).toBeVisible();
  await expect(page.getByText("Environment", { exact: true })).toBeVisible();

  await expect(page.getByTestId("admin-chart-registrations")).toBeVisible();
  await expect(page.getByTestId("admin-chart-commands")).toBeVisible();

  const recent = page.getByText("Recent admin actions", { exact: true });
  await expect(recent).toBeVisible();
  await page
    .getByRole("link", { name: "Open the audit trail", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(
    page.getByRole("heading", { name: "Audit trail", exact: true }),
  ).toBeVisible();
  await page.goto(adminPath(), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Master panel", exact: true }),
  ).toBeVisible();
});
