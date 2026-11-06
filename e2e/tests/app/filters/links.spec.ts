import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";
import { expectCardTitles, filterBar, pickFacet } from "@/helpers/filters.js";

async function boardWithLinks(board: {
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  command: (action: Record<string, unknown>) => Promise<void>;
}) {
  const todo = await board.column("Todo");
  const blocker = await board.card(todo, "Blocker card");
  const blocked = await board.card(todo, "Blocked card");
  await board.card(todo, "Unrelated card");
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: blocker,
    linkId: randomUUID(),
    targetCardId: blocked,
    linkType: "blocks",
  });
  return { blocker, blocked };
}

test("filters blocked cards", async ({ page, board }) => {
  await boardWithLinks(board);
  await board.open(page);

  await pickFacet(page, "checkbox", "Blocked");

  await expectCardTitles(page, ["Blocked card"]);
});

test("does not treat an archived blocker as blocking", async ({
  page,
  board,
}) => {
  const { blocker } = await boardWithLinks(board);
  await board.command({ type: "ARCHIVE_CARD", cardId: blocker });
  await board.open(page);

  await pickFacet(page, "checkbox", "Blocked");

  await expectCardTitles(page, []);
  await expect(filterBar(page).getByText("0 cards found")).toBeVisible();
});

test("filters cards with links in either direction", async ({
  page,
  board,
}) => {
  await boardWithLinks(board);
  await board.open(page);

  await pickFacet(page, "checkbox", "Has links");

  await expectCardTitles(page, ["Blocker card", "Blocked card"]);
});
