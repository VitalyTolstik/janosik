import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";

/**
 * Board content editor (TASK-162.15 full): columns and cards are created,
 * renamed, archived and deleted through the command log on behalf of the owner.
 */

test("B11: adding a column and a card appends both commands", async ({
  page,
  admin,
  board,
}) => {
  const columnTitle = uniqueToken("content-column");
  const cardTitle = uniqueToken("content-card");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}/content`), {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("admin-new-column").fill(columnTitle);
  await page.getByTestId("admin-add-column").click();
  const column = page.getByRole("button", { name: new RegExp(columnTitle) });
  await expect(column).toBeVisible();
  await column.click();

  await page.getByTestId("admin-new-card").fill(cardTitle);
  await page.getByTestId("admin-add-card").click();
  await expect(page.getByText(cardTitle, { exact: true })).toBeVisible();

  await page.goto(adminPath("commands"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "commands", board.title);
  for (const type of ["ADD_COLUMN", "ADD_CARD"]) {
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: board.title })
        .filter({ hasText: type })
        .first(),
    ).toBeVisible();
  }
});

test("B12: renaming a column and a card updates titles and commands", async ({
  page,
  board,
}) => {
  const columnId = await board.column(uniqueToken("rename-column"));
  const cardId = await board.card(columnId, uniqueToken("rename-card"));
  const nextColumn = uniqueToken("column-renamed");
  const nextCard = uniqueToken("card-renamed");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}/content`), {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId(`admin-column-rename-${columnId}`).click();
  const columnInput = page.getByTestId(`admin-column-rename-input-${columnId}`);
  await columnInput.fill(nextColumn);
  await columnInput.press("Enter");
  await expect(
    page.getByRole("button", { name: new RegExp(nextColumn) }),
  ).toBeVisible();

  await page.getByTestId(`admin-card-rename-${cardId}`).click();
  const cardInput = page.getByTestId(`admin-card-rename-input-${cardId}`);
  await cardInput.fill(nextCard);
  await cardInput.press("Enter");
  await expect(page.getByText(nextCard, { exact: true })).toBeVisible();

  await page.goto(adminPath("commands"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "commands", board.title);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: board.title })
      .filter({ hasText: "RENAME_COLUMN" })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: board.title })
      .filter({ hasText: "UPDATE_CARD" })
      .first(),
  ).toBeVisible();
});

test("B13: archiving a card removes it and records ARCHIVE_CARD", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column(uniqueToken("archive-column"));
  const cardTitle = uniqueToken("archive-card");
  const cardId = await board.card(columnId, cardTitle);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}/content`), {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: new RegExp("archive-column") })
    .click();
  await expect(page.getByText(cardTitle, { exact: true })).toBeVisible();

  await page.getByTestId(`admin-card-archive-${cardId}`).click();
  await expectToast(page, "Card archived");
  await expect(page.getByText(cardTitle, { exact: true })).toHaveCount(0);

  const detail = await admin.get(`/api/v1/admin/cards/${cardId}/detail`);
  expect(detail.ok(), await detail.text()).toBeTruthy();
  const body = (await detail.json()) as { card: { archivedAt: number | null } };
  expect(body.card.archivedAt).not.toBeNull();

  await expectAudit(admin, { action: "board.command", targetId: board.id });
});

test("B14: deleting a column with cards removes both and records DELETE_COLUMN", async ({
  page,
  admin,
  board,
}) => {
  const columnTitle = uniqueToken("delete-column");
  const columnId = await board.column(columnTitle);
  const cardId = await board.card(columnId, uniqueToken("delete-card"));
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}/content`), {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId(`admin-column-delete-${columnId}`).click();
  await page.getByTestId("admin-confirm-accept").click();
  await expectToast(page, "Column deleted");
  await expect(
    page.getByRole("button", { name: new RegExp(columnTitle) }),
  ).toHaveCount(0);
  await expect(page.getByTestId(`admin-card-archive-${cardId}`)).toHaveCount(0);

  const detail = await admin.get(`/api/v1/admin/cards/${cardId}/detail`);
  if (detail.ok()) {
    const body = (await detail.json()) as {
      card: { deletedAt: number | null };
    };
    expect(body.card.deletedAt).not.toBeNull();
  } else {
    expect(detail.status()).toBe(404);
  }

  await page.goto(adminPath("commands"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "commands", board.title);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: board.title })
      .filter({ hasText: "DELETE_COLUMN" })
      .first(),
  ).toBeVisible();
});
