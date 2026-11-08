import { test, expect } from "@/fixtures/board.js";
import { cardOrder, columnSection } from "@/helpers/history.js";

test("inserts a card at the hover position between two cards", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "First");
  await board.card(todo, "Second");
  await board.open(page);
  const column = columnSection(page, "Todo");

  const zone = column.getByTestId("card-insert-zone-1");
  await zone.hover();
  await column.getByTestId("card-insert-1").click();
  const composer = column.locator('[name="card-composer"]');
  await expect(composer).toBeVisible();
  await composer.fill("Middle");
  await composer.press("Enter");

  expect(await cardOrder(page, "Todo")).toEqual(["First", "Middle", "Second"]);
  await page.reload();
  await expect
    .poll(() => cardOrder(page, "Todo"))
    .toEqual(["First", "Middle", "Second"]);
});
