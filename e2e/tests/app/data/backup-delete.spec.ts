import { test, expect } from "@/fixtures/board.js";

test("keeps backup management out of the server-mode data menu", async ({
  page,
  board,
}) => {
  await board.open(page);
  await page.getByRole("button", { name: "Data & backups" }).click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("data-backups")).toHaveCount(0);
  await expect(
    menu.getByRole("menuitem", { name: "Save a copy now" }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole("menuitem", { name: "Export JSON" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Import JSON" }),
  ).toBeVisible();
});
