import { test, expect } from "@/fixtures/board.js";

test("watch reflects board columns and card counts across view changes", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "First task");
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();
  const todo = page
    .getByTestId("watch-column-list")
    .getByRole("listitem")
    .filter({ hasText: "Todo" });
  await expect(todo).toContainText("1");
  await views.getByRole("button", { name: "Table" }).click();
  await page.getByTestId("table-add-card").click();
  const composer = page.getByTestId("table-composer-input");
  await composer.fill("Second task");
  await composer.press("Enter");
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Second task" }),
  ).toBeVisible();
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(todo).toContainText("2");
  await expect(
    page
      .getByTestId("watch-entry")
      .filter({ hasText: "Second task" })
      .filter({ hasText: "Created" }),
  ).toBeVisible();
  await page.reload();
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(todo).toContainText("2");
});
