import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  filterBar,
  openFilters,
  pickFacet,
} from "@/helpers/filters.js";

async function boardWithLabels(board: {
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  command: (action: Record<string, unknown>) => Promise<void>;
  label: (name: string, color?: string) => Promise<string>;
}) {
  const todo = await board.column("Todo");
  const bug = await board.label("Bug", "red");
  const feature = await board.label("Feature", "blue");
  const onlyBug = await board.card(todo, "Only bug");
  const onlyFeature = await board.card(todo, "Only feature");
  const both = await board.card(todo, "Both labels");
  await board.card(todo, "No labels");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: onlyBug,
    labelId: bug,
    on: true,
  });
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: onlyFeature,
    labelId: feature,
    on: true,
  });
  for (const labelId of [bug, feature]) {
    await board.command({
      type: "SET_CARD_LABEL",
      cardId: both,
      labelId,
      on: true,
    });
  }
  return { bug, feature };
}

test("filters by any of the selected labels", async ({ page, board }) => {
  await boardWithLabels(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "Feature", exact: true }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Only bug", "Only feature", "Both labels"]);
  await expect(
    filterBar(page).getByRole("button", { name: "Filter cards" }),
  ).toContainText("1");
});

test("filters by all of the selected labels", async ({ page, board }) => {
  await boardWithLabels(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "Feature", exact: true }).click();
  await popover.getByRole("radio", { name: "All", exact: true }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Both labels"]);
});

test("filters cards without a label", async ({ page, board }) => {
  await boardWithLabels(board);
  await board.open(page);

  await pickFacet(page, "checkbox", "No label");

  await expectCardTitles(page, ["No labels"]);
});

test("combines the no-label facet with selected labels as OR", async ({
  page,
  board,
}) => {
  await boardWithLabels(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover
    .getByRole("checkbox", { name: "No label", exact: true })
    .click();
  await closeFilters(page);

  await expectCardTitles(page, ["Only bug", "Both labels", "No labels"]);
});

test("removes a label filter from its chip", async ({ page, board }) => {
  await boardWithLabels(board);
  await board.open(page);

  await pickFacet(page, "checkbox", "Bug");
  await expectCardTitles(page, ["Only bug", "Both labels"]);

  await filterBar(page)
    .getByText("Bug", { exact: true })
    .getByRole("button", { name: "Remove label" })
    .click();

  await expectCardTitles(page, [
    "Only bug",
    "Only feature",
    "Both labels",
    "No labels",
  ]);
  await expect(filterBar(page).getByText(/cards? found/)).toHaveCount(0);
});
