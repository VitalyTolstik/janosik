import { test, expect } from "@/fixtures/board.js";

test("cancelling the archive confirmation keeps the board active", async ({
  page,
  board,
}) => {
  await board.open(page);
  await page.getByRole("button", { name: "Switch board" }).click();
  const row = page.getByRole("option").filter({ hasText: board.title });
  await row.hover();
  await row.getByRole("button", { name: "Archive board" }).click();
  await row.getByRole("button", { name: "Cancel" }).click();

  await expect(row).toBeVisible();
  await expect(page.getByTestId("archived-section")).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Archive board" }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(
    page.getByRole("option").filter({ hasText: board.title }),
  ).toBeVisible();
  await expect(page.getByTestId("archived-section")).toHaveCount(0);
});
