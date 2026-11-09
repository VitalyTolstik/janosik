import { test, expect } from "@/fixtures/data.js";
import { chooseImportFile } from "@/helpers/data.js";

test("reports a server failure without a success toast", async ({
  page,
  board,
  data,
}) => {
  const importable = await data.importableBoard({
    columns: ["Todo"],
    cards: [{ column: "Todo", title: "Never lands" }],
  });
  await board.open(page);
  const before = (await data.listBoards()).map((entry) => entry.id);
  let posts = 0;
  await page.route("**/api/v1/boards/import", async (route) => {
    posts += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Internal server error" }),
    });
  });

  await chooseImportFile(page, importable.file);

  await expect(
    page.getByRole("status").filter({ hasText: "Import failed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Board imported" }),
  ).toHaveCount(0);
  expect(posts).toBe(1);
  const after = (await data.listBoards()).map((entry) => entry.id);
  expect(after).toEqual(before);
});
