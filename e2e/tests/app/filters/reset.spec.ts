import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import { ageCards } from "@/helpers/disposable-database.js";
import {
  closeFilters,
  expectCardTitles,
  facetChip,
  facetCount,
  filterBar,
  matchCount,
  openFilters,
  resetFilters,
  search,
  searchInput,
} from "@/helpers/filters.js";

test.skip(
  !process.env.E2E_COMPOSE_PROJECT,
  "Requires the disposable Docker database",
);

/**
 * F-02: Reset filters clears the query and every facet — including the
 * assignee, link and creation facets the old test never touched — plus their
 * chips, the result count and the facet badge.
 */
test("reset filters clears every facet, chip and badge", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const bug = await board.label("Bug", "red");
  const alpha = await board.card(todo, "Alpha task");
  const beta = await board.card(todo, "Beta clean");
  const now = Date.now();
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: alpha,
    dueDate: now - 60 * 60 * 1000,
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
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId: alpha,
    assigneeId: board.userId,
  });
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: alpha,
    linkId: randomUUID(),
    targetCardId: beta,
    linkType: "relates_to",
  });
  await ageCards(board.id, [alpha], 10);

  await board.open(page);
  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "Overdue" }).click();
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await popover.getByRole("checkbox").filter({ hasText: board.email }).click();
  await popover
    .getByRole("checkbox", { name: "Has links", exact: true })
    .click();
  await popover.getByRole("radio", { name: "Last 30 days" }).click();
  await closeFilters(page);
  await search(page, "Alpha");

  await expectCardTitles(page, ["Alpha task"]);
  await expect(facetCount(page)).toHaveText("7");
  for (const facet of ["due", "label", "priority", "assignee", "created"]) {
    await expect(facetChip(page, facet)).toHaveCount(1);
  }
  await expect(matchCount(page)).toHaveText("1 card found");

  await resetFilters(page);

  await expect(searchInput(page)).toHaveValue("");
  await expectCardTitles(page, ["Alpha task", "Beta clean"]);
  await expect(matchCount(page)).toHaveCount(0);
  await expect(facetCount(page)).toHaveCount(0);
  await expect(
    filterBar(page).getByRole("button", { name: "Filter cards" }),
  ).toHaveText("Filters");
  await expect(filterBar(page).getByTestId("filter-chip")).toHaveCount(0);
  expect(new URL(page.url()).search).not.toContain("f.");

  const reopened = await openFilters(page);
  await expect(
    reopened.getByRole("radio", { name: "Any due date" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    reopened.getByRole("radio", { name: "Any time" }),
  ).toHaveAttribute("aria-checked", "true");
  for (const name of ["Bug", "High", "Unassigned", "Blocked", "Has links"]) {
    await expect(
      reopened.getByRole("checkbox", { name, exact: true }),
    ).toHaveAttribute("aria-checked", "false");
  }
  await expect(
    reopened.getByRole("checkbox").filter({ hasText: board.email }),
  ).toHaveAttribute("aria-checked", "false");
  await closeFilters(page);
});
