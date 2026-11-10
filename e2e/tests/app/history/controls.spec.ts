import { randomUUID } from "node:crypto";
import { type Page } from "@playwright/test";
import { test, expect } from "@/fixtures/board.js";
import { createExtraBoard } from "@/helpers/boards.js";
import {
  cardDialog,
  closeCardDialog,
  columnSection,
  expectHistory,
  openCard,
  pressRedo,
  pressRedoY,
  pressUndo,
  redo,
  undo,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

function todoCard(page: Page, title: string) {
  return columnSection(page, "Todo")
    .getByTestId("card-title")
    .filter({ hasText: title });
}

async function addCard(page: Page, title: string): Promise<void> {
  const todo = columnSection(page, "Todo");
  await todo.locator("[data-composer-trigger]").click();
  const composer = todo.locator('[name="card-composer"]');
  await composer.fill(title);
  await composer.press("Enter");
  await expect(todoCard(page, title)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
}

async function switchBoard(page: Page, title: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Switch board" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("option").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("undo and redo buttons follow the history state", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await expectHistory(page, { undo: false, redo: false });
  await addCard(page, "History task");
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(todoCard(page, "History task")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(todoCard(page, "History task")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("Ctrl+Z and Ctrl+Shift+Z undo and redo", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Keyboard task");
  await pressUndo(page);
  await expect(todoCard(page, "Keyboard task")).toHaveCount(0);
  await pressRedo(page);
  await expect(todoCard(page, "Keyboard task")).toBeVisible();
});

test("Ctrl+Y also redoes", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Y task");
  await pressUndo(page);
  await expect(todoCard(page, "Y task")).toHaveCount(0);
  await pressRedoY(page);
  await expect(todoCard(page, "Y task")).toBeVisible();
});

test("board shortcuts are ignored while editing text", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Editing task");
  await openCard(page, "Editing task");
  const dialog = cardDialog(page);
  await dialog.getByRole("textbox", { name: "Title" }).click();
  await pressUndo(page);
  await expect(dialog).toBeVisible();
  await closeCardDialog(page);
  await expect(todoCard(page, "Editing task")).toBeVisible();
  await undo(page);
  await expect(todoCard(page, "Editing task")).toHaveCount(0);
});

test("Ctrl+Z inside the description editor does not undo the board", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Editing target");
  await openCard(page, "Editing target");
  const dialog = cardDialog(page);
  const editor = dialog.locator(".janosik-md-content").first();
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.click();
  await pressUndo(page);
  await expect(dialog).toBeVisible();
  await closeCardDialog(page);
  await expect(todoCard(page, "Editing target")).toBeVisible();
});

test("a new edit clears the redo stack", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Original");
  await undo(page);
  await expect(todoCard(page, "Original")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });
  await addCard(page, "Fresh");
  await expect(todoCard(page, "Fresh")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("multiple undo and redo steps replay in order", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "First");
  await addCard(page, "Second");
  await undo(page);
  await expect(todoCard(page, "Second")).toHaveCount(0);
  await expect(todoCard(page, "First")).toBeVisible();
  await undo(page);
  await expect(todoCard(page, "First")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(todoCard(page, "First")).toBeVisible();
  await expect(todoCard(page, "Second")).toHaveCount(0);
  await redo(page);
  await expect(todoCard(page, "Second")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("each board keeps its own undo history", async ({ page, board }) => {
  await board.column("Todo");
  const secondTitle = `Second board ${randomUUID()}`;
  const second = await createExtraBoard(board.api, secondTitle);
  const secondTodo = await second.column("Todo");
  await second.card(secondTodo, "B existing");
  await board.open(page);
  const firstTitle = await page.locator("header h2").innerText();
  await addCard(page, "A task");
  await switchBoard(page, secondTitle);
  await expect(todoCard(page, "B existing")).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });
  await addCard(page, "B task");
  await switchBoard(page, firstTitle);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(todoCard(page, "A task")).toHaveCount(0);
  await switchBoard(page, secondTitle);
  await expect(todoCard(page, "B existing")).toBeVisible();
  await expect(todoCard(page, "B task")).toBeVisible();
});

test("reload saves the undone result and clears history", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Undone task");
  await undo(page);
  await expect(todoCard(page, "Undone task")).toHaveCount(0);
  await page.reload();
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expect(todoCard(page, "Undone task")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: false });
});

test("reload saves the redone result and clears history", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await addCard(page, "Redone task");
  await undo(page);
  await redo(page);
  await expect(todoCard(page, "Redone task")).toBeVisible();
  await page.reload();
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expect(todoCard(page, "Redone task")).toBeVisible();
  await expectHistory(page, { undo: false, redo: false });
});
