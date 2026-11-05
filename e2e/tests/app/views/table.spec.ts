import { test, expect } from "@/fixtures/board.js";

test("create and rename a card in the table and retain it in other views", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Table" }).click();
  await page.getByTestId("table-add-card").click();
  const composer = page.getByTestId("table-composer-input");
  await composer.fill("Table task");
  await composer.press("Enter");
  await page.keyboard.press("Escape");
  const row = page.getByTestId("table-row").filter({ hasText: "Table task" });
  await expect(row).toBeVisible();
  await row.getByText("Table task", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog
    .getByRole("textbox", { name: "Title" })
    .fill("Renamed table task");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Renamed table task" }),
  ).toBeVisible();
  await views.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Renamed table task" }),
  ).toBeVisible();
  await page.reload();
  await views.getByRole("button", { name: "Table" }).click();
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Renamed table task" }),
  ).toBeVisible();
});
