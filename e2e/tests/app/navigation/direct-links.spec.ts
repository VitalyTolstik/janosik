import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/navigation.js";
import { createExtraBoard } from "@/helpers/boards.js";
import { expectToast } from "@/helpers/data.js";
import { cardDialog, cardTitle } from "@/helpers/history.js";
import { boardLink } from "@/helpers/navigation.js";

test("opens the requested board from a direct link with several boards", async ({
  page,
  board,
  navigation,
}) => {
  const columnId = await board.column("Direct link");
  await board.card(columnId, "Requested board card");
  await createExtraBoard(board.api, `Newest board ${randomUUID()}`);

  await navigation.signInAt(page, navigation.boardUrl);

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();
  await expect(cardTitle(page, "Requested board card")).toBeVisible();
});

test("opens a card direct link after signing in", async ({
  page,
  board,
  navigation,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Shared card");

  await navigation.signInAt(page, navigation.cardUrl(cardId));

  const dialog = cardDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Shared card",
  );
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
});

test("keeps the card dialog open after a reload", async ({
  page,
  board,
  navigation,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Reload card");
  await board.open(page);
  await page.goto(navigation.cardUrl(cardId));
  await expect(cardDialog(page)).toBeVisible();

  await page.reload();

  const dialog = cardDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Reload card",
  );
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
});

test("closes the card dialog with browser Back and reopens it with Forward", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "History card");
  await board.open(page);
  await cardTitle(page, "History card").click();
  await expect(cardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );

  await page.goBack();
  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));

  await page.goForward();
  await expect(cardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
});

test("drops a card link that no longer resolves", async ({
  page,
  board,
  navigation,
}) => {
  await board.open(page);

  await page.goto(navigation.cardUrl(randomUUID()));

  await expectToast(page, "Card not found");
  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
});

test("refuses a prototype property as a card id", async ({
  page,
  board,
  navigation,
}) => {
  await board.open(page);

  await page.goto(`${navigation.boardUrl}?card=constructor`);

  await expectToast(page, "Card not found");
  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
});

test("does not open a prototype property from an archived board", async ({
  page,
  board,
  navigation,
}) => {
  const archived = await createExtraBoard(
    board.api,
    `Archived board ${randomUUID()}`,
  );
  await archived.command({ type: "ARCHIVE_BOARD" });

  await navigation.signInAt(page, `${boardLink(archived.id)}?card=constructor`);

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(cardDialog(page)).toBeHidden();
});

test("redirects a direct link to an archived board to an active board", async ({
  page,
  board,
  navigation,
}) => {
  const archived = await createExtraBoard(
    board.api,
    `Archived board ${randomUUID()}`,
  );
  await archived.command({ type: "ARCHIVE_BOARD" });

  await navigation.signInAt(page, boardLink(archived.id));

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: archived.title })).toHaveCount(
    0,
  );
});

test("keeps a dead archived-card deep link inert and explains the redirect", async ({
  page,
  board,
  navigation,
}) => {
  const archived = await createExtraBoard(
    board.api,
    `Archived board ${randomUUID()}`,
  );
  await archived.command({ type: "ARCHIVE_BOARD" });
  const deadCard = randomUUID();

  await navigation.signInAt(page, `${boardLink(archived.id)}?card=${deadCard}`);

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expectToast(page, "Card not found");
  await expect(cardDialog(page)).toBeHidden();
  expect(new URL(page.url()).searchParams.get("card")).toBeNull();
});

test("shows a board not found page for an unknown direct link", async ({
  page,
  navigation,
}) => {
  const unknownId = randomUUID();

  await navigation.signInAt(page, boardLink(unknownId));

  await expect(
    page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/board/${unknownId}$`));
});

test("returns to a board from the not found page", async ({
  page,
  board,
  navigation,
}) => {
  await navigation.signInAt(page, boardLink(randomUUID()));

  await page.getByTestId("not-found-back").click();

  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(page.getByRole("heading", { name: board.title })).toBeVisible();
});

test("opens a board card in a new tab with Ctrl+click", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "New tab card");
  await board.open(page);

  const popupPromise = page.waitForEvent("popup");
  await cardTitle(page, "New tab card").click({ modifiers: ["Control"] });
  const popup = await popupPromise;

  await expect(popup).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
  await expect(cardDialog(popup)).toBeVisible();
  await expect(cardDialog(page)).toBeHidden();
  await popup.close();
});

test("opens a table row in a new tab with Ctrl+click", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Table new tab card");
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Table" })
    .click();

  const row = page
    .getByTestId("table-row")
    .filter({ hasText: "Table new tab card" });
  const popupPromise = page.waitForEvent("popup");
  await row.getByText("Table new tab card", { exact: true }).click({
    modifiers: ["Control"],
  });
  const popup = await popupPromise;

  await expect(popup).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
  await expect(cardDialog(popup)).toBeVisible();
  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await popup.close();
});

test("opens a calendar chip in a new tab with Ctrl+click", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Calendar new tab card");
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: Date.now(),
  });
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Calendar" })
    .click();

  const chip = page
    .getByTestId("calendar-chip")
    .filter({ hasText: "Calendar new tab card" });
  const popupPromise = page.waitForEvent("popup");
  await chip.click({ modifiers: ["Control"] });
  const popup = await popupPromise;

  await expect(popup).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
  await expect(cardDialog(popup)).toBeVisible();
  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await popup.close();
});

test("removes the card link when the dialog is closed", async ({
  page,
  board,
  navigation,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Cleared link card");
  await board.open(page);
  await page.goto(navigation.cardUrl(cardId));
  await expect(cardDialog(page)).toBeVisible();

  await cardDialog(page)
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();

  await expect(cardDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await page.reload();
  await expect(cardDialog(page)).toBeHidden();
});
