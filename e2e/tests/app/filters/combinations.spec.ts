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
  removeChip,
  search,
} from "@/helpers/filters.js";

test.skip(
  !process.env.E2E_COMPOSE_PROJECT,
  "Requires the disposable Docker database",
);

/**
 * F-01: every facet combines with AND. Seven cards each break exactly one
 * facet, so removing that facet must reveal exactly that one neighbour —
 * which the old "all facets match one card" test could never prove. The
 * query is common to every title, so the text facet is active but never
 * masks a facet failure.
 */
test("applies every facet with AND and counts each one", async ({
  page,
  board,
}) => {
  test.setTimeout(90_000);
  const todo = await board.column("Todo");
  const bug = await board.label("Bug", "red");
  const feature = await board.label("Feature", "blue");
  const matchAll = await board.card(todo, "Match all");
  const wrongLabel = await board.card(todo, "Match wrong label");
  const wrongPriority = await board.card(todo, "Match wrong priority");
  const wrongAssignee = await board.card(todo, "Match wrong assignee");
  const noLink = await board.card(todo, "Match no link");
  const noDue = await board.card(todo, "Match no due");
  const old = await board.card(todo, "Match old");
  const overdue = Date.now() - 60 * 60 * 1000;

  const cards = [
    matchAll,
    wrongLabel,
    wrongPriority,
    wrongAssignee,
    noLink,
    noDue,
    old,
  ];
  for (const cardId of cards) {
    if (cardId !== noDue) {
      await board.command({
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate: overdue,
      });
    }
    await board.command({
      type: "SET_CARD_LABEL",
      cardId,
      labelId: cardId === wrongLabel ? feature : bug,
      on: true,
    });
    await board.command({
      type: "SET_CARD_PRIORITY",
      cardId,
      priority: cardId === wrongPriority ? "low" : "high",
    });
    if (cardId !== wrongAssignee) {
      await board.command({
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId: board.userId,
      });
    }
  }
  // Every card except "Match no link" has a link. Links are only ever added
  // to/from linked cards, so the no-link card stays at degree zero.
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: matchAll,
    linkId: randomUUID(),
    targetCardId: wrongLabel,
    linkType: "relates_to",
  });
  for (const cardId of [wrongLabel, wrongPriority, wrongAssignee, noDue, old]) {
    await board.command({
      type: "ADD_CARD_LINK",
      cardId,
      linkId: randomUUID(),
      targetCardId: matchAll,
      linkType: "relates_to",
    });
  }
  // "Match old" was created ten days ago; Last 7 days must exclude it.
  await ageCards(board.id, [old], 10);

  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("radio", { name: "Overdue" }).click();
  await popover.getByRole("checkbox", { name: "Bug", exact: true }).click();
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await popover.getByRole("checkbox").filter({ hasText: board.email }).click();
  await popover
    .getByRole("checkbox", { name: "Has links", exact: true })
    .click();
  await popover.getByRole("radio", { name: "Last 7 days" }).click();
  await closeFilters(page);
  await search(page, "Match");

  await expectCardTitles(page, ["Match all"]);
  await expect(matchCount(page)).toHaveText("1 card found");
  // query + due + label + priority + assignee + links + created
  await expect(facetCount(page)).toHaveText("7");
  await expect(
    filterBar(page).getByRole("button", { name: "Filter cards" }),
  ).toContainText("Filters");

  const cases = [
    {
      facet: "label",
      neighbour: "Match wrong label",
      readd: async () =>
        (await openFilters(page))
          .getByRole("checkbox", { name: "Bug", exact: true })
          .click(),
    },
    {
      facet: "priority",
      neighbour: "Match wrong priority",
      readd: async () =>
        (await openFilters(page))
          .getByRole("checkbox", { name: "High", exact: true })
          .click(),
    },
    {
      facet: "assignee",
      neighbour: "Match wrong assignee",
      readd: async () =>
        (await openFilters(page))
          .getByRole("checkbox")
          .filter({ hasText: board.email })
          .click(),
    },
    {
      facet: "links",
      neighbour: "Match no link",
      readd: async () =>
        (await openFilters(page))
          .getByRole("checkbox", { name: "Has links", exact: true })
          .click(),
    },
    {
      facet: "due",
      neighbour: "Match no due",
      readd: async () =>
        (await openFilters(page))
          .getByRole("radio", { name: "Overdue" })
          .click(),
    },
    {
      facet: "created",
      neighbour: "Match old",
      readd: null,
    },
  ] as const;

  for (const entry of cases) {
    await removeChip(page, entry.facet);
    await expectCardTitles(page, ["Match all", entry.neighbour]);
    await expect(facetCount(page)).toHaveText("6");
    if (entry.readd) {
      await entry.readd();
      await closeFilters(page);
      await expectCardTitles(page, ["Match all"]);
      await expect(facetCount(page)).toHaveText("7");
    }
  }

  // The last removal is the creation window: only the ten-day-old card is
  // outside it, and it stays excluded when every other facet is still on.
  await expect(facetChip(page, "created")).toHaveCount(0);
  await expect(matchCount(page)).toHaveText("2 cards found");
});
