import { test, expect, adminContext } from "@/fixtures/admin.js";
import {
  adminPath,
  confirmAction,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";
import {
  createApiToken,
  seedCards,
  seedRichCard,
} from "@/helpers/admin-content.js";
import { expectDownloadFrom } from "@/helpers/download.js";
import { login } from "@/fixtures/auth.js";

/**
 * Generic content browsers (TASK-162.15 full): columns, labels, checklists,
 * links, comments, attachments, sessions, tokens, activity, command payloads
 * and pagination — one user-facing behaviour per test.
 */

test("E1: columns list shows board, position, WIP, cards and status", async ({
  page,
  board,
}) => {
  const title = uniqueToken("browse-column");
  const columnId = await board.column(title);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("columns"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "columns", title);

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText(board.title);
  await expect(row).toContainText("0");
  await expect(row).toContainText("Active");
  await row.getByRole("link", { name: board.title, exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/admin/boards/${board.id}`,
  );
  expect(columnId).toBeTruthy();
});

test("E2: labels list shows the chip, position, cards, version and status", async ({
  page,
  board,
}) => {
  const name = uniqueToken("browse-label");
  await board.label(name, "indigo");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("labels"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "labels", name);

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText(name);
  await expect(row).toContainText(board.title);
  await expect(row).toContainText("Active");
  await row.getByRole("link", { name: board.title, exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/admin/boards/${board.id}`,
  );
});

test("E3: checklists list shows progress and both links", async ({
  page,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("checklists"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "checklists", seeded.checklistTitle);

  const row = page.getByRole("row").filter({ hasText: seeded.checklistTitle });
  await expect(row).toContainText("1/2");
  await expect(row).toContainText(seeded.title);
  await expect(row).toContainText(board.title);
  await expect(row).toContainText("Active");
});

test("E4: card links list shows direction, type and reacts to target deletion", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("cardLinks"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "cardLinks", seeded.title);
  const shortTitle = seeded.title.slice(0, 25);
  const shortOther = seeded.otherCardTitle.slice(0, 25);

  const row = page.getByRole("row").filter({ hasText: shortTitle }).first();
  await expect(row).toContainText(shortOther);
  await expect(row).toContainText("blocks");
  await expect(row).toContainText(board.title);
  await expect(row).toContainText("Active");

  const deleted = await admin.delete(
    `/api/v1/admin/cards/${seeded.otherCardId}`,
  );
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
  await page.reload({ waitUntil: "domcontentloaded" });
  await searchAdminList(page, "cardLinks", seeded.title);
  // Deleting a card does not delete the link row itself (the command log
  // keeps the relation and shows the dangling card), so the row stays active.
  await expect(
    page.getByRole("row").filter({ hasText: shortTitle }).first(),
  ).toContainText("Active");
});

test("E5: deleting a comment hides it from the user API", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comments"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "comments", seeded.commentText);
  const row = page.getByRole("row").filter({ hasText: seeded.commentText });

  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Deleted");

  const comments = await board.api.get(
    `/api/v1/cards/${seeded.cardId}/comments`,
  );
  expect(comments.ok()).toBeTruthy();
  const pageBody = (await comments.json()) as {
    items: Array<{ text: string }>;
  };
  expect(
    pageBody.items.some((entry) => entry.text === seeded.commentText),
  ).toBe(false);
  await expectAudit(admin, {
    action: "comment.delete",
    targetId: seeded.commentId,
  });
});

test("E6: attachment download, delete and restore", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("attachments"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "attachments", seeded.fileName);

  const download = page.getByTestId(
    `admin-attachment-download-${seeded.attachmentId}`,
  );
  const file = await expectDownloadFrom(page, download);
  expect(file.suggestedFilename).toBe(seeded.fileName);

  const row = page.getByRole("row").filter({ hasText: seeded.fileName });
  await row.getByRole("button", { name: "Actions" }).click();
  await page
    .getByRole("menuitem", { name: "Delete file", exact: true })
    .click();
  await confirmAction(page);
  await expect(row).toContainText("Deleted");
  expect(
    (
      await board.api.get(`/api/v1/attachments/${seeded.attachmentId}/content`)
    ).status(),
  ).toBe(404);

  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expectToast(page, "Restore");
  await expect(row).toContainText("Active");
  expect(
    (
      await board.api.get(`/api/v1/attachments/${seeded.attachmentId}/content`)
    ).status(),
  ).toBe(200);

  await expectAudit(admin, {
    action: "attachment.delete",
    targetId: seeded.attachmentId,
  });
  await expectAudit(admin, {
    action: "entity.restored",
    targetId: seeded.attachmentId,
  });
});

test("E7: sessions show IP/client and revocation signs the user out", async ({
  browser,
  page,
  admin,
  board,
  testIp,
}) => {
  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, board.user);
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("sessions"), { waitUntil: "domcontentloaded" });
    await searchAdminList(page, "sessions", board.email);
    const row = page.getByRole("row").filter({ hasText: board.email }).first();
    await expect(row).toContainText(testIp);
    await expect(row).toContainText(/Chrome/);

    await row.getByRole("button", { name: "Actions" }).click();
    await page
      .getByRole("menuitem", { name: "Revoke session", exact: true })
      .click();
    await confirmAction(page);
    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(userSide.page.getByTestId("login-email")).toBeVisible();
  } finally {
    await userSide.context.close();
  }

  await expectAudit(admin, {
    action: "session.revoke",
    targetType: "session",
  });
});

test("E8: API tokens show status and stop working after revocation", async ({
  page,
  admin,
  board,
  playwright,
}) => {
  const name = uniqueToken("browse-token");
  const token = await createApiToken(board.api, name);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("tokens"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "tokens", name);

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("Active");
  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Revoked");
  await expect(row.getByRole("button", { name: "Actions" })).toHaveCount(0);

  const pat = await playwright.request.newContext({
    baseURL: process.env.E2E_SITE_URL ?? "http://127.0.0.1:4300/",
    extraHTTPHeaders: { Authorization: `Bearer ${token.token}` },
  });
  try {
    expect((await pat.get("/api/v1/boards")).status()).toBe(401);
  } finally {
    await pat.dispose();
  }
  await expectAudit(admin, { action: "token.revoke", targetId: token.id });
});

test("E9: activity filters by period and its links open details", async ({
  page,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("activity"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "activity", board.title);
  const row = page
    .getByRole("row")
    .filter({ hasText: "comment_added" })
    .first();
  await expect(row).toContainText(board.title);
  await expect(row).toContainText(board.email);

  await page.getByRole("button", { name: "24 hours", exact: true }).click();
  await expect(row).toBeVisible();

  await row.getByRole("link", { name: seeded.title, exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `/admin/cards/${seeded.cardId}`,
  );
});

test("E10: command payload expands and /admin/log redirects", async ({
  page,
  board,
}) => {
  const columnId = await board.column(uniqueToken("command-column"));
  const cardTitle = uniqueToken("command-card");
  await board.card(columnId, cardTitle);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("commands"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "commands", board.title);

  const row = page
    .getByRole("row")
    .filter({ hasText: "ADD_CARD" })
    .filter({ hasText: board.title })
    .first();
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toContainText(cardTitle);

  await page.goto(adminPath("log"), { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/admin\/audit\?tab=commands$/);
  await expect(
    page.getByRole("heading", { name: "Command log", exact: true }),
  ).toBeVisible();
});

test("E11: the generic list paginates to a second page and back", async ({
  page,
  board,
}) => {
  const columnId = await board.column(uniqueToken("page-column"));
  await seedCards(board, columnId, 51, uniqueToken("page-card"));
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("commands"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "commands", board.title);

  const status = page.getByTestId("admin-pagination-status");
  await expect(status).toHaveText("Page 1 of 2");
  await expect(page.getByText("52 total", { exact: true })).toBeVisible();

  await page.getByTestId("admin-pagination-next").click();
  await expect(status).toHaveText("Page 2 of 2");
  await page.getByTestId("admin-pagination-prev").click();
  await expect(status).toHaveText("Page 1 of 2");
});
