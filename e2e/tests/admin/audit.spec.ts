import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  createMasterViaAdmin,
  createUserViaAdmin,
  expectAudit,
  loginAsMaster,
  openAdminLogin,
  ownerCredentials,
  searchAdminList,
  submitAdminLogin,
  uniqueToken,
} from "@/helpers/admin.js";
import { addComment, seedRichCard } from "@/helpers/admin-content.js";

/**
 * Audit and security events (TASK-162.15 full): successful/failed sign-ins,
 * user moderation, period/search/target/detail rendering, the master link,
 * impersonation and the mutation-family matrix.
 */

test("records a successful master sign-in in the audit trail", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", operator.email);

  const row = page
    .getByRole("row")
    .filter({ hasText: operator.email })
    .filter({ has: page.getByText("admin.login", { exact: true }) });
  await expect(row).toBeVisible();
});

test("shows a failed master sign-in in suspicious activity", async ({
  page,
  admin,
  testIp,
}) => {
  const operator = await createMasterViaAdmin(admin);

  await openAdminLogin(page);
  await submitAdminLogin(page, {
    email: operator.email,
    password: "definitely-wrong-password",
  });
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Invalid credentials",
  );
  await submitAdminLogin(page, operator);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });

  const alerts = page.getByTestId("admin-security-alerts");
  await expect(alerts).toContainText(operator.email);
  const alert = alerts
    .getByText(operator.email, { exact: true })
    .locator("xpath=..");
  await expect(alert).toContainText("Wrong password");
  await expect(alert).toContainText(testIp);
});

test("records blocking a user in the audit trail", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const blocked = await admin.patch(`/api/v1/admin/users/${user.id}`, {
    data: { disabled: true },
  });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", user.id);

  const row = page
    .getByRole("row")
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) })
    .filter({ has: page.getByText("user.disable", { exact: true }) });
  await expect(row).toBeVisible();
});

test("records deleting a user in the audit trail", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const removed = await admin.delete(`/api/v1/admin/users/${user.id}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", user.id);

  const row = page
    .getByRole("row")
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) })
    .filter({ has: page.getByText("user.delete", { exact: true }) });
  await expect(row).toBeVisible();
});

test("F1: audit period tabs, target search and JSON details", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  const blocked = await admin.patch(`/api/v1/admin/users/${user.id}`, {
    data: { disabled: true },
  });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", user.id);

  const row = page
    .getByRole("row")
    .filter({ hasText: "user.disable" })
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) });
  await expect(row).toContainText("user");
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toContainText(user.email);

  await page.getByRole("button", { name: "24 hours", exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(row).toBeVisible();
});

test("F2: an audit master link opens Masters and survives master deletion", async ({
  page,
  admin,
}) => {
  const master = await createMasterViaAdmin(admin);
  await loginAsMaster(page, master);
  await page.getByTestId("admin-logout").click();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", master.email);
  // The action cell is an exact badge: a substring filter also matches
  // `admin.login_failed` and other rows that reference the same email.
  const row = page
    .getByRole("row")
    .filter({ hasText: master.email })
    .filter({ has: page.getByText("admin.login", { exact: true }) });
  const link = row.getByRole("link", { name: master.email, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname.endsWith("/admin/access") &&
      url.searchParams.get("tab") === "masters" &&
      url.searchParams.get("returnTo")?.startsWith("/admin/audit?") === true
    );
  });
  await expect(
    page.getByRole("heading", { name: "Masters", exact: true }),
  ).toBeVisible();

  const removed = await admin.delete(`/api/v1/admin/admins/${master.id}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", master.email);
  const kept = page
    .getByRole("row")
    .filter({ hasText: master.email })
    .filter({ has: page.getByText("admin.login", { exact: true }) });
  await expect(kept).toContainText(master.email);
  await expect(kept.getByTestId(`admin-copy-${master.email}`)).toBeVisible();
  await expect(
    kept.getByRole("link", { name: master.email, exact: true }),
  ).toHaveCount(0);
});

test("F3: impersonation is recorded with master and target", async ({
  page,
  admin,
  targetUser,
}) => {
  const board = await admin.post("/api/v1/admin/boards", {
    data: {
      title: uniqueToken("audit-impersonation"),
      ownerEmail: targetUser.email,
    },
  });
  expect(board.ok(), await board.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${targetUser.id}`), {
    waitUntil: "domcontentloaded",
  });

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-impersonate").click();
  const popup = await popupPromise;
  await popup.close();

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", targetUser.id);
  const row = page
    .getByRole("row")
    .filter({ hasText: "user.impersonated" })
    .filter({ has: page.getByTestId(`admin-id-${targetUser.id}`) });
  await expect(row).toContainText(ownerCredentials().email);
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toBeVisible();
});

test("ADM-X7: each mutation family writes its own audit action", async ({
  page,
  admin,
  board,
}) => {
  const verified = await createUserViaAdmin(admin, { verified: false });
  await admin.patch(`/api/v1/admin/users/${verified.id}`, {
    data: { emailVerified: true },
  });
  await admin.post(`/api/v1/admin/users/${verified.id}/password/reset`, {
    data: {},
  });
  const seed = await seedRichCard(board);
  await admin.delete(`/api/v1/admin/attachments/${seed.attachmentId}`);
  const announcementTitle = uniqueToken("audit-family");
  const announcement = await admin.post("/api/v1/admin/announcements", {
    data: {
      title: announcementTitle,
      body: `Body ${announcementTitle}`,
      level: "info",
      audience: "segment",
      segment: "nobody@e2e.example",
      sendEmail: false,
    },
  });
  const announcementBody = (await announcement.json()) as { id: string };
  const share = await board.api.post(`/api/v1/boards/${board.id}/shares`, {
    data: { mode: "live" },
  });
  const shareBody = (await share.json()) as { id: string };
  await admin.post(`/api/v1/admin/shares/${shareBody.id}/revoke`, {
    data: {},
  });

  for (const expectation of [
    { action: "user.verified", targetId: verified.id },
    { action: "user.password_reset", targetId: verified.id },
    { action: "attachment.delete", targetId: seed.attachmentId },
    { action: "announcement.created", targetId: announcementBody.id },
    { action: "share.revoked", targetId: shareBody.id },
  ]) {
    await expectAudit(admin, expectation);
  }

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", seed.attachmentId);
  await expect(
    page.getByRole("row").filter({ hasText: "attachment.delete" }),
  ).toContainText("attachment");
});

test("F4: a commandId deep link opens exactly the correlated audit row", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column(uniqueToken("audit-command-column"));
  const cardId = await board.card(columnId, uniqueToken("audit-command-card"));
  const commandId = randomUUID();
  const command = await admin.post(
    `/api/v1/admin/boards/${board.id}/commands`,
    {
      data: {
        commandId,
        action: {
          type: "UPDATE_CARD",
          cardId,
          description: "Audit deep link",
          at: Date.now(),
        },
      },
    },
  );
  expect(command.status(), await command.text()).toBe(201);

  await loginAsMaster(page, ownerCredentials());
  await page.goto(
    `${adminPath("audit")}?tab=audit&commandId=${encodeURIComponent(commandId)}`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.getByTestId("admin-filter-clear-commandId")).toBeVisible();
  await expect(page.getByText(commandId, { exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "board.command" });
  await expect(row).toHaveCount(1);
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toContainText(commandId);
  await expect(row.locator("pre")).toContainText(ownerCredentials().email);
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname.endsWith("/admin/audit") &&
      url.searchParams.get("tab") === "audit" &&
      url.searchParams.get("commandId") === commandId
    );
  });

  await page.goto(
    `${adminPath("audit")}?tab=commands&commandId=${commandId}&type=UPDATE_CARD&boardId=${board.id}`,
  );
  await page.getByTestId(`admin-command-audit-${commandId}`).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("tab") === "audit" &&
      url.searchParams.get("commandId") === commandId &&
      url.searchParams.get("returnTo")?.includes("type=UPDATE_CARD") === true,
  );
  await expect(row).toHaveCount(1);
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toContainText(commandId);
});

async function expectWithinWidth(control: Locator, width: number) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  return box!;
}

for (const { width, lang } of [
  { width: 1440, lang: "en" },
  { width: 1024, lang: "ru" },
  { width: 390, lang: "ru" },
]) {
  test(`operator filters the audit trail at ${width}px in ${lang}`, async ({
    page,
    admin,
    operator,
    targetUser,
  }) => {
    const blocked = await admin.patch(`/api/v1/admin/users/${targetUser.id}`, {
      data: { disabled: true },
    });
    expect(blocked.ok(), await blocked.text()).toBeTruthy();
    await loginAsMaster(page, operator);
    await page.goto(`${adminPath("audit")}?tab=audit&offset=1`);
    if (lang === "ru") {
      await page.getByRole("button", { name: "Change language" }).click();
      await page.getByRole("menuitem", { name: "Русский" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    }
    await page.setViewportSize({ width, height: 844 });
    const ru = lang === "ru";
    const master = ru ? "Мастер" : "Master";
    const action = ru ? "Действие" : "Action";
    const targetType = ru ? "Тип цели" : "Target type";
    const targetId = ru ? "ID цели" : "Target ID";
    const apply = ru ? "Применить" : "Apply";
    const trigger = page.getByRole("button", {
      name: ru ? /^Фильтры( \d+)?$/ : /^Filters( \d+)?$/,
    });
    const dialog = page.getByRole("dialog", {
      name: ru ? "Фильтры журнала аудита" : "Filters for the audit trail",
    });
    const open = async (facet: string) => {
      await trigger.focus();
      await trigger.press("Enter");
      await expect(dialog).toBeVisible();
      const button = dialog.getByRole("button", { name: facet, exact: true });
      const bounds = await expectWithinWidth(button, width);
      expect(bounds.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
      await button.press("Enter");
    };
    const select = async (
      facet: string,
      query: string,
      name: string | RegExp,
    ) => {
      await open(facet);
      const input = dialog.getByRole("searchbox", {
        name: `${ru ? "Найти значение" : "Search options"} — ${facet}`,
      });
      await expect(input).toBeFocused();
      await expectWithinWidth(input, width);
      await input.fill(query);
      const option = dialog.getByRole("checkbox", { name });
      const row = await expectWithinWidth(option.locator(".."), width);
      expect(row.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
      await option.press("Space");
      await expect(option).toBeChecked();
      const submit = dialog.getByRole("button", { name: apply, exact: true });
      await expectWithinWidth(submit, width);
      await submit.press("Enter");
      await expect(trigger).toBeFocused();
    };

    for (const name of ["audit", "commands", "activity"]) {
      await expectWithinWidth(page.getByTestId(`admin-hub-tab-${name}`), width);
    }
    await trigger.press("Space");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    const { email } = ownerCredentials();
    await select(master, email, new RegExp(email));
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.has("adminId") && !url.searchParams.has("offset"),
    );
    await select(action, "user.disable", "user.disable");
    await select(targetType, "user", "user");
    await open(targetId);
    const id = dialog.getByRole("textbox", { name: targetId, exact: true });
    await expectWithinWidth(id, width);
    await id.fill(targetUser.id);
    await id.press("Enter");

    const periods = ru
      ? ["За всё время", "24 часа", "7 дней", "30 дней"]
      : ["Any time", "24 hours", "7 days", "30 days"];
    for (const label of periods)
      await expectWithinWidth(
        page.getByRole("button", { name: label, exact: true }),
        width,
      );
    await page.getByRole("button", { name: periods[3], exact: true }).click();
    const results = page.getByTestId("admin-filter-results");
    await expect(results).toHaveText(
      ru
        ? "Фильтры применены · Результатов: 1"
        : "Filters applied · Results: 1",
    );
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("period") === "30d" &&
        url.searchParams.get("targetId") === targetUser.id,
    );
    const row = page
      .getByRole("row")
      .filter({ has: page.getByTestId(`admin-id-${targetUser.id}`) });
    await expect(row).toContainText(email);
    await expect(
      row.getByRole("link", { name: email, exact: true }),
    ).toHaveCount(0);
    const chips = ["adminId", "action", "targetType", "targetId"];
    for (const key of chips) {
      const chip = await expectWithinWidth(
        page.getByTestId(`admin-filter-${key}`),
        width,
      );
      expect(chip.width).toBeLessThanOrEqual(Math.min(320, width - 32));
      const remove = await expectWithinWidth(
        page.getByTestId(`admin-filter-clear-${key}`),
        width,
      );
      expect(remove.width).toBeGreaterThanOrEqual(24);
      expect(remove.height).toBeGreaterThanOrEqual(24);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.reload();
    await expect(results).toContainText(/1$/);
    await page.getByTestId("admin-filter-clear-action").press("Enter");
    await expect(
      page.getByTestId("admin-filter-clear-targetType"),
    ).toBeFocused();
    await expect(page).toHaveURL(
      (url) =>
        !url.searchParams.has("action") && url.searchParams.has("adminId"),
    );
  });
}

test("operator can filter commands and activity on the same board", async ({
  page,
  board,
  operator,
}) => {
  const columnId = await board.column(uniqueToken("filter-column"));
  const cardId = await board.card(columnId, uniqueToken("filter-card"));
  await addComment(board.api, cardId, "Audit hub activity fixture");
  await loginAsMaster(page, operator);
  const scope = new URLSearchParams({
    tab: "commands",
    boardId: board.id,
    cardId,
    columnId,
    actorId: board.userId,
    type: "ADD_CARD",
    period: "24h",
  });
  await page.goto(`${adminPath("audit")}?${scope}`);
  const results = page.getByTestId("admin-filter-results");
  await expect(results).toHaveText("Filters applied · Results: 1");
  for (const key of ["boardId", "cardId", "columnId", "actorId", "type"])
    await expect(page.getByTestId(`admin-filter-${key}`)).toBeVisible();
  await page.getByTestId("admin-hub-tab-activity").click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("boardId") === board.id &&
      !url.searchParams.has("type"),
  );
  await page.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filters for activity" });
  await dialog.getByRole("button", { name: "Event", exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "comment_added", exact: true })
    .check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(results).toHaveText("Filters applied · Results: 1");
  await expect(
    page.getByRole("row").filter({ hasText: "comment_added" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("admin-filter-type")).toContainText(
    "comment_added",
  );
});
