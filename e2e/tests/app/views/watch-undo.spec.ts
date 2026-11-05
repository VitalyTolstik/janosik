import { test, expect } from "@/fixtures/board.js";

test("watch shows the actual undo and redo of a card creation", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Table" }).click();
  await page.getByTestId("table-add-card").click();
  const composer = page.getByTestId("table-composer-input");
  await composer.fill("Undo task");
  await composer.press("Enter");
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Undo task" }),
  ).toBeVisible();
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(
    page
      .getByTestId("watch-entry")
      .filter({ hasText: "Undo task" })
      .filter({ hasText: "Created" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Deleted the card" }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    page
      .getByTestId("watch-entry")
      .filter({ hasText: "Undo task" })
      .filter({ hasText: "Created" }),
  ).toHaveCount(2, { timeout: 15000 });
});
