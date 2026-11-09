import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  facetChip,
  facetCount,
  matchCount,
  openFilters,
} from "@/helpers/filters.js";
import { openCalendar, openTable, tableRow } from "@/helpers/views.js";

/**
 * F-03: a faceted filter (not just the free-text query) is applied in the
 * table and calendar exactly as on the board, and the same chips/count
 * survive view switches.
 */
test("applies a faceted filter in the table and calendar", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const bug = await board.label("Bug", "red");
  const feature = await board.label("Feature", "blue");
  const alpha = await board.card(todo, "Alpha bug");
  const beta = await board.card(todo, "Beta bug");
  const gamma = await board.card(todo, "Gamma feature");
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  for (const cardId of [alpha, beta]) {
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId,
      dueDate: due.getTime(),
    });
  }
  for (const cardId of [alpha, beta]) {
    await board.command({
      type: "SET_CARD_LABEL",
      cardId,
      labelId: bug,
      on: true,
    });
  }
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: gamma,
    labelId: feature,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: alpha,
    priority: "high",
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: beta,
    priority: "low",
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: gamma,
    priority: "high",
  });

  await board.open(page);
  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Alpha bug"]);
  await expect(facetCount(page)).toHaveText("2");
  await expect(matchCount(page)).toHaveText("1 card found");

  await openTable(page);
  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await expect(tableRow(page, "Alpha bug")).toBeVisible();
  await expect(tableRow(page, "Beta bug")).toHaveCount(0);
  await expect(tableRow(page, "Gamma feature")).toHaveCount(0);
  await expect(facetChip(page, "label")).toHaveText("Bug");
  await expect(facetChip(page, "priority")).toHaveText("High");
  await expect(matchCount(page)).toHaveText("1 card found");

  await openCalendar(page);
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Alpha bug" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Beta bug" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Gamma feature" }),
  ).toHaveCount(0);
  const unscheduled = page.getByTestId("unscheduled-list");
  await expect(
    unscheduled.getByText("Gamma feature", { exact: true }),
  ).toHaveCount(0);
  await expect(unscheduled.getByText("Beta bug", { exact: true })).toHaveCount(
    0,
  );
  await expect(facetCount(page)).toHaveText("2");

  // Going back to the table keeps the faceted filter intact.
  await openTable(page);
  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await expect(facetChip(page, "priority")).toHaveText("High");
});
