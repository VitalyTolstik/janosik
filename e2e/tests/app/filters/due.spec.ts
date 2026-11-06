import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  filterBar,
  openFilters,
  pickFacet,
} from "@/helpers/filters.js";

async function boardWithDueDates(board: {
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  command: (action: Record<string, unknown>) => Promise<void>;
}) {
  const todo = await board.column("Todo");
  const overdue = await board.card(todo, "Overdue task");
  const soon = await board.card(todo, "Soon task");
  const later = await board.card(todo, "Later task");
  const none = await board.card(todo, "No deadline");
  const now = Date.now();
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: overdue,
    dueDate: now - 60 * 60 * 1000,
  });
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: soon,
    dueDate: now + 60 * 60 * 1000,
  });
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: later,
    dueDate: now + 3 * 24 * 60 * 60 * 1000,
  });
  return { none };
}

test("filters overdue cards", async ({ page, board }) => {
  await boardWithDueDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Overdue");

  await expectCardTitles(page, ["Overdue task"]);
  await expect(filterBar(page).getByText("1 card found")).toBeVisible();
});

test("filters cards due within the next 24 hours", async ({ page, board }) => {
  await boardWithDueDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Due soon (≤24 h)");

  await expectCardTitles(page, ["Soon task"]);
});

test("filters cards without a due date", async ({ page, board }) => {
  await boardWithDueDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "No due date");

  await expectCardTitles(page, ["No deadline"]);
});

test("removes the due filter from its chip", async ({ page, board }) => {
  await boardWithDueDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Overdue");
  await expectCardTitles(page, ["Overdue task"]);

  await filterBar(page)
    .getByText("Overdue", { exact: true })
    .getByRole("button", { name: "Remove label" })
    .click();

  await expectCardTitles(page, [
    "Overdue task",
    "Soon task",
    "Later task",
    "No deadline",
  ]);
  await expect(
    filterBar(page).getByText("Overdue", { exact: true }),
  ).toHaveCount(0);
});

test("resets the due filter to any date", async ({ page, board }) => {
  await boardWithDueDates(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "No due date" }).click();
  await expectCardTitles(page, ["No deadline"]);
  await popover.getByRole("radio", { name: "Any due date" }).click();
  await closeFilters(page);

  await expectCardTitles(page, [
    "Overdue task",
    "Soon task",
    "Later task",
    "No deadline",
  ]);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
});
