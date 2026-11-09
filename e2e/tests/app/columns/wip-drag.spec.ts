import { test, expect } from "@/fixtures/board.js";
import { cardOrder, columnSection } from "@/helpers/history.js";
import { dragCardToColumn } from "@/helpers/boards.js";

test("refuses to drop a card into a WIP-full column", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  await board.card(todo, "Movable");
  await board.card(doing, "Occupied");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: doing,
    wipLimit: 1,
  });
  await board.open(page);

  await dragCardToColumn(page, "Movable", "Doing");

  await expect(
    page.getByRole("status").filter({
      hasText: /“Doing” is at its WIP limit \(1\)/,
    }),
  ).toBeVisible();
  expect(await cardOrder(page, "Todo")).toEqual(["Movable"]);
  expect(await cardOrder(page, "Doing")).toEqual(["Occupied"]);
  await expect(
    columnSection(page, "Doing").getByTestId("column-wip"),
  ).toHaveText("1/1");

  await page.reload();
  await expect.poll(() => cardOrder(page, "Todo")).toEqual(["Movable"]);
  await expect.poll(() => cardOrder(page, "Doing")).toEqual(["Occupied"]);
});
