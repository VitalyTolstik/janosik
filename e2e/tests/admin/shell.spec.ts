import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  adminUrl,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueEmail,
  uniqueToken,
} from "@/helpers/admin.js";
import { addAttachment, addComment } from "@/helpers/admin-content.js";

/**
 * Panel shell and navigation (TASK-162.15 full): every sidebar destination,
 * the collapsible rail, theme/language persistence, the omnibox across all six
 * entity types, browser history, deep links and the unknown-route redirect.
 */

const OWNER_HUBS = [
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

/** Every legacy destination survives as a tab inside one of the eight hubs. */
const OWNER_TABS = [
  { hub: "Boards", tab: "Cards", heading: "Cards" },
  { hub: "Boards", tab: "Columns", heading: "Columns" },
  { hub: "Boards", tab: "Labels", heading: "Labels" },
  { hub: "Boards", tab: "Checklists", heading: "Checklists" },
  { hub: "Boards", tab: "Card links", heading: "Card links" },
  { hub: "Moderation", tab: "Attachments", heading: "Attachments" },
  { hub: "Audit & activity", tab: "Command log", heading: "Command log" },
  { hub: "Audit & activity", tab: "Activity", heading: "Activity" },
  { hub: "Communications", tab: "Announcements", heading: "Announcements" },
  { hub: "Communications", tab: "Public shares", heading: "Public shares" },
  { hub: "Access & security", tab: "API tokens", heading: "API tokens" },
  { hub: "Access & security", tab: "Masters", heading: "Masters" },
  { hub: "Settings", tab: "Email service", heading: "Email service" },
  { hub: "Settings", tab: "OAuth login", heading: "OAuth login" },
  { hub: "Settings", tab: "Security", heading: "Security" },
  { hub: "Settings", tab: "Traffic & limits", heading: "Traffic & limits" },
  { hub: "Settings", tab: "Observability", heading: "Observability" },
  { hub: "Settings", tab: "Demo runner", heading: "Demo runner" },
];

const OWNER_HUBS_RU = [
  { link: "Обзор", path: "/admin", heading: "Мастер-панель" },
  { link: "Пользователи", path: "/admin/users", heading: "Пользователи" },
  { link: "Доски", path: "/admin/boards", heading: "Доски" },
  { link: "Модерация", path: "/admin/moderation", heading: "Комментарии" },
  { link: "Аудит и активность", path: "/admin/audit", heading: "Аудит" },
  {
    link: "Коммуникации",
    path: "/admin/communications",
    heading: "Коммуникации",
  },
  {
    link: "Доступ и безопасность",
    path: "/admin/access",
    heading: "Сессии",
  },
  { link: "Настройки", path: "/admin/settings", heading: "Эксплуатация" },
];

const OWNER_TABS_RU = [
  { hub: "Доски", tab: "Карточки", heading: "Карточки" },
  { hub: "Доски", tab: "Колонки", heading: "Колонки" },
  { hub: "Доски", tab: "Метки", heading: "Метки" },
  { hub: "Доски", tab: "Чек-листы", heading: "Чек-листы" },
  { hub: "Доски", tab: "Связи карточек", heading: "Связи карточек" },
  { hub: "Модерация", tab: "Вложения", heading: "Вложения" },
  { hub: "Аудит и активность", tab: "Журнал команд", heading: "Журнал команд" },
  { hub: "Аудит и активность", tab: "Активность", heading: "Активность" },
  { hub: "Коммуникации", tab: "Объявления", heading: "Объявления" },
  {
    hub: "Коммуникации",
    tab: "Публичные ссылки",
    heading: "Публичные ссылки",
  },
  { hub: "Доступ и безопасность", tab: "API-токены", heading: "API-токены" },
  { hub: "Доступ и безопасность", tab: "Мастера", heading: "Мастера" },
  { hub: "Настройки", tab: "Email-рассылка", heading: "Email-рассылка" },
  { hub: "Настройки", tab: "OAuth-вход", heading: "OAuth-вход" },
  { hub: "Настройки", tab: "Безопасность", heading: "Безопасность" },
  {
    hub: "Настройки",
    tab: "Трафик и лимиты",
    heading: "Трафик и лимиты",
  },
  { hub: "Настройки", tab: "Наблюдаемость", heading: "Наблюдаемость" },
  { hub: "Настройки", tab: "Демо-запуск", heading: "Демо-запуск" },
];

test("NAV-1: every owner hub and tab opens its route and heading", async ({
  page,
}) => {
  test.slow();
  await loginAsMaster(page, ownerCredentials());
  const sidebar = page.getByTestId("admin-sidebar");

  for (const hub of OWNER_HUBS) {
    await sidebar.getByRole("link", { name: hub.link, exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(hub.path),
    );
    await expect(
      page.getByRole("heading", { name: hub.heading, exact: true }),
    ).toBeVisible();
  }

  for (const item of OWNER_TABS) {
    await sidebar.getByRole("link", { name: item.hub, exact: true }).click();
    await page
      .getByTestId("admin-hub-tabs")
      .getByRole("tab", { name: item.tab, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: item.heading, exact: true }),
    ).toBeVisible();
  }
});

test("NAV-2: sidebar collapses by button and Ctrl+B and survives reload", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  const sidebar = page.getByTestId("admin-sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");

  await page.getByTestId("admin-sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-sidebar")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("janosik.admin.sidebar")),
  ).toBe("1");

  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("admin-sidebar")).toHaveAttribute(
    "data-collapsed",
    "false",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("janosik.admin.sidebar")),
  ).toBe("0");
});

test("NAV-3: theme toggles and survives reload", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());
  const toggle = page.getByTestId("admin-theme-toggle");
  const html = page.locator("html");

  const initiallyDark = (await html.getAttribute("class"))?.includes("dark");
  await toggle.click();
  if (initiallyDark) {
    await expect(html).not.toHaveClass(/dark/);
  } else {
    await expect(html).toHaveClass(/dark/);
  }
  await expect(toggle).toHaveAttribute(
    "aria-pressed",
    initiallyDark ? "false" : "true",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  if (initiallyDark) {
    await expect(html).not.toHaveClass(/dark/);
  } else {
    await expect(html).toHaveClass(/dark/);
  }
});

test("NAV-4: language switches to Russian and survives reload", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitem", { name: "Русский" }).click();

  await expect(
    page.getByRole("heading", { name: "Мастер-панель", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Мастер-панель", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Сменить язык" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Master panel", exact: true }),
  ).toBeVisible();
});

test("NAV-5: omnibox finds all six entity types and opens a card with the keyboard", async ({
  page,
  admin,
  board,
}) => {
  const token = uniqueToken("omni");
  await board.command({ type: "RENAME_BOARD", title: `Board ${token}` });
  const columnId = await board.column(`Column ${token}`);
  const cardId = await board.card(columnId, `Card ${token}`);
  await board.label(`Label ${token}`, "blue");
  await addComment(board.api, cardId, `Comment ${token}`);
  await addAttachment(board.api, cardId, `File ${token}.txt`);
  await createUserViaAdmin(admin, {
    email: `omni-${token}@e2e.example`,
    verified: true,
  });

  await loginAsMaster(page, ownerCredentials());
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("admin-global-search-input");
  await expect(input).toBeVisible();
  await input.fill(token);

  const dialog = page.getByRole("dialog");
  for (const group of [
    "Users",
    "Boards",
    "Cards",
    "Comments",
    "Files",
    "Labels",
  ]) {
    await expect(
      dialog.getByText(group, { exact: true }).first(),
    ).toBeVisible();
  }

  // Narrow to the single card hit, then exercise the keyboard path: the
  // first result is active and Enter opens it.
  await input.fill(`Card ${token}`);
  await expect(page.getByTestId("admin-search-result-1")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/cards/${cardId}$`));
});

test("ADM-X2: all hubs and tabs work in Russian and the choice survives reload", async ({
  page,
}) => {
  test.slow();
  await loginAsMaster(page, ownerCredentials());
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitem", { name: "Русский" }).click();
  const sidebar = page.getByTestId("admin-sidebar");

  for (const hub of OWNER_HUBS_RU) {
    await sidebar.getByRole("link", { name: hub.link, exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(hub.path),
    );
    await expect(
      page.getByRole("heading", { name: hub.heading, exact: true }),
    ).toBeVisible();
  }

  for (const item of OWNER_TABS_RU) {
    await sidebar.getByRole("link", { name: item.hub, exact: true }).click();
    await page
      .getByTestId("admin-hub-tabs")
      .getByRole("tab", { name: item.tab, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: item.heading, exact: true }),
    ).toBeVisible();
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  const sidebarAfterReload = page.getByTestId("admin-sidebar");
  await expect(
    sidebarAfterReload.getByRole("link", { name: "Обзор", exact: true }),
  ).toBeVisible();
  await sidebarAfterReload
    .getByRole("link", { name: "Обзор", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мастер-панель", exact: true }),
  ).toBeVisible();
});

test("NAV-6: omnibox handles an empty query, no matches and Escape", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.keyboard.press("Control+k");
  const input = page.getByTestId("admin-global-search-input");
  await expect(input).toBeVisible();
  await expect(page.getByTestId("admin-search-result-0")).toHaveCount(0);

  await input.fill("zzz-no-such-entity");
  await expect(page.getByText("Nothing found", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("admin-global-search-input")).toHaveValue("");
});

test("NAV-7: browser Back and Forward move between list and details", async ({
  page,
  targetUser,
}) => {
  const detailUrl = (url: URL) =>
    url.pathname.endsWith(`/admin/users/${targetUser.id}`) &&
    url.searchParams.get("returnTo")?.startsWith("/admin/users?search=") ===
      true;
  const filteredListUrl = (url: URL) =>
    url.pathname.endsWith("/admin/users") &&
    url.searchParams.get("search") === targetUser.email;

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", targetUser.email);
  // Click the email link rather than bare row geometry so the test does not
  // depend on where Playwright's centre point lands.
  await page.getByTestId(`admin-user-email-${targetUser.id}`).click();
  await expect(page).toHaveURL(detailUrl);

  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Boards", exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(detailUrl);
  await expect(
    page.getByRole("heading", { name: targetUser.email, exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(filteredListUrl);
  await expect(page.getByRole("textbox", { name: "Search" })).toHaveValue(
    targetUser.email,
  );

  await page.goForward();
  await expect(page).toHaveURL(detailUrl);

  // The detail back control uses the same saved context, not a fixed route.
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(filteredListUrl);
  await expect(
    page.getByTestId(`admin-user-row-${targetUser.id}`),
  ).toBeVisible();
});

test("NAV-8: a deep link survives the login screen", async ({
  page,
  board,
}) => {
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await page.getByTestId("admin-login-email").fill(ownerCredentials().email);
  await page
    .getByTestId("admin-login-password")
    .fill(ownerCredentials().password);
  await page.getByTestId("admin-login-submit").click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();

  await page.getByTestId("admin-logout").click();
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await page.getByTestId("admin-login-email").fill(ownerCredentials().email);
  await page
    .getByTestId("admin-login-password")
    .fill(ownerCredentials().password);
  await page.getByTestId("admin-login-submit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/boards/${board.id}$`));
  await expect(
    page.getByRole("heading", { name: board.title, exact: true }),
  ).toBeVisible();
});

test("NAV-9: an unknown route redirects to the dashboard", async ({ page }) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(`${adminUrl}/does-not-exist`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("heading", { name: "Master panel", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Could not load the data")).toHaveCount(0);
});
