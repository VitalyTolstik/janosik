import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  filterBar,
  openFilters,
  search,
  searchInput,
} from "@/helpers/filters.js";

test("keeps the filter when switching to the table view", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Alpha task");
  await board.card(todo, "Beta task");
  await board.open(page);

  await search(page, "Alpha");
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Table" }).click();

  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await expect(page.getByTestId("table-row")).toContainText("Alpha task");

  await views.getByRole("button", { name: "Board", exact: true }).click();
  await expect(searchInput(page)).toHaveValue("Alpha");
  await expectCardTitles(page, ["Alpha task"]);
});

test("applies the filter to scheduled and unscheduled calendar cards", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const alphaDue = await board.card(todo, "Alpha due");
  const betaDue = await board.card(todo, "Beta due");
  await board.card(todo, "Alpha loose");
  await board.card(todo, "Beta loose");
  const todayNoon = new Date();
  todayNoon.setHours(12, 0, 0, 0);
  for (const cardId of [alphaDue, betaDue]) {
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId,
      dueDate: todayNoon.getTime(),
    });
  }
  await board.open(page);

  await search(page, "Alpha");
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Calendar" }).click();

  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Alpha due" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Beta due" }),
  ).toHaveCount(0);
  const unscheduled = page.getByTestId("unscheduled-list");
  await expect(
    unscheduled.getByText("Alpha loose", { exact: true }),
  ).toBeVisible();
  await expect(
    unscheduled.getByText("Beta loose", { exact: true }),
  ).toHaveCount(0);
});

test("hides the filter bar in the watch view and restores it on return", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Alpha task");
  await board.card(todo, "Beta task");
  await board.open(page);

  await search(page, "Alpha");
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(filterBar(page)).toHaveCount(0);

  await views.getByRole("button", { name: "Board", exact: true }).click();
  await expect(filterBar(page)).toBeVisible();
  await expect(searchInput(page)).toHaveValue("Alpha");
  await expectCardTitles(page, ["Alpha task"]);
});

test("counts every active facet on the filters button", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const label = await board.label("Bug", "red");
  const alpha = await board.card(todo, "Alpha task");
  const beta = await board.card(todo, "Beta task");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: alpha,
    labelId: label,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: alpha,
    priority: "high",
  });
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: beta,
    linkId: randomUUID(),
    targetCardId: alpha,
    linkType: "relates_to",
  });
  await board.open(page);

  await search(page, "Alpha");
  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "No due date" }).click();
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await popover
    .getByRole("checkbox", { name: "Has links", exact: true })
    .click();
  await closeFilters(page);

  await expectCardTitles(page, ["Alpha task"]);
  await expect(
    filterBar(page).getByRole("button", { name: "Filter cards" }),
  ).toContainText("5");
});

test("resets the query and every facet at once", async ({ page, board }) => {
  const todo = await board.column("Todo");
  const label = await board.label("Bug", "red");
  const alpha = await board.card(todo, "Alpha task");
  await board.card(todo, "Beta task");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: alpha,
    labelId: label,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: alpha,
    priority: "high",
  });
  await board.open(page);

  await search(page, "Alpha");
  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "No due date" }).click();
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await closeFilters(page);
  await expectCardTitles(page, ["Alpha task"]);

  await filterBar(page).getByText("Reset filters", { exact: true }).click();

  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Alpha task", "Beta task"]);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
  await expect(
    filterBar(page).getByRole("button", { name: "Filter cards" }),
  ).not.toContainText("4");
});
