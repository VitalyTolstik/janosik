import { test, expect } from "@/fixtures/data.js";
import { openDataMenu } from "@/helpers/data.js";

test("does not offer local backups in server mode", async ({ page, board }) => {
  await board.open(page);

  const menu = await openDataMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: "Save a copy now" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("data-backups")).toHaveCount(0);
  await expect(
    menu.getByRole("menuitem", { name: "Export JSON" }),
  ).toBeVisible();
});
