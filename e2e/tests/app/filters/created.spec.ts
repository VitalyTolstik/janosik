import { test, expect } from "@/fixtures/board.js";
import { ageCards } from "@/helpers/disposable-database.js";
import {
  closeFilters,
  expectCardTitles,
  filterBar,
  openFilters,
  pickFacet,
} from "@/helpers/filters.js";

test.skip(
  !process.env.E2E_COMPOSE_PROJECT,
  "Requires the disposable Docker database",
);

async function boardWithCreationDates(board: {
  id: string;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
}) {
  const todo = await board.column("Todo");
  const today = await board.card(todo, "Today task");
  const three = await board.card(todo, "Three days old");
  const ten = await board.card(todo, "Ten days old");
  const forty = await board.card(todo, "Forty days old");
  await ageCards(board.id, [three], 3);
  await ageCards(board.id, [ten], 10);
  await ageCards(board.id, [forty], 40);
  return { today, three, ten, forty };
}

test("filters cards created today", async ({ page, board }) => {
  await boardWithCreationDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Today");

  await expectCardTitles(page, ["Today task"]);
});

test("filters cards created in the last 7 days", async ({ page, board }) => {
  await boardWithCreationDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Last 7 days");

  await expectCardTitles(page, ["Today task", "Three days old"]);
});

test("filters cards created in the last 30 days", async ({ page, board }) => {
  await boardWithCreationDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Last 30 days");

  await expectCardTitles(page, [
    "Today task",
    "Three days old",
    "Ten days old",
  ]);
});

test("filters by an exact creation day and retires the relative window", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Today task");
  const yesterday = await board.card(todo, "Yesterday task");
  await ageCards(board.id, [yesterday], 1);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "Last 30 days" }).click();
  await expectCardTitles(page, ["Today task", "Yesterday task"]);

  await popover.getByRole("radio", { name: /^On date/ }).click();
  const days = popover.locator("button[data-day]");
  await expect(days.first()).toBeVisible();
  const today = new Date();
  await days.filter({ hasText: new RegExp(`^${today.getDate()}$`) }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Today task"]);
  const formatted = today.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  await expect(
    filterBar(page).getByText(formatted, { exact: true }),
  ).toBeVisible();
  await expect(
    filterBar(page).getByText("Last 30 days", { exact: true }),
  ).toHaveCount(0);
});

test("removes the relative creation window from its chip", async ({
  page,
  board,
}) => {
  await boardWithCreationDates(board);
  await board.open(page);

  await pickFacet(page, "radio", "Last 7 days");
  await expectCardTitles(page, ["Today task", "Three days old"]);

  await filterBar(page)
    .getByText("Last 7 days", { exact: true })
    .getByRole("button", { name: "Remove label" })
    .click();

  await expectCardTitles(page, [
    "Today task",
    "Three days old",
    "Ten days old",
    "Forty days old",
  ]);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
});
