import { test, expect } from "@/fixtures/board.js";
import { openDataMenu } from "@/helpers/data.js";

test("keeps backup management out of the server-mode data menu", async ({
  page,
  board,
}) => {
  await board.open(page);
  const menu = await openDataMenu(page);
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
