import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  createMasterViaAdmin,
  createUserViaAdmin,
  loginAsMaster,
  openAdminLogin,
  ownerCredentials,
} from "@/helpers/admin.js";

/**
 * Admin redesign contract: branded login, eight-hub navigation, legacy
 * redirects, command palette, density and the responsive shell.
 */

test("REDESIGN-1: login is a split screen with an honest SSO note and show/hide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdminLogin(page);

  await expect(
    page.getByRole("region", { name: "Janosik master console" }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(
    page.getByText("Single sign-on is not configured", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Continue with Google/i }),
  ).toHaveCount(0);

  const password = page.getByTestId("admin-login-password");
  const show = page.getByTestId("admin-login-show-password");
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await password.fill("not-a-real-password");
  await show.click();
  await expect(show).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await show.click();
  await expect(password).toHaveAttribute("type", "password");
});

test("REDESIGN-2: command palette navigates, toggles density and g-sequences work", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  const shell = page.locator(".admin-app");
  await expect(shell).toHaveAttribute("data-density", "comfortable");

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("admin-command-palette")).toBeVisible();
  await expect(page.getByTestId("admin-command-nav-overview")).toBeVisible();
  await page.getByTestId("admin-command-action-density").click();

  await expect(page.getByTestId("admin-command-palette")).toHaveCount(0);
  await expect(shell).toHaveAttribute("data-density", "compact");
  expect(
    await page.evaluate(() => localStorage.getItem("janosik.admin.density")),
  ).toBe("compact");

  const density = page.getByTestId("admin-density-toggle");
  await expect(density).toHaveAttribute("aria-pressed", "true");
  await density.click();
  await expect(shell).toHaveAttribute("data-density", "comfortable");

  // g u jumps to Users from anywhere that is not a text field.
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
});

type LegacyRoute = [string, string, string];

async function expectLegacyRedirects(
  page: import("@playwright/test").Page,
  legacy: LegacyRoute[],
): Promise<void> {
  for (const [path, expected, heading] of legacy) {
    await page.goto(adminPath(path), { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(
      new RegExp(`${expected.replace("?", "\\?")}$`),
    );
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-hub-tabs")).toBeVisible();
  }
}

test("REDESIGN-3: boards, moderation and audit legacy URLs redirect", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await expectLegacyRedirects(page, [
    ["activity", "/admin/audit?tab=activity", "Activity"],
    ["commands", "/admin/audit?tab=commands", "Command log"],
    ["comments", "/admin/moderation?tab=comments", "Comments"],
    ["attachments", "/admin/moderation?tab=attachments", "Attachments"],
    ["cards", "/admin/boards?tab=cards", "Cards"],
    ["columns", "/admin/boards?tab=columns", "Columns"],
    ["labels", "/admin/boards?tab=labels", "Labels"],
    ["checklists", "/admin/boards?tab=checklists", "Checklists"],
    ["cardLinks", "/admin/boards?tab=links", "Card links"],
  ]);
});

test("REDESIGN-3b: access and communications legacy URLs redirect", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await expectLegacyRedirects(page, [
    ["sessions", "/admin/access?tab=sessions", "Sessions"],
    ["tokens", "/admin/access?tab=tokens", "API tokens"],
    ["masters", "/admin/access?tab=masters", "Masters"],
    ["comms", "/admin/communications?tab=announcements", "Communications"],
    ["announcements", "/admin/communications?tab=history", "Announcements"],
    ["shares", "/admin/communications?tab=shares", "Public shares"],
  ]);
});

test("REDESIGN-3c: settings legacy URLs redirect", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());
  await expectLegacyRedirects(page, [
    ["ops", "/admin/settings?tab=general", "Operations"],
    ["email", "/admin/settings?tab=email", "Email service"],
    ["oauth", "/admin/settings?tab=oauth", "OAuth login"],
    ["security", "/admin/settings?tab=security", "Security"],
    ["traffic", "/admin/settings?tab=traffic", "Traffic & limits"],
    ["observability", "/admin/settings?tab=observability", "Observability"],
    ["demo", "/admin/settings?tab=demo", "Demo runner"],
  ]);
});

test("REDESIGN-4: the shell is 232 px, a 64 px rail and a 280 px phone sheet", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  // Remove the sidebar width/transform transitions so layout assertions are
  // deterministic; this also exercises the reduced-motion contract.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsMaster(page, ownerCredentials());

  const sidebar = page.getByTestId("admin-sidebar");
  await expect(sidebar).toHaveCSS("width", "232px");

  await page.setViewportSize({ width: 834, height: 1000 });
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(sidebar.getByText("Users", { exact: true })).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("admin-sidebar-toggle")).toBeVisible();
  // Let the media query and the sheet transform settle before measuring.
  await expect(sidebar).toHaveCSS("position", "fixed");
  await expect(sidebar).toHaveCSS("width", "280px");
  const mainWidth = await page
    .locator("#admin-main")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(mainWidth).toBeGreaterThan(370);

  await page.getByTestId("admin-sidebar-toggle").click();
  await expect(page.locator(".admin-app")).toHaveAttribute(
    "data-mobile-open",
    "true",
  );
  const sheet = await sidebar.boundingBox();
  expect(sheet?.width).toBeCloseTo(280, 0);

  await sidebar.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.locator(".admin-app")).toHaveAttribute(
    "data-mobile-open",
    "false",
  );

  const row = page.getByTestId(`admin-user-row-${user.id}`);
  await expect(row).toBeVisible();
  // On phones each row is a labelled card, not a horizontally scrolled table.
  await expect(row).toHaveCSS("display", "block");
  await expect(
    row.locator("td").filter({ hasText: user.email }),
  ).toHaveAttribute("data-label", "Email");
});

test("REDESIGN-6: a table row is keyboard reachable and the migration sheet lists old destinations", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });

  const row = page.getByTestId(`admin-user-row-${user.id}`);
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/users/${user.id}$`));
  await expect(
    page.getByRole("heading", { name: user.email, exact: true }),
  ).toBeVisible();

  await page.getByTestId("admin-all-destinations").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("All 26 destinations");
  await dialog.getByRole("link", { name: "Attachments", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/moderation\?tab=attachments$/);
  await expect(
    page.getByRole("heading", { name: "Attachments", exact: true }),
  ).toBeVisible();
});

test("REDESIGN-5: operator sees Settings read-only but no Masters tab", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page
    .getByTestId("admin-sidebar")
    .getByRole("link", { name: "Access & security", exact: true })
    .click();
  await expect(page.getByTestId("admin-hub-tab-sessions")).toBeVisible();
  await expect(page.getByTestId("admin-hub-tab-masters")).toHaveCount(0);

  await page
    .getByTestId("admin-sidebar")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.getByTestId("admin-settings-readonly")).toBeVisible();
  await expect(page.getByTestId("admin-hub-tab-email")).toBeVisible();

  await page.goto(adminPath("settings?tab=email"), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-email-status")).toBeVisible();
  await expect(page.getByTestId("admin-email-save")).toHaveCount(0);
});
