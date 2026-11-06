import { randomUUID } from "node:crypto";
import { type Locator } from "@playwright/test";

import { test, expect } from "@/fixtures/board.js";
import {
  cardDialog,
  closeCardDialog,
  expectHistory,
  openCard,
  redo,
  undo,
} from "@/helpers/history.js";
import { addChecklistItem } from "@/helpers/search.js";

/** A checklist row, not a feed entry that happens to quote the same text. */
function checklistItem(dialog: Locator, text: string): Locator {
  return dialog
    .locator('li:has(button[aria-label="Delete item"])')
    .filter({ hasText: text })
    .first();
}

test("undo and redo attaching a label", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  await board.label("Design", "green");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Labels" }).click();

  const chip = page.getByRole("button", { name: "Design", exact: true }).last();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("undo and redo renaming a label", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  await board.label("Design", "green");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Labels" }).click();

  const row = page
    .getByRole("button", { name: "Design", exact: true })
    .locator("..");
  await row.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();

  const renameDialog = page.getByRole("dialog", { name: "Rename label" });
  await renameDialog.locator('[name="label-rename"]').fill("Renamed");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Renamed", exact: true }).last(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(
    page.getByRole("button", { name: "Design", exact: true }),
  ).toBeVisible();

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(
    page.getByRole("button", { name: "Renamed", exact: true }),
  ).toBeVisible();
});

test("undo and redo deleting a label restores its card assignment", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  const labelId = await board.label("Design", "green");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId,
    on: true,
  });
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Labels" }).click();

  const chip = page.getByRole("button", { name: "Design", exact: true }).last();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.locator("..").getByRole("button", { name: "Rename" }).click();
  await page
    .getByRole("menuitem", { name: "Delete label", exact: true })
    .click();

  const confirm = page.getByRole("dialog", { name: "Delete this label?" });
  await confirm
    .getByRole("button", { name: "Delete label", exact: true })
    .click();
  await expect(chip).toHaveCount(0);
  await page.keyboard.press("Escape");

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(chip).toHaveCount(0);
});

test("undo and redo changing a label colour", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  await board.label("Design", "red");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Labels" }).click();

  const chip = page.getByRole("button", { name: "Design", exact: true }).last();
  const dot = chip.locator("span[aria-hidden]");
  await expect(dot).toHaveClass(/bg-danger/);

  await chip.locator("..").getByRole("button", { name: "Rename" }).click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: "Blue", exact: true })
    .click();
  // The nested menu is portalled outside the label popover and keeps that
  // popover aria-hidden until it closes; Escape returns to the picker.
  await page.keyboard.press("Escape");
  if ((await chip.count()) === 0) {
    await dialog.getByRole("button", { name: "Labels" }).click();
  }
  await expect(dot).toHaveClass(/bg-blue/);

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(dot).toHaveClass(/bg-danger/);

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await dialog.getByRole("button", { name: "Labels" }).click();
  await expect(dot).toHaveClass(/bg-blue/);
});

test("undo and redo adding a checklist", async ({ page, board }) => {
  const column = await board.column("Work");
  await board.card(column, "Task");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const checklists = dialog.locator('[data-testid^="checklist-toggle-"]');
  await dialog.getByRole("button", { name: "Add checklist" }).click();
  await expect(checklists).toHaveCount(1);

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(checklists).toHaveCount(0);

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(checklists).toHaveCount(1);
});

test("undo and redo renaming a checklist", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await addChecklistItem(board.command, cardId, "Step one");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const checklists = dialog.locator('[data-testid^="checklist-toggle-"]');
  await dialog.getByRole("button", { name: "Checklist actions" }).click();
  await page
    .getByRole("menuitem", { name: "Rename checklist", exact: true })
    .click();
  const input = dialog.locator('[name="checklist-item-edit"]');
  await input.fill("Renamed");
  // Closing the menu can restore focus to its trigger, which blurs (and so
  // commits) the inline editor; Tab makes that deterministic either way.
  await page.keyboard.press("Tab");
  await expect(checklists.filter({ hasText: "Renamed" })).toHaveCount(1);

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(checklists.filter({ hasText: "DoD" })).toHaveCount(1);

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(checklists.filter({ hasText: "Renamed" })).toHaveCount(1);
});

test("undo restores a deleted checklist with its items", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await addChecklistItem(board.command, cardId, "Step one");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const checklists = dialog.locator('[data-testid^="checklist-toggle-"]');
  await dialog.getByRole("button", { name: "Checklist actions" }).click();
  await page
    .getByRole("menuitem", { name: "Delete checklist", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Delete this checklist?",
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(checklists).toHaveCount(0);
  const item = checklistItem(dialog, "Step one");
  await expect(item).toHaveCount(0);

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(checklists).toHaveCount(1);
  await expect(item).toBeVisible();

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(checklists).toHaveCount(0);
  await expect(item).toHaveCount(0);
});

test("undo and redo adding a checklist item", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: randomUUID(),
    title: "DoD",
  });
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const input = dialog.locator('[name="checklist-new-item"]');
  await input.fill("Step one");
  await input.press("Enter");
  const item = checklistItem(dialog, "Step one");
  await expect(item).toBeVisible();

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(item).toHaveCount(0);

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(item).toBeVisible();
});

test("undo and redo toggling a checklist item", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await addChecklistItem(board.command, cardId, "Step one");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const row = checklistItem(dialog, "Step one");
  await row.locator('button[aria-pressed="false"]').click();
  await expect(row.locator('button[aria-pressed="true"]')).toBeVisible();

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(row.locator('button[aria-pressed="false"]')).toBeVisible();

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(row.locator('button[aria-pressed="true"]')).toBeVisible();
});

test("undo and redo renaming a checklist item", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await addChecklistItem(board.command, cardId, "Step one");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const item = checklistItem(dialog, "Step one");
  await item.dblclick();
  const input = dialog.locator('[name="checklist-item-edit"]');
  await input.fill("Renamed step");
  await input.press("Enter");
  const renamed = checklistItem(dialog, "Renamed step");
  await expect(renamed).toBeVisible();

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(item).toBeVisible();

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(renamed).toBeVisible();
});

test("undo restores a deleted checklist item", async ({ page, board }) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Task");
  await addChecklistItem(board.command, cardId, "Step one");
  await board.open(page);

  await openCard(page, "Task");
  const dialog = cardDialog(page);
  const item = checklistItem(dialog, "Step one");
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Delete item" }).click();
  await expect(item).toHaveCount(0);

  await closeCardDialog(page);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expectHistory(page, { undo: false, redo: true });

  await openCard(page, "Task");
  await expect(item).toBeVisible();

  await closeCardDialog(page);
  await redo(page);
  await expectHistory(page, { undo: true, redo: false });

  await openCard(page, "Task");
  await expect(item).toHaveCount(0);
});
