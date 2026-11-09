import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/member.js";
import {
  cardDialog,
  closeCardDialog,
  columnMenu,
  columnSection,
  expectHistory,
  notification,
  openCard,
  pressUndo,
  undo,
} from "@/helpers/history.js";

const FOREIGN_SKIP = "Another member changed this — undo was skipped";

test.describe.configure({ timeout: 60_000 });

test("undo skips a column rename overtaken by another member", async ({
  page,
  board,
  member,
}) => {
  const columnId = await board.column("Todo");
  await board.open(page);

  await columnMenu(page, "Todo", "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("Local column");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "RENAME_COLUMN",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await saved;
  await expect(columnSection(page, "Local column")).toBeVisible();

  await member.command({
    type: "RENAME_COLUMN",
    columnId,
    title: "Member column",
  });
  await expect(columnSection(page, "Member column")).toBeVisible({
    timeout: 15_000,
  });

  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(columnSection(page, "Member column")).toBeVisible();
  await expect(columnSection(page, "Local column")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: false });
});

test("undo skips a label rename overtaken by another member", async ({
  page,
  board,
  member,
}) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  const labelId = await board.label("Design", "green");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Labels" }).click();
  const chip = page.getByRole("button", { name: "Design", exact: true }).last();
  await chip.locator("..").getByRole("button", { name: "Rename" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename label" });
  await renameDialog.locator('[name="label-rename"]').fill("Local label");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "RENAME_LABEL",
  );
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  await expect(
    page.getByRole("button", { name: "Local label", exact: true }).last(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await closeCardDialog(page);

  await member.command({ type: "RENAME_LABEL", labelId, name: "Member label" });
  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(
    page.getByRole("button", { name: "Member label", exact: true }).last(),
  ).toBeVisible({ timeout: 15_000 });

  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Member label", exact: true }).last(),
  ).toBeVisible();
  await closeCardDialog(page);
  await expectHistory(page, { undo: false, redo: false });
});

test("undo skips a checklist rename overtaken by another member", async ({
  page,
  board,
  member,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  const checklistId = randomUUID();
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: "DoD",
  });
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const checklists = dialog.locator('[data-testid^="checklist-toggle-"]');
  await dialog.getByRole("button", { name: "Checklist actions" }).click();
  await page
    .getByRole("menuitem", { name: "Rename checklist", exact: true })
    .click();
  const input = dialog.locator('[name="checklist-item-edit"]');
  await input.fill("Local checklist");
  await page.keyboard.press("Tab");
  await expect(checklists.filter({ hasText: "Local checklist" })).toHaveCount(
    1,
  );

  await member.command({
    type: "RENAME_CHECKLIST",
    cardId,
    checklistId,
    title: "Member checklist",
  });
  await expect(checklists.filter({ hasText: "Member checklist" })).toHaveCount(
    1,
    { timeout: 15_000 },
  );

  // Closing the card moves focus out of the inline editor; a contenteditable
  // target deliberately ignores Ctrl+Z (native text undo).
  await closeCardDialog(page);
  await pressUndo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await openCard(page, "Task");
  await expect(checklists.filter({ hasText: "Member checklist" })).toHaveCount(
    1,
  );
  await closeCardDialog(page);
  await expectHistory(page, { undo: false, redo: false });
});

test("one undo skips several overtaken steps and still applies the next live one", async ({
  page,
  board,
  member,
}) => {
  const columnId = await board.column("Todo");
  const cardId = await board.card(columnId, "Task");
  await board.open(page);

  // Step 1: a live local action (the card below).
  const todo = columnSection(page, "Todo");
  await todo.locator("[data-composer-trigger]").click();
  const composer = todo.locator('[name="card-composer"]');
  await composer.fill("Keep card");
  await composer.press("Enter");
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Keep card" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Steps 2 and 3: local edits that both get overtaken.
  await openCard(page, "Task");
  await cardDialog(page)
    .getByRole("textbox", { name: "Title" })
    .fill("Local title");
  const titleSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { title?: string } })
        .action?.title === "Local title",
  );
  await closeCardDialog(page);
  await titleSaved;

  await page.locator("header h2").click();
  await page.locator('[name="board-title-edit"]').fill("Local board");
  const boardSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: { type?: string } })
        .action?.type === "RENAME_BOARD",
  );
  await page.locator('[name="board-title-edit"]').press("Enter");
  await boardSaved;
  await expect(
    page.getByRole("heading", { name: "Local board" }),
  ).toBeVisible();

  await member.command({ type: "UPDATE_CARD", cardId, title: "Member title" });
  await expect(
    columnSection(page, "Todo")
      .getByTestId("card-title")
      .filter({ hasText: "Member title" }),
  ).toBeVisible({ timeout: 15_000 });
  await member.command({ type: "RENAME_BOARD", title: "Member board" });
  await expect(page.getByRole("heading", { name: "Member board" })).toBeVisible(
    {
      timeout: 15_000,
    },
  );

  await undo(page);
  await expect(notification(page, FOREIGN_SKIP)).toBeVisible();
  await expect(
    page.locator(".janosik-toast").filter({ hasText: FOREIGN_SKIP }),
  ).toHaveCount(1);
  // Both overtaken steps were skipped, and the undo reached the live add.
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Keep card" }),
  ).toHaveCount(0);
  await expect(
    columnSection(page, "Todo")
      .getByTestId("card-title")
      .filter({ hasText: "Member title" }),
  ).toBeVisible();
  await expectHistory(page, { undo: false, redo: true });
});
