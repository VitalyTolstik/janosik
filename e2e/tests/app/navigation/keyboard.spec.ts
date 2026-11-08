import type { Page } from "@playwright/test";

import { test, expect } from "@/fixtures/board.js";
import { searchInput } from "@/helpers/filters.js";
import { cardDialog, cardTitle, columnSection } from "@/helpers/history.js";
import { cursorCard } from "@/helpers/navigation.js";

const shortcutsDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Keyboard shortcuts" });

test("opens the keyboard cheat sheet with ? and closes it with Escape", async ({
  page,
  board,
}) => {
  await board.open(page);

  await page.keyboard.press("Shift+/");

  const sheet = shortcutsDialog(page);
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("shortcuts-table")).toContainText("Ctrl+K");
  await expect(page.getByTestId("shortcuts-table")).toContainText("J");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("opens the keyboard cheat sheet from the Help menu", async ({
  page,
  board,
}) => {
  await board.open(page);

  await page.getByTestId("help-trigger").click();
  await page.getByTestId("help-shortcuts").click();

  await expect(shortcutsDialog(page)).toBeVisible();
});

test("keeps the ? shortcut out of text fields", async ({ page, board }) => {
  await board.open(page);
  await searchInput(page).click();

  await page.keyboard.press("Shift+/");

  await expect(shortcutsDialog(page)).toBeHidden();
});

test("moves the keyboard cursor through cards with j and k", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  await board.card(columnId, "Second card");
  await board.card(columnId, "Third card");
  await board.open(page);

  await page.keyboard.press("k");
  await expect(cursorCard(page)).toContainText("Third card");

  await page.keyboard.press("k");
  await expect(cursorCard(page)).toContainText("Second card");

  await page.keyboard.press("j");
  await expect(cursorCard(page)).toContainText("Third card");

  await page.keyboard.press("j");
  await expect(cursorCard(page)).toContainText("Third card");
});

test("opens the selected card with e", async ({ page, board }) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  const cardId = await board.card(columnId, "Second card");
  await board.open(page);

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("e");

  const dialog = cardDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Second card",
  );
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${cardId}$`),
  );
});

test("opens the focused card with Enter, not the cursor card", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  const secondId = await board.card(columnId, "Second card");
  await board.open(page);
  await page.keyboard.press("j");
  await expect(cursorCard(page)).toContainText("First card");

  await page.getByRole("group", { name: "Second card", exact: true }).focus();
  await page.keyboard.press("Enter");

  const dialog = cardDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Second card",
  );
  await expect(page).toHaveURL(
    new RegExp(`/board/${board.id}\\?card=${secondId}$`),
  );
});

test("starts a new card in the cursor column with n", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Todo card");
  const doing = await board.column("Doing");
  await board.card(doing, "Doing card");
  await board.open(page);

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("n");

  const doingSection = columnSection(page, "Doing");
  const composer = doingSection.locator('[name="card-composer"]');
  await expect(composer).toBeVisible();
  await expect(composer).toBeFocused();
  await composer.fill("Keyboard card");
  await composer.press("Enter");

  await expect(
    doingSection.getByTestId("card-title").filter({ hasText: "Keyboard card" }),
  ).toBeVisible();
});

test("opens the column composer with c", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);

  await page.keyboard.press("c");

  const input = page.locator('[name="column-create"]');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Keyboard column");
  await input.press("Enter");

  await expect(
    page.getByRole("group", { name: "Keyboard column", exact: true }),
  ).toBeVisible();
});

test("clears the keyboard cursor with Escape", async ({ page, board }) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  await board.open(page);
  await page.keyboard.press("j");
  await expect(cursorCard(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(cursorCard(page)).toHaveCount(0);
  await expect(cardDialog(page)).toBeHidden();
});

test("ignores single-letter shortcuts while typing", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await page.keyboard.press("n");
  const composer = page.locator('[name="card-composer"]');
  await expect(composer).toBeFocused();

  await page.keyboard.type("j");

  await expect(composer).toHaveValue("j");
  await expect(cursorCard(page)).toHaveCount(0);
});

test("ignores board shortcuts while the card context menu is open", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  await board.card(columnId, "Second card");
  await board.open(page);

  await cardTitle(page, "First card").click({ button: "right" });
  await expect(page.getByTestId("card-context-menu")).toBeVisible();

  await page.keyboard.press("j");

  await expect(cursorCard(page)).toHaveCount(0);
});

test("ignores the ? shortcut while the card context menu is open", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Todo");
  await board.card(columnId, "First card");
  await board.open(page);

  await cardTitle(page, "First card").click({ button: "right" });
  await expect(page.getByTestId("card-context-menu")).toBeVisible();

  await page.keyboard.press("Shift+/");

  await expect(shortcutsDialog(page)).toBeHidden();
});
