import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/**
 * Panel navigation smoke (TASK-162.15): sidebar sections, direct URLs, the
 * global omnibox and the way back to the boards app.
 */

test("walks the main sections from the sidebar", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());
  const sidebar = page.getByTestId("admin-sidebar");

  const sections = [
    { link: "Dashboard", path: "/admin", heading: "Master panel" },
    { link: "Users", path: "/admin/users", heading: "Users" },
    { link: "Boards", path: "/admin/boards", heading: "Boards" },
    { link: "Command log", path: "/admin/commands", heading: "Command log" },
    { link: "Audit trail", path: "/admin/audit", heading: "Audit trail" },
    { link: "Security", path: "/admin/security", heading: "Security" },
    { link: "Masters", path: "/admin/masters", heading: "Masters" },
  ];

  for (const section of sections) {
    await sidebar
      .getByRole("link", { name: section.link, exact: true })
      .click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(section.path),
    );
    await expect(
      page.getByRole("heading", { name: section.heading, exact: true }),
    ).toBeVisible();
  }
});

test("opens panel sections by direct URL", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Security", exact: true }),
  ).toBeVisible();

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Audit trail", exact: true }),
  ).toBeVisible();
});

test("finds a user through the omnibox and opens the detail page", async ({
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
