import { test, expect } from "@/fixtures/board.js";
import { appUrl } from "@/helpers/urls.js";

test("watch shows board archive and unarchive commands", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await board.command({ type: "ARCHIVE_BOARD" });
  await expect(
    page.getByRole("heading", { name: "All boards are archived." }),
  ).toBeVisible({ timeout: 15000 });
  await board.command({ type: "UNARCHIVE_BOARD" });
  await page.goto(new URL(`board/${board.id}`, appUrl).href);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Archived the board" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Restored the board" }),
  ).toBeVisible({ timeout: 15000 });
});
