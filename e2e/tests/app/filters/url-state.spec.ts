import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  facetCount,
  matchCount,
  openFilters,
  resetFilters,
  search,
  searchInput,
} from "@/helpers/filters.js";

/**
 * Product fix from the audit's P1 gap: the active filter is shareable.
 * The URL carries it (`?f.q=…&f.due=…`), so a reload and a pasted link
 * restore the same filtered board instead of silently resetting it.
 */
test("keeps the filter in the URL and restores it after a reload", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const bug = await board.label("Bug", "red");
  const alpha = await board.card(todo, "Alpha task");
  await board.card(todo, "Beta task");
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: alpha,
    dueDate: Date.now() - 60 * 60 * 1000,
  });
  await board.command({
    type: "SET_CARD_LABEL",
    cardId: alpha,
    labelId: bug,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: alpha,
    priority: "high",
  });

  await board.open(page);
  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "Overdue" }).click();
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await closeFilters(page);
  await search(page, "Alpha");

  await expectCardTitles(page, ["Alpha task"]);
  await expect(facetCount(page)).toHaveText("4");
  await expect(matchCount(page)).toHaveText("1 card found");

  const params = new URL(page.url()).searchParams;
  expect(params.get("f.q")).toBe("Alpha");
  expect(params.get("f.due")).toBe("overdue");
  expect(params.get("f.labels")).toBe(bug);
  expect(params.get("f.priority")).toBe("high");
  expect(params.get("card")).toBeNull();

  await page.reload();

  await expect(searchInput(page)).toHaveValue("Alpha");
  await expect(facetCount(page)).toHaveText("4");
  await expectCardTitles(page, ["Alpha task"]);
  await expect(matchCount(page)).toHaveText("1 card found");

  await resetFilters(page);
  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Alpha task", "Beta task"]);
  const cleaned = new URL(page.url()).searchParams;
  expect([...cleaned.keys()].filter((key) => key.startsWith("f."))).toEqual([]);
});
