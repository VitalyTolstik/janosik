import { test, expect } from "@/fixtures/member.js";
import {
  cardDialog,
  cardTitle,
  closeCardDialog,
  expectHistory,
  notification,
  openCard,
  pressUndo,
  undo,
} from "@/helpers/history.js";

const FOREIGN_SKIP = "Another member changed this — undo was skipped";

test("undo skips a card edit overtaken by another member", async ({
  page,
  board,
  member,
}) => {
  const column = await board.column("Todo");
  const cardId = await board.card(column, "Shared task");
  await board.open(page);

  await openCard(page, "Shared task");
  await cardDialog(page)
    .getByRole("textbox", { name: "Title" })
    .fill("Local title");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "UPDATE_CARD",
  );
  await closeCardDialog(page);
  await saved;
  await expect(cardTitle(page, "Local title")).toBeVisible({ timeout: 15000 });

  await member.command({ type: "UPDATE_CARD", cardId, title: "Member title" });
  await expect(cardTitle(page, "Member title")).toBeVisible({ timeout: 15000 });

  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(cardTitle(page, "Member title")).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });
});

test("undo leaves an unrelated foreign card edit untouched", async ({
  page,
  board,
  member,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "Card A");
  const cardB = await board.card(column, "Card B");
  await board.open(page);

  await openCard(page, "Card A");
  await cardDialog(page)
    .getByRole("textbox", { name: "Title" })
    .fill("Local A");
  await closeCardDialog(page);
  await expect(cardTitle(page, "Local A")).toBeVisible({ timeout: 15000 });

  await member.command({
    type: "UPDATE_CARD",
    cardId: cardB,
    title: "Member B",
  });
  await expect(cardTitle(page, "Member B")).toBeVisible({ timeout: 15000 });

  await undo(page);
  await expect(cardTitle(page, "Card A")).toBeVisible();
  await expect(cardTitle(page, "Member B")).toBeVisible();
});

test("undo skips a board rename overtaken by another member", async ({
  page,
  board,
  member,
}) => {
  await board.open(page);

  await page.locator("header h2").click();
  await page.locator('[name="board-title-edit"]').fill("Local board");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "RENAME_BOARD",
  );
  await page.locator('[name="board-title-edit"]').press("Enter");
  await saved;
  await expect(page.getByRole("heading", { name: "Local board" })).toBeVisible({
    timeout: 15000,
  });

  await member.command({ type: "RENAME_BOARD", title: "Member board" });
  await expect(page.getByRole("heading", { name: "Member board" })).toBeVisible(
    { timeout: 15000 },
  );

  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Member board" }),
  ).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });
});
