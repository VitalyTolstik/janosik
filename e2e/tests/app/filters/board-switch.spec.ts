import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import { createExtraBoard } from "@/helpers/boards.js";
import {
  expectCardTitles,
  facetCount,
  facetChip,
  filterBar,
  search,
  searchInput,
} from "@/helpers/filters.js";

/**
 * F-04: switching boards remounts BoardSection, so the previous board's
 * filter (and its label ids) must not leak into the next board. Returning to
 * the first board is a fresh mount too — the filter is deliberately not
 * restored.
 */
test("does not leak a filter to another board", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Alpha task");
  await board.card(todo, "Beta task");
  const other = await createExtraBoard(board.api, `Board B ${randomUUID()}`);
  const otherTodo = await other.column("Todo");
  await other.card(otherTodo, "Gamma task");
  await other.card(otherTodo, "Delta task");

  await board.open(page);
  await search(page, "Alpha");
  await expectCardTitles(page, ["Alpha task"]);

  await page.getByRole("button", { name: "Switch board" }).click();
  await page.getByRole("option").filter({ hasText: other.title }).click();
  await expect(page).toHaveURL(new RegExp(`/board/${other.id}$`));
  await expect(page.getByRole("heading", { name: other.title })).toBeVisible();

  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Gamma task", "Delta task"]);
  await expect(facetCount(page)).toHaveCount(0);
  await expect(facetChip(page, "due")).toHaveCount(0);
  await expect(filterBar(page).getByTestId("filter-chip")).toHaveCount(0);

  await page.getByRole("button", { name: "Switch board" }).click();
  await page.getByRole("option").filter({ hasText: board.title }).click();
  await expect(page).toHaveURL(new RegExp(`/board/${board.id}$`));
  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Alpha task", "Beta task"]);
  await expect(facetCount(page)).toHaveCount(0);
});
