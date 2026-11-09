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

const OWNER_NAV = [
  { link: "Dashboard", path: "/admin", heading: "Master panel" },
  { link: "Activity", path: "/admin/activity", heading: "Activity" },
  { link: "Command log", path: "/admin/commands", heading: "Command log" },
  { link: "Audit trail", path: "/admin/audit", heading: "Audit trail" },
  { link: "Users", path: "/admin/users", heading: "Users" },
  { link: "Masters", path: "/admin/masters", heading: "Masters" },
  { link: "Boards", path: "/admin/boards", heading: "Boards" },
  { link: "Cards", path: "/admin/cards", heading: "Cards" },
  { link: "Columns", path: "/admin/columns", heading: "Columns" },
  { link: "Labels", path: "/admin/labels", heading: "Labels" },
  { link: "Checklists", path: "/admin/checklists", heading: "Checklists" },
  { link: "Card links", path: "/admin/cardLinks", heading: "Card links" },
  { link: "Comments", path: "/admin/comments", heading: "Comments" },
  { link: "Attachments", path: "/admin/attachments", heading: "Attachments" },
  { link: "Sessions", path: "/admin/sessions", heading: "Sessions" },
  { link: "API tokens", path: "/admin/tokens", heading: "API tokens" },
  { link: "Email service", path: "/admin/email", heading: "Email service" },
  { link: "OAuth login", path: "/admin/oauth", heading: "OAuth login" },
  { link: "Security", path: "/admin/security", heading: "Security" },
  {
    link: "Traffic & limits",
    path: "/admin/traffic",
    heading: "Traffic & limits",
  },
  { link: "Demo runner", path: "/admin/demo", heading: "Demo runner" },
  { link: "Public shares", path: "/admin/shares", heading: "Public shares" },
  { link: "Operations", path: "/admin/ops", heading: "Operations" },
  {
    link: "Communications",
    path: "/admin/comms",
    heading: "Communications",
  },
  {
    link: "Announcements",
    path: "/admin/announcements",
    heading: "Announcements",
  },
  {
    link: "Observability",
    path: "/admin/observability",
    heading: "Observability",
  },
];

const OWNER_NAV_RU = [
  { link: "Дашборд", path: "/admin", heading: "Мастер-панель" },
  { link: "Активность", path: "/admin/activity", heading: "Активность" },
  {
    link: "Журнал команд",
    path: "/admin/commands",
    heading: "Журнал команд",
  },
  { link: "Аудит", path: "/admin/audit", heading: "Аудит" },
  { link: "Пользователи", path: "/admin/users", heading: "Пользователи" },
  { link: "Мастера", path: "/admin/masters", heading: "Мастера" },
  { link: "Доски", path: "/admin/boards", heading: "Доски" },
  { link: "Карточки", path: "/admin/cards", heading: "Карточки" },
  { link: "Колонки", path: "/admin/columns", heading: "Колонки" },
  { link: "Метки", path: "/admin/labels", heading: "Метки" },
  { link: "Чек-листы", path: "/admin/checklists", heading: "Чек-листы" },
  {
    link: "Связи карточек",
    path: "/admin/cardLinks",
    heading: "Связи карточек",
  },
  { link: "Комментарии", path: "/admin/comments", heading: "Комментарии" },
  { link: "Вложения", path: "/admin/attachments", heading: "Вложения" },
  { link: "Сессии", path: "/admin/sessions", heading: "Сессии" },
  { link: "API-токены", path: "/admin/tokens", heading: "API-токены" },
  { link: "Email-рассылка", path: "/admin/email", heading: "Email-рассылка" },
  { link: "OAuth-вход", path: "/admin/oauth", heading: "OAuth-вход" },
  { link: "Безопасность", path: "/admin/security", heading: "Безопасность" },
  {
    link: "Трафик и лимиты",
    path: "/admin/traffic",
    heading: "Трафик и лимиты",
  },
  { link: "Демо-запуск", path: "/admin/demo", heading: "Демо-запуск" },
  {
    link: "Публичные ссылки",
    path: "/admin/shares",
    heading: "Публичные ссылки",
  },
  { link: "Эксплуатация", path: "/admin/ops", heading: "Эксплуатация" },
  { link: "Коммуникации", path: "/admin/comms", heading: "Коммуникации" },
  { link: "Объявления", path: "/admin/announcements", heading: "Объявления" },
  {
    link: "Наблюдаемость",
    path: "/admin/observability",
    heading: "Наблюдаемость",
  },
];

test("NAV-1: every owner sidebar entry opens its route and heading", async ({
  page,
}) => {
  test.slow();
  await loginAsMaster(page, ownerCredentials());
  const sidebar = page.getByTestId("admin-sidebar");

  for (const item of OWNER_NAV) {
    await sidebar.getByRole("link", { name: item.link, exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(item.path),
    );
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

test("ADM-X2: all 26 entries work in Russian and the choice survives reload", async ({
  page,
}) => {
  test.slow();
  await loginAsMaster(page, ownerCredentials());
  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitem", { name: "Русский" }).click();
  const sidebar = page.getByTestId("admin-sidebar");

  for (const item of OWNER_NAV_RU) {
    await sidebar.getByRole("link", { name: item.link, exact: true }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname.replace(/\/+$/, "").endsWith(item.path),
    );
    await expect(
      page.getByRole("heading", { name: item.heading, exact: true }),
    ).toBeVisible();
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  const sidebarAfterReload = page.getByTestId("admin-sidebar");
  await expect(
    sidebarAfterReload.getByRole("link", { name: "Дашборд", exact: true }),
  ).toBeVisible();
  await sidebarAfterReload
    .getByRole("link", { name: "Дашборд", exact: true })
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
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", targetUser.email);
  await page.getByTestId(`admin-user-row-${targetUser.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${targetUser.id}$`));

  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Boards", exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${targetUser.id}$`));
  await expect(
    page.getByRole("heading", { name: targetUser.email, exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/users$/);

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${targetUser.id}$`));
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
