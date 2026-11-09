import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import {
  cardDialog,
  cardOrder,
  cardTitle,
  closeCardDialog,
  columnSection,
  descriptionEditor,
  expectHistory,
  openCard,
  redo,
  undo,
} from "@/helpers/history.js";
import { addChecklistItem, openArchive } from "@/helpers/search.js";

test.describe.configure({ timeout: 60_000 });

test("one undo restores a whole title editing session", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  await board.card(column, "Original title");
  await board.open(page);

  await openCard(page, "Original title");
  const dialog = cardDialog(page);
  const title = dialog.getByRole("textbox", { name: "Title" });
  await title.focus();
  await title.pressSequentially("New title", { delay: 30 });
  await closeCardDialog(page);
  await expect(cardTitle(page, "New title")).toBeVisible();

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(cardTitle(page, "Original title")).toBeVisible();
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(cardTitle(page, "New title")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo a card move between columns", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.column("Doing");
  await board.card(todo, "Move task");
  await board.open(page);

  const source = await columnSection(page, "Todo")
    .getByTestId("card-title")
    .filter({ hasText: "Move task" })
    .boundingBox();
  const target = await columnSection(page, "Doing")
    .getByTestId("column-card-scroll")
    .boundingBox();
  if (!source || !target)
    throw new Error("Card or target column is not visible");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 10,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(target.x + target.width / 2, target.y + 50, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Move task");

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Move task");
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Move task");
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo the card description", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Described task");
  await board.open(page);

  await openCard(page, "Described task");
  const editor = descriptionEditor(page);
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.fill("My description");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (
        response.request().postDataJSON() as {
          action?: { type?: string; description?: string };
        }
      ).action?.type === "UPDATE_CARD" &&
      (
        response.request().postDataJSON() as {
          action?: { description?: string };
        }
      ).action?.description === "My description",
  );
  await closeCardDialog(page);
  await saved;
  await expectHistory(page, { undo: true, redo: false });

  const description = async (): Promise<string> => {
    const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
    const aggregate = (await snapshot.json()) as {
      cards: Record<string, { description?: string }>;
    };
    return aggregate.cards[cardId].description ?? "";
  };

  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await expect.poll(description).toBe("");
  await openCard(page, "Described task");
  await expect(descriptionEditor(page)).toHaveText("");
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await expect.poll(description).toBe("My description");
  await openCard(page, "Described task");
  await expect(descriptionEditor(page)).toHaveText("My description");
  await closeCardDialog(page);

  await page.reload();
  await expect(columnSection(page, "Work")).toBeVisible();
  await openCard(page, "Described task");
  await expect(descriptionEditor(page)).toHaveText("My description");
  await closeCardDialog(page);
  await expectHistory(page, { undo: false, redo: false });
});

test("undo and redo a card reorder inside one column", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "First task");
  await board.card(todo, "Second task");
  await board.open(page);
  await expect
    .poll(() => cardOrder(page, "Todo"))
    .toEqual(["First task", "Second task"]);

  const first = await columnSection(page, "Todo")
    .getByTestId("card-title")
    .filter({ hasText: "First task" })
    .boundingBox();
  const second = await columnSection(page, "Todo")
    .getByTestId("card-title")
    .filter({ hasText: "Second task" })
    .boundingBox();
  if (!first || !second)
    throw new Error("Cards or the target column are not visible");
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    first.x + first.width / 2,
    first.y + first.height / 2 + 8,
    { steps: 3 },
  );
  await page.mouse.move(second.x + second.width / 2, second.y + 60, {
    steps: 20,
  });
  await page.mouse.up();
  await expect
    .poll(() => cardOrder(page, "Todo"))
    .toEqual(["Second task", "First task"]);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect
    .poll(() => cardOrder(page, "Todo"))
    .toEqual(["First task", "Second task"]);
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect
    .poll(() => cardOrder(page, "Todo"))
    .toEqual(["Second task", "First task"]);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo a card moved from the dialog's column row", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.column("Doing");
  await board.card(todo, "Move task");
  await board.open(page);

  await openCard(page, "Move task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Todo", exact: true }).click();
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Doing", exact: true }),
  ).toBeVisible();
  await closeCardDialog(page);
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Move task");

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Move task");
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Move task");
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo card duplication", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  await board.open(page);

  await openCard(page, /^Task$/);
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate card" }).click();
  await expect(cardTitle(page, /^Copy of Task$/)).toBeVisible();

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(cardTitle(page, /^Copy of Task$/)).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(cardTitle(page, /^Copy of Task$/)).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("three undo steps replay add, rename and move in reverse order", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.column("Doing");
  await board.open(page);

  const section = columnSection(page, "Todo");
  await section.locator("[data-composer-trigger]").click();
  const composer = section.locator('[name="card-composer"]');
  await composer.fill("Step one");
  await composer.press("Enter");
  await expect(cardTitle(page, "Step one")).toBeVisible();
  await page.keyboard.press("Escape");

  await openCard(page, "Step one");
  const dialog = cardDialog(page);
  await dialog.getByRole("textbox", { name: "Title" }).fill("Step two");
  const titleSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { title?: string } })
        .action?.title === "Step two",
  );
  await page.keyboard.press("Tab");
  await titleSaved;
  await dialog.getByRole("button", { name: "Todo", exact: true }).click();
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Doing", exact: true }),
  ).toBeVisible();
  await closeCardDialog(page);
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Step two");

  await undo(page);
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Step two");
  await undo(page);
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Step one");
  await undo(page);
  await expect(cardTitle(page, "Step one")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await redo(page);
  await redo(page);
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Step two");
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  const aggregate = (await snapshot.json()) as {
    columns: { title: string; cardIds: string[] }[];
    cards: Record<string, { title: string }>;
  };
  const doing = aggregate.columns.find((column) => column.title === "Doing");
  expect(doing?.cardIds).toHaveLength(1);
  expect(aggregate.cards[doing!.cardIds[0]].title).toBe("Step two");
});

test("undo and redo card archive", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Archive task");
  await board.open(page);

  await openCard(page, "Archive task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await closeCardDialog(page);
  await expect(cardTitle(page, "Archive task")).toHaveCount(0);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(cardTitle(page, "Archive task")).toBeVisible();
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(cardTitle(page, "Archive task")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo restoring a card from the archive", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Restore task");
  await board.command({ type: "ARCHIVE_CARD", cardId });
  await board.open(page);
  await expect(cardTitle(page, "Restore task")).toHaveCount(0);

  const archive = await openArchive(page);
  const row = archive
    .getByTestId("archive-row")
    .filter({ hasText: "Restore task" });
  await expect(row).toBeVisible();
  await row.getByTestId("archive-restore").click();
  await page.getByRole("menuitem", { name: "Todo" }).click();
  await archive.getByRole("button", { name: "Close" }).first().click();
  await expect(archive).toBeHidden();
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Restore task");

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(cardTitle(page, "Restore task")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });

  const reopened = await openArchive(page);
  await expect(
    reopened.getByTestId("archive-row").filter({ hasText: "Restore task" }),
  ).toBeVisible();
  await reopened.getByRole("button", { name: "Close" }).first().click();
  await expect(reopened).toBeHidden();

  await redo(page);
  await expect(
    columnSection(page, "Todo").getByTestId("card-title"),
  ).toHaveText("Restore task");
  await expectHistory(page, { undo: true, redo: false });
});

test("undo restores a deleted card together with its checklist", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Delete task");
  await addChecklistItem(board.command, cardId, "Verify restore");
  await board.open(page);

  await openCard(page, "Delete task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await page
    .getByRole("dialog", { name: "Delete this card?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(cardTitle(page, "Delete task")).toHaveCount(0);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(cardTitle(page, "Delete task")).toBeVisible();
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Delete task");
  await expect(
    dialog.locator("li").filter({ hasText: "Verify restore" }).first(),
  ).toBeVisible();
  await closeCardDialog(page);

  await redo(page);
  await expect(cardTitle(page, "Delete task")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo the due date", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Due task");
  await board.open(page);

  await openCard(page, "Due task");
  const dialog = cardDialog(page);
  await dialog.getByTestId("due-date-trigger").click();
  await page.locator('[data-slot="calendar"] button[data-day]').nth(15).click();
  await expect(page.getByTestId("due-date-remove")).toBeVisible();
  await dialog.getByTestId("due-date-trigger").click();
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Due task");
  await expect(dialog.getByTestId("due-date-trigger")).toContainText(
    "Set due date",
  );
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Due task");
  await expect(dialog.getByTestId("due-date-trigger")).not.toContainText(
    "Set due date",
  );
});

test("undo and redo the priority", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Priority task");
  await board.open(page);

  await openCard(page, "Priority task");
  const dialog = cardDialog(page);
  await dialog.getByTestId("priority-trigger").click();
  await page.getByTestId("priority-option-high").click();
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Priority task");
  await expect(dialog.getByTestId("priority-trigger")).toContainText("Medium");
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Priority task");
  await expect(dialog.getByTestId("priority-trigger")).toContainText("High");
});

test("undo and redo the assignee", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Assigned task");
  await board.open(page);

  await openCard(page, "Assigned task");
  const dialog = cardDialog(page);
  await dialog.getByTestId("card-assignee-trigger").click();
  await page.locator('[data-testid^="card-assignee-option-"]').first().click();
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Assigned task");
  await expect(dialog.getByTestId("card-assignee-trigger")).toContainText(
    "Unassigned",
  );
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Assigned task");
  await expect(dialog.getByTestId("card-assignee-trigger")).not.toContainText(
    "Unassigned",
  );
});

test("undo and redo the cover", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Cover task");
  await board.open(page);

  await openCard(page, "Cover task");
  const dialog = cardDialog(page);
  const colors = page.getByRole("radiogroup", { name: "Colors" });
  const blue = colors.getByRole("radio", { name: "Blue", exact: true });
  await dialog.getByTestId("cover-trigger").click();
  await blue.click();
  await expect(blue).toBeChecked();
  await dialog.getByTestId("cover-trigger").click();
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Cover task");
  await expect(dialog.getByTestId("cover-trigger")).toContainText("Set cover");
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Cover task");
  await expect(dialog.getByTestId("cover-trigger")).toContainText(
    "Change cover",
  );
  await dialog.getByTestId("cover-trigger").click();
  await expect(blue).toBeChecked();
});

test("undo and redo adding a card link", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Source task");
  await board.card(column, "Target task");
  await board.open(page);

  await openCard(page, "Source task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Link card" }).click();
  await dialog.getByTestId("card-links-input").fill("Target task");
  await dialog.getByTestId("card-links-suggestion").click();
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Target task",
  );
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Source task");
  await expect(dialog.getByTestId("card-link-row")).toHaveCount(0);
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Source task");
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Target task",
  );
});

test("undo and redo removing a card link", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Source task");
  const targetCardId = await board.card(column, "Target task");
  await board.command({
    type: "ADD_CARD_LINK",
    cardId,
    linkId: randomUUID(),
    targetCardId,
    linkType: "relates_to",
  });
  await board.open(page);

  await openCard(page, "Source task");
  const dialog = cardDialog(page);
  const row = dialog
    .getByTestId("card-link-row")
    .filter({ hasText: "Target task" });
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByTestId("card-link-remove").click();
  await expect(dialog.getByTestId("card-link-row")).toHaveCount(0);
  await closeCardDialog(page);

  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });
  await openCard(page, "Source task");
  await expect(dialog.getByTestId("card-link-row")).toContainText(
    "Target task",
  );
  await closeCardDialog(page);

  await redo(page);
  await expectHistory(page, { undo: true, redo: false });
  await openCard(page, "Source task");
  await expect(dialog.getByTestId("card-link-row")).toHaveCount(0);
});
