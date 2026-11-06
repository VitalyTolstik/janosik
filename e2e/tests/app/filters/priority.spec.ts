import { test } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  openFilters,
} from "@/helpers/filters.js";

async function boardWithPriorities(board: {
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  command: (action: Record<string, unknown>) => Promise<void>;
}) {
  const todo = await board.column("Todo");
  const blocker = await board.card(todo, "Blocker task");
  const high = await board.card(todo, "High task");
  const medium = await board.card(todo, "Explicit medium");
  await board.card(todo, "Implicit medium");
  const low = await board.card(todo, "Low task");
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: blocker,
    priority: "blocker",
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: high,
    priority: "high",
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: medium,
    priority: "medium",
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId: low,
    priority: "low",
  });
}

test("filters by priority and treats unset as medium", async ({
  page,
  board,
}) => {
  await boardWithPriorities(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "Medium", exact: true }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Explicit medium", "Implicit medium"]);
});

test("filters by several priorities at once", async ({ page, board }) => {
  await boardWithPriorities(board);
  await board.open(page);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox", { name: "High", exact: true }).click();
  await popover.getByRole("checkbox", { name: "Low", exact: true }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["High task", "Low task"]);
});
