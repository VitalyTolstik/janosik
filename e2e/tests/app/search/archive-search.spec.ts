import { test, expect } from "@/fixtures/board.js";
import {
  archiveCard,
  archiveSearchInput,
  openArchive,
} from "@/helpers/search.js";

test("opens the archive and lists only archived cards", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Active task");
  const archivedId = await board.card(todo, "Archived task");
  await archiveCard(board, archivedId);
  await board.open(page);

  const dialog = await openArchive(page);

  await expect(dialog.getByTestId("archive-row")).toHaveCount(1);
  await expect(dialog.getByTestId("archive-row")).toContainText(
    "Archived task",
  );
  await expect(dialog).not.toContainText("Active task");
  await expect(archiveSearchInput(page)).toBeVisible();
});

test("filters archive rows by title regardless of case and whitespace", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const alphaId = await board.card(todo, "Archived Alpha");
  const betaId = await board.card(todo, "Archived Beta");
  await archiveCard(board, alphaId);
  await archiveCard(board, betaId);
  await board.open(page);
  const dialog = await openArchive(page);

  await archiveSearchInput(page).fill("  aLpHa  ");

  await expect(dialog.getByTestId("archive-row")).toHaveCount(1);
  await expect(dialog.getByTestId("archive-row")).toContainText(
    "Archived Alpha",
  );
  await expect(dialog).not.toContainText("Archived Beta");
});

test("shows an empty result for an archive query that matches nothing", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const archivedId = await board.card(todo, "Archived task");
  await archiveCard(board, archivedId);
  await board.open(page);
  const dialog = await openArchive(page);

  await archiveSearchInput(page).fill("no-such-archive-hit");

  await expect(dialog.getByTestId("archive-row")).toHaveCount(0);
  await expect(dialog.getByTestId("archive-list")).toContainText(
    "Nothing found.",
  );
});

test("shows the empty archive state when nothing is archived", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Active task");
  await board.open(page);

  const dialog = await openArchive(page);

  await expect(dialog).toContainText("The archive is empty.");
  await expect(archiveSearchInput(page)).toHaveCount(0);
});

test("clears the archive query when the dialog is reopened", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const alphaId = await board.card(todo, "Archived Alpha");
  const betaId = await board.card(todo, "Archived Beta");
  await archiveCard(board, alphaId);
  await archiveCard(board, betaId);
  await board.open(page);
  const dialog = await openArchive(page);
  await archiveSearchInput(page).fill("Alpha");
  await expect(dialog.getByTestId("archive-row")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const reopened = await openArchive(page);

  await expect(archiveSearchInput(page)).toHaveValue("");
  await expect(reopened.getByTestId("archive-row")).toHaveCount(2);
});

test("opens an archived card from the archive search results", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Open me");
  await archiveCard(board, cardId);
  await board.open(page);
  const dialog = await openArchive(page);

  await dialog
    .getByTestId("archive-row")
    .filter({ hasText: "Open me" })
    .getByTestId("archive-row-title")
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}`),
  );
  const cardDialog = page.getByRole("dialog", { name: "Card details" });
  await expect(cardDialog).toBeVisible();
  await expect(cardDialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Open me",
  );
  await expect(dialog).toBeHidden();
});
