import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";
import { delayNextRoute } from "@/helpers/network.js";

/**
 * Master-panel skeletons (SKELETON-AUDIT §4.11/4.13): the entity table
 * keeps its header while the first page loads and keeps the previous rows
 * while a search is in flight; the omnibox gets a result placeholder.
 */

test("renders the entity table header and skeleton rows before the first page", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await delayNextRoute(page, "**/api/v1/admin/entities/users*", 1500);
  await page.goto(adminPath("users"));

  const skeleton = page.getByTestId("admin-users-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("admin-users-skeleton-row")).toHaveCount(8);
  await expect(
    page.getByTestId("admin-table-scroll").locator("thead"),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(skeleton).toHaveCount(0);
});

test("keeps the table rows while a search request is in flight", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"));

  const panel = page.getByTestId("admin-entity-panel");
  const rows = page.locator('[data-testid^="admin-user-row-"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("admin-users-skeleton")).toHaveCount(0);
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await expect(panel).toHaveAttribute("aria-busy", "false");

  await delayNextRoute(page, "**/api/v1/admin/entities/users*", 1500);
  await page.locator('input[placeholder="Search…"]').fill(user.email);

  await expect(panel).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByTestId("admin-table-scroll").locator("thead"),
  ).toBeVisible();
  expect(await rows.count()).toBe(before);
  await expect(page.getByTestId("admin-users-skeleton")).toHaveCount(0);

  await expect(panel).toHaveAttribute("aria-busy", "false", {
    timeout: 10_000,
  });
});

test("reserves the omnibox results while the global search runs", async ({
  page,
}) => {
  const owner = ownerCredentials();
  await loginAsMaster(page, owner);
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("admin-global-search-input");
  await expect(input).toBeVisible();

  await delayNextRoute(page, "**/api/v1/admin/search*", 1500);
  await input.fill(owner.email);

  const skeleton = page.getByTestId("admin-search-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");

  await expect(skeleton).toHaveCount(0, { timeout: 10_000 });
});
