import { test, expect } from "@/fixtures/board.js";
import { expectCardTitles, search } from "@/helpers/filters.js";

test("trims whitespace around the board search query", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Buy milk");
  await board.card(todo, "Sell chair");
  await board.open(page);

  await search(page, "  bUy  ");

  await expectCardTitles(page, ["Buy milk"]);
});
