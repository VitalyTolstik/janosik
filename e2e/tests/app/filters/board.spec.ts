import { test, expect } from "@/fixtures/board.js";
import { filterBar, search } from "@/helpers/filters.js";

test("disables drag and drop while a filter is active", async ({
  page,
  board,
}) => {
  const first = await board.column("First");
  const second = await board.column("Second");
  await board.card(first, "Alpha task");
  await board.card(first, "Beta task");
  await board.open(page);
  const firstColumn = page
    .locator("section")
    .filter({ has: page.getByRole("group", { name: "First", exact: true }) });
  const secondColumn = page
    .locator("section")
    .filter({ has: page.getByRole("group", { name: "Second", exact: true }) });

  await search(page, "Alpha");
  await expect(
    filterBar(page).getByText("Dragging is disabled while a filter is active"),
  ).toBeVisible();

  const source = await firstColumn.getByTestId("card-title").boundingBox();
  const target = await secondColumn
    .getByTestId("column-card-scroll")
    .boundingBox();
  if (!source || !target) throw new Error("Card or column is not visible");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y, {
    steps: 3,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + 50, {
    steps: 20,
  });
  await page.mouse.up();

  await expect(firstColumn.getByTestId("card-title")).toHaveText("Alpha task");
  await expect(secondColumn.getByTestId("card-title")).toHaveCount(0);
});
