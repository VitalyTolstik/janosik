import { test, expect } from "@/fixtures/board.js";
import { expectHistory, redo, undo } from "@/helpers/history.js";

test("undo and redo board rename", async ({ page, board }) => {
  await board.open(page);
  const originalTitle = await page.locator("header h2").innerText();

  await page.locator("header h2").click();
  await page.locator('[name="board-title-edit"]').fill("Renamed board");
  await page.locator('[name="board-title-edit"]').press("Enter");
  await expect(
    page.getByRole("heading", { name: "Renamed board" }),
  ).toBeVisible();

  await undo(page);
  await expect(
    page.getByRole("heading", { name: originalTitle }),
  ).toBeVisible();
  await expectHistory(page, { undo: false, redo: true });

  await redo(page);
  await expect(
    page.getByRole("heading", { name: "Renamed board" }),
  ).toBeVisible();
  await expectHistory(page, { undo: true, redo: false });
});
