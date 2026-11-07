import { type Page } from "@playwright/test";
import { test, expect } from "@/fixtures/board.js";
import {
  cardOrder,
  cardTitle,
  columnMenu,
  columnSection,
  expectHistory,
  redo,
  undo,
} from "@/helpers/history.js";

function columnOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator('section > header[role="group"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
}

async function sortByTitle(page: Page, name: string): Promise<void> {
  await columnSection(page, name)
    .getByRole("button", { name: "Column options" })
    .click();
  const sort = page.getByRole("menuitem", { name: "Sort cards", exact: true });
  await sort.hover();
  const byTitle = page.getByRole("menuitem", {
    name: "By title",
    exact: true,
  });
  await expect(byTitle).toBeVisible();
  await byTitle.click();
}

test("undo and redo column creation", async ({ page, board }) => {
  await board.open(page);
  await expectHistory(page, { undo: false, redo: false });
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.locator('[name="column-create"]').fill("Todo");
  await page.locator('[name="column-create"]').press("Enter");
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(columnSection(page, "Todo")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo column rename", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);
  await columnMenu(page, "Todo", "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(columnSection(page, "Renamed")).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expect(columnSection(page, "Renamed")).toHaveCount(0);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(columnSection(page, "Renamed")).toBeVisible();
  await expect(columnSection(page, "Todo")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo column duplication", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Task");
  await board.open(page);
  await columnMenu(page, "Todo", "Duplicate column");
  const copy = columnSection(page, "Copy of Todo");
  await expect(copy).toBeVisible();
  await expect(copy.getByTestId("card-title")).toHaveText("Task");
  await expect(cardTitle(page, "Task")).toHaveCount(2);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(copy).toHaveCount(0);
  await expect(cardTitle(page, "Task")).toHaveCount(1);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(copy).toBeVisible();
  await expect(copy.getByTestId("card-title")).toHaveText("Task");
  await expect(cardTitle(page, "Task")).toHaveCount(2);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo restores a deleted column with its cards", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "One");
  await board.card(todo, "Two");
  await board.open(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["One", "Two"]);
  await columnMenu(page, "Todo", "Delete column");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete column", exact: true })
    .click();
  await expect(columnSection(page, "Todo")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(columnSection(page, "Todo")).toBeVisible();
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["One", "Two"]);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(columnSection(page, "Todo")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo a column move", async ({ page, board }) => {
  await board.column("First");
  await board.column("Second");
  await board.open(page);
  await expect.poll(() => columnOrder(page)).toEqual(["First", "Second"]);
  const source = await page
    .getByRole("group", { name: "Second", exact: true })
    .boundingBox();
  const target = await page
    .getByRole("group", { name: "First", exact: true })
    .boundingBox();
  if (!source || !target) throw new Error("Column headers are not visible");
  await page.mouse.move(source.x + 25, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 15, source.y + source.height / 2, {
    steps: 3,
  });
  await page.mouse.move(target.x + 20, target.y + target.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect.poll(() => columnOrder(page)).toEqual(["Second", "First"]);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect.poll(() => columnOrder(page)).toEqual(["First", "Second"]);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect.poll(() => columnOrder(page)).toEqual(["Second", "First"]);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo column sorting", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Beta");
  await board.card(todo, "Alpha");
  await board.open(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["Beta", "Alpha"]);
  await sortByTitle(page, "Todo");
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["Alpha", "Beta"]);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["Beta", "Alpha"]);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["Alpha", "Beta"]);
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo the WIP limit", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Existing task");
  await board.open(page);
  await columnMenu(page, "Todo", "WIP limit");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "WIP limit" })
    .fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(columnSection(page, "Todo")).toContainText("1/1");
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(columnSection(page, "Todo")).not.toContainText("1/1");
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect(columnSection(page, "Todo")).toContainText("1/1");
  await expectHistory(page, { undo: true, redo: false });
});

test("undo and redo archive all cards", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "One");
  await board.card(todo, "Two");
  await board.open(page);
  await columnMenu(page, "Todo", "Archive all cards");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive all cards", exact: true })
    .click();
  await expect.poll(() => cardOrder(page, "Todo")).toEqual([]);
  await expect(cardTitle(page, "One")).toHaveCount(0);
  await expect(cardTitle(page, "Two")).toHaveCount(0);
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["One", "Two"]);
  await expectHistory(page, { undo: false, redo: true });
  await redo(page);
  await expect.poll(() => cardOrder(page, "Todo")).toEqual([]);
  await expectHistory(page, { undo: true, redo: false });
});
