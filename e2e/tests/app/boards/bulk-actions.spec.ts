import { test, expect } from "@/fixtures/board.js";
import { getBoard } from "@/helpers/boards.js";

function cardTitles(page: import("@playwright/test").Page, title: string) {
  return page.getByTestId("card-title").filter({ hasText: title });
}

test("selects cards across columns, moves them and undoes one step", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  const alpha = await board.card(todo, "Alpha");
  const bravo = await board.card(doing, "Bravo");
  await board.open(page);

  await page.getByTestId("bulk-select-toggle").click();
  await cardTitles(page, "Alpha").click();
  await cardTitles(page, "Bravo").click();
  await expect(page.getByTestId("bulk-count")).toHaveText("2 selected");
  await expect(
    page.getByRole("checkbox", { name: "Deselect Alpha" }),
  ).toBeChecked();

  await page.getByTestId("bulk-move").click();
  await page.getByTestId(`bulk-move-${done}`).click();
  await expect(page.getByTestId("bulk-status")).toContainText(
    "2 of 2 cards changed",
  );
  await expect
    .poll(async () => {
      const snapshot = await getBoard(board.api, board.id);
      return snapshot.columns.find((column) => column.id === done)?.cardIds;
    })
    .toEqual(expect.arrayContaining([alpha, bravo]));

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => {
      const snapshot = await getBoard(board.api, board.id);
      return snapshot.columns.find((column) => column.id === doing)?.cardIds;
    })
    .toContain(bravo);
  await expect
    .poll(async () => {
      const snapshot = await getBoard(board.api, board.id);
      return snapshot.columns.find((column) => column.id === done)?.cardIds;
    })
    .toEqual([alpha]);
});

test("reports a per-card WIP failure and keeps successful moves", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: doing,
    wipLimit: 1,
  });
  await board.card(todo, "Alpha");
  await board.card(todo, "Bravo");
  await board.open(page);

  await page.getByTestId("bulk-select-toggle").click();
  await cardTitles(page, "Alpha").click();
  await cardTitles(page, "Bravo").click();
  await page.getByTestId("bulk-move").click();
  await page.getByTestId(`bulk-move-${doing}`).click();

  await expect(page.getByTestId("bulk-status")).toContainText(
    "1 of 2 cards changed",
  );
  await expect(page.getByTestId("bulk-errors")).toContainText("Bravo");
  await expect(page.getByTestId("bulk-errors")).toContainText(
    /WIP limit \(1\)/,
  );
  await expect(page.getByTestId("bulk-count")).toHaveText("2 selected");

  const snapshot = await getBoard(board.api, board.id);
  expect(
    snapshot.columns.find((column) => column.id === doing)?.cardIds,
  ).toHaveLength(1);
  expect(
    snapshot.columns.find((column) => column.id === todo)?.cardIds,
  ).toHaveLength(1);
});

for (const width of [390, 768] as const) {
  test(`bulk actions keep 44 px targets at ${width} px`, async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const todo = await board.column("Todo");
    await board.card(todo, "Alpha");
    await board.open(page);

    await page.getByTestId("bulk-select-toggle").click();
    await cardTitles(page, "Alpha").click();
    await expect(page.getByTestId("bulk-bar")).toBeVisible();

    for (const testId of [
      "bulk-select-all",
      "bulk-move",
      "bulk-label",
      "bulk-archive",
      "bulk-delete",
      "bulk-clear",
    ]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box?.height ?? 0, testId).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
