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

test("Russian mobile All destinations closes both overlays on a same-hub tab change", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(adminPath("settings?lng=ru"));
  await page.getByTestId("admin-sidebar-toggle").click();
  await page.getByTestId("admin-all-destinations").click();
  const destinations = page.getByRole("dialog", { name: "Все 26 разделов" });
  await expect(destinations).toHaveAccessibleDescription(
    "Выберите раздел, который хотите открыть.",
  );
  await destinations
    .getByRole("link", { name: "Безопасность", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/settings\?tab=security$/);
  await expect(destinations).toBeHidden();
  await expect(page.getByTestId("admin-sidebar-scrim")).toHaveCount(0);
});

test("choosing a language consumes the handoff query while preserving the tab and hash", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("settings?tab=security&lng=ru#section"));
  const language = page.getByRole("button", {
    name: "Сменить язык",
    exact: true,
  });
  await language.click();
  await page.getByRole("menuitem", { name: "English" }).click();

  await expect(page).toHaveURL(/\/admin\/settings\?tab=security#section$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Security", exact: true }),
  ).toBeVisible();
});

test("the admin palette and hub chord recognize Russian-layout physical keys", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  const key = (key: string, code: string, ctrlKey = false) =>
    page
      .locator("body")
      .dispatchEvent("keydown", { key, code, ctrlKey, bubbles: true });
  await key("л", "KeyK", true);
  await expect(
    page.getByRole("combobox", { name: "Search everything" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-command-palette")).toBeHidden();

  await key("п", "KeyG");
  await key("г", "KeyU");
  await expect(page).toHaveURL(/\/admin\/users$/);
});
