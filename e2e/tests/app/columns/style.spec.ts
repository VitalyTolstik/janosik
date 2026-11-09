import { type Page } from "@playwright/test";
import { test, expect } from "@/fixtures/board.js";
import { columnSection, expectHistory, redo, undo } from "@/helpers/history.js";

/**
 * Column accent styles (TASK-164): per-column color, board-wide shape,
 * persistence, undo/redo, duplicate and the nine rendering shapes.
 */

async function openPalette(page: Page, columnName: string) {
  await columnSection(page, columnName)
    .getByTestId("column-style-trigger")
    .click();
  await expect(page.getByTestId("column-style-palette")).toBeVisible();
}

async function chooseColor(page: Page, value: string) {
  await page.getByTestId(`column-style-option-${value}`).click();
}

function columnOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator('section > header[role="group"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
}

test("sets a color on one column only, survives reload and resets", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.column("Done");
  await board.open(page);

  await openPalette(page, "Todo");
  await chooseColor(page, "brand");
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "brand",
  );
  await expect(columnSection(page, "Done")).toHaveAttribute(
    "data-column-accent",
    "none",
  );
  await expect(page.getByTestId("column-style-palette")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "brand",
  );
  await expect(columnSection(page, "Done")).toHaveAttribute(
    "data-column-accent",
    "none",
  );

  await openPalette(page, "Todo");
  await page.getByTestId("column-style-reset").click();
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "none",
  );
  await page.reload();
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "none",
  );
});

test("applies all nine board-wide shapes and persists the choice", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "gradient", value: "ocean" },
  });
  await board.open(page);

  const styles = [
    "rail",
    "left",
    "wash",
    "title",
    "glow",
    "glass",
    "band",
    "dot",
    "signature",
  ];
  await page.getByTestId("column-style-menu").click();
  // The open dropdown marks the board inert/aria-hidden, so address the
  // column by its DOM attribute instead of the header's role.
  const accentColumn = page.locator('section[data-column-accent="ocean"]');
  for (const style of styles) {
    await page.getByTestId(`column-style-menu-${style}`).click();
    await expect(accentColumn).toHaveAttribute(
      "data-column-accent-style",
      style,
    );
  }
  // Leave a non-default shape and prove the board (not this browser) keeps it.
  await page.getByTestId("column-style-menu-glow").click();
  await page.keyboard.press("Escape");
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "glow",
  );

  await page.reload();
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "glow",
  );
});

test("undo and redo the color and the board shape", async ({ page, board }) => {
  await board.column("Todo");
  await board.open(page);

  await openPalette(page, "Todo");
  await chooseColor(page, "red");
  await page.keyboard.press("Escape");
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "red",
  );
  await expectHistory(page, { undo: true, redo: false });
  await undo(page);
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "none",
  );
  await redo(page);
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "red",
  );

  await page.getByTestId("column-style-menu").click();
  await page.getByTestId("column-style-menu-band").click();
  await page.keyboard.press("Escape");
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "band",
  );
  await undo(page);
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "signature",
  );
  await redo(page);
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent-style",
    "band",
  );
});

test("duplicate keeps the column accent", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "color", value: "teal" },
  });
  await board.open(page);

  await columnSection(page, "Todo")
    .getByRole("button", { name: "Column options" })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate column" }).click();

  await expect(columnSection(page, "Copy of Todo")).toHaveAttribute(
    "data-column-accent",
    "teal",
  );
});

test("the accent brush does not start a column drag", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.column("Done");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "color", value: "brand" },
  });
  await board.open(page);
  await expect.poll(() => columnOrder(page)).toEqual(["Todo", "Done"]);

  const brush = columnSection(page, "Todo").getByTestId("column-style-trigger");
  const box = await brush.boundingBox();
  if (!box) throw new Error("Accent brush is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  // A drag would move Todo after Done; a stopped pointer keeps the order.
  await expect.poll(() => columnOrder(page)).toEqual(["Todo", "Done"]);
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "brand",
  );
});

test("a gradient accent renders and clears", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "gradient", value: "sunset" },
  });
  await board.open(page);

  const section = columnSection(page, "Todo");
  await expect(section).toHaveAttribute("data-column-accent", "sunset");
  await expect(section).toHaveAttribute("data-column-accent-type", "gradient");

  await openPalette(page, "Todo");
  await page.getByTestId("column-style-reset").click();
  await expect(section).toHaveAttribute("data-column-accent", "none");
  await expect(section).toHaveAttribute("data-column-accent-type", "none");
});
