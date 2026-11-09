import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/**
 * Panel navigation smoke (TASK-162.15, redesigned): the eight hubs, their
 * tabs, direct URLs and the way back to the boards app.
 */

const HUBS = [
  { link: "Overview", path: "/admin", heading: "Master panel" },
  { link: "Users", path: "/admin/users", heading: "Users" },
  { link: "Boards", path: "/admin/boards", heading: "Boards" },
  { link: "Moderation", path: "/admin/moderation", heading: "Comments" },
  { link: "Audit & activity", path: "/admin/audit", heading: "Audit trail" },
  {
    link: "Communications",
    path: "/admin/communications",
    heading: "Communications",
  },
  { link: "Access & security", path: "/admin/access", heading: "Sessions" },
  { link: "Settings", path: "/admin/settings", heading: "Operations" },
];

test("walks the eight hubs from the sidebar", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());
  const sidebar = page.getByTestId("admin-sidebar");

  for (const hub of HUBS) {
    await sidebar.getByRole("link", { name: hub.link, exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(hub.path),
    );
    await expect(
      page.getByRole("heading", { name: hub.heading, exact: true }),
    ).toBeVisible();
  }
});

test("opens panel sections by direct URL and legacy redirect", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Security", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/settings\?tab=security$/);

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Audit trail", exact: true }),
  ).toBeVisible();
});

test("finds a user through the command palette and opens the detail page", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());

  await page.keyboard.press("Control+k");
  const input = page.getByTestId("admin-global-search-input");
  await expect(input).toBeVisible();
  await input.fill(user.email);

  const result = page.getByTestId("admin-search-result-0");
  await expect(result).toContainText(user.email);
  await result.click();

  await expect(page).toHaveURL(new RegExp(`/admin/users/${user.id}$`));
  await expect(
    page.getByRole("heading", { name: user.email, exact: true }),
  ).toBeVisible();
});

test("returns to the boards app from the admin shell", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());

  await page
    .getByTestId("admin-sidebar")
    .getByRole("link", { name: "Back to boards" })
    .click();

  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("login-email")).toBeVisible();
});
