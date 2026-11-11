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

test("keeps board display preferences in the combined menu after reload", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await page.getByTestId("board-display-menu").click();

  const toggles = ["density-toggle", "glass-opacity", "glass-blur"];
  const expected: Record<string, string> = {};
  for (const id of toggles) {
    const item = page.getByTestId(id);
    const initial = await item.getAttribute("aria-checked");
    expected[id] = initial === "true" ? "false" : "true";
    await item.click();
    await expect(item).toHaveAttribute("aria-checked", expected[id]);
  }
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    expected["density-toggle"] === "true" ? "compact" : "full",
  );

  await page.reload();
  await page.getByTestId("board-display-menu").click();
  for (const id of toggles) {
    await expect(page.getByTestId(id)).toHaveAttribute(
      "aria-checked",
      expected[id],
    );
  }
});

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

test("closes the palette on the first outside click after picking a color", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.column("Done");
  await board.open(page);

  await openPalette(page, "Todo");
  await chooseColor(page, "blue");
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "blue",
  );

  // Regression: the palette used to stop `pointerdown`, so Radix's
  // dismissable layer never saw the gesture end and swallowed the first
  // outside click — the palette only closed on the second one.
  const outside = columnSection(page, "Done").getByTestId("column-card-scroll");
  await outside.click();
  await expect(page.getByTestId("column-style-palette")).toBeHidden();
});

test("previews the pick against the current board shape", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.command({ type: "SET_BOARD_COLUMN_STYLE", columnStyle: "band" });
  await board.open(page);

  await openPalette(page, "Todo");
  const palette = page.getByTestId("column-style-palette");
  // 12 colors + 6 gradients.
  await expect(palette.getByRole("radio")).toHaveCount(18);

  const preview = page.getByTestId("column-style-preview");
  await expect(preview).toHaveAttribute("data-column-accent", "none");
  await expect(preview).toHaveAttribute("data-column-accent-style", "none");

  await chooseColor(page, "teal");
  await expect(preview).toHaveAttribute("data-column-accent", "teal");
  await expect(preview).toHaveAttribute("data-column-accent-type", "color");
  // The preview follows the board-wide shape, not a hardcoded default.
  await expect(preview).toHaveAttribute("data-column-accent-style", "band");
  await expect(palette).toBeVisible();

  await page.getByTestId("column-style-option-ocean").click();
  await expect(preview).toHaveAttribute("data-column-accent", "ocean");
  await expect(preview).toHaveAttribute("data-column-accent-type", "gradient");
  await expect(preview).toHaveAttribute("data-column-accent-style", "band");
  await expect(palette).toBeVisible();
  await expect(columnSection(page, "Todo")).toHaveAttribute(
    "data-column-accent",
    "ocean",
  );

  await page.getByTestId("column-style-reset").click();
  await expect(preview).toHaveAttribute("data-column-accent", "none");
  await expect(preview).toHaveAttribute("data-column-accent-style", "none");
});

test("applies the board shape only to accented columns", async ({
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

  const accented = columnSection(page, "Todo");
  const plain = columnSection(page, "Done");
  await expect(accented).toHaveAttribute(
    "data-column-accent-style",
    "signature",
  );
  await expect(plain).toHaveAttribute("data-column-accent", "none");
  await expect(plain).toHaveAttribute("data-column-accent-style", "none");

  await page.getByTestId("board-display-menu").click();
  await page.getByTestId("column-style-menu").click();
  await page.getByTestId("column-style-menu-band").click();
  await expect(accented).toHaveAttribute("data-column-accent-style", "band");
  await expect(plain).toHaveAttribute("data-column-accent-style", "none");
  await expect(plain).not.toHaveClass(/janosik-column-accent/);
  await page.keyboard.press("Escape");
});

test("renders all nine accent shapes in light and dark", async ({
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
  ] as const;

  const metrics = () =>
    columnSection(page, "Todo").evaluate((element) => {
      const section = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      const head = element.querySelector<HTMLElement>(
        ".janosik-column-accent-head",
      );
      const heading = element.querySelector<HTMLElement>(
        ".janosik-column-accent-heading",
      );
      const dotmark = element.querySelector<HTMLElement>(
        ".janosik-column-accent-dotmark",
      );
      if (!head || !heading || !dotmark) {
        throw new Error("Accent head, heading or dotmark is missing");
      }
      const after = getComputedStyle(heading, "::after");
      return {
        backgroundImage: section.backgroundImage,
        boxShadow: section.boxShadow,
        beforeContent: before.content,
        beforeHeight: before.height,
        beforeWidth: before.width,
        headBackground: getComputedStyle(head).backgroundColor,
        headingColor: getComputedStyle(heading).color,
        afterContent: after.content,
        afterWidth: after.width,
        dotDisplay: getComputedStyle(dotmark).display,
      };
    });

  const seen: Record<string, Awaited<ReturnType<typeof metrics>>> = {};

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(
      (value) => localStorage.setItem("janosik-theme", value),
      theme,
    );
    await page.reload();
    await expect(columnSection(page, "Todo")).toHaveAttribute(
      "data-column-accent",
      "brand",
    );

    await page.getByTestId("board-display-menu").click();
    for (const style of styles) {
      await page.getByTestId("column-style-menu").click();
      await page.getByTestId(`column-style-menu-${style}`).click();
      await expect(columnSection(page, "Todo")).toHaveAttribute(
        "data-column-accent-style",
        style,
      );
      // Colour/box-shadow transitions are 150 ms (brand tokens); read the
      // computed values after they settle so the assertions see the shape,
      // not an intermediate frame.
      await page.waitForTimeout(200);
      seen[`${theme}:${style}`] = await metrics();
    }
    await page.keyboard.press("Escape");
  }

  for (const theme of ["dark", "light"] as const) {
    const rail = seen[`${theme}:rail`];
    expect(rail.beforeContent).not.toBe("none");
    expect(rail.beforeHeight).toBe("3px");

    expect(seen[`${theme}:left`].beforeWidth).toBe("4px");

    const wash = seen[`${theme}:wash`];
    expect(wash.backgroundImage).toContain("linear-gradient");
    expect(wash.headBackground).not.toBe("rgba(0, 0, 0, 0)");

    const title = seen[`${theme}:title`];
    expect(title.afterContent).not.toBe("none");
    expect(title.afterWidth).toBe("18px");

    expect(seen[`${theme}:glow`].boxShadow).toContain("inset");

    const glass = seen[`${theme}:glass`];
    expect(glass.boxShadow).toContain("inset");
    expect(glass.beforeHeight).toBe("3px");

    const band = seen[`${theme}:band`];
    expect(band.headingColor).toBe("rgb(255, 255, 255)");
    expect(band.headBackground).not.toBe("rgba(0, 0, 0, 0)");

    // The dot mark is a flex item, so its computed display is blockified.
    expect(seen[`${theme}:rail`].dotDisplay).toBe("none");
    expect(seen[`${theme}:dot`].dotDisplay).not.toBe("none");

    const signature = seen[`${theme}:signature`];
    expect(signature.beforeHeight).toBe("2px");
    expect(signature.dotDisplay).not.toBe("none");
  }

  // The title style mixes toward the foreground in light mode, so the two
  // themes must produce different computed heading colors.
  expect(seen["light:title"].headingColor).not.toBe(
    seen["dark:title"].headingColor,
  );
});

test("keeps the accent on the column drag preview", async ({ page, board }) => {
  const todo = await board.column("Todo");
  await board.column("Done");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "color", value: "brand" },
  });
  await board.command({ type: "SET_BOARD_COLUMN_STYLE", columnStyle: "band" });
  await board.open(page);

  const header = columnSection(page, "Todo").getByRole("group", {
    name: "Todo",
    exact: true,
  });
  const box = await header.boundingBox();
  if (!box) throw new Error("Column header is not visible");

  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2 + 24, {
    steps: 10,
  });

  // DragOverlay clones the column; the accent shape has to survive the drag.
  const overlay = page.locator(
    'div[data-column-accent="brand"][data-column-accent-style="band"]',
  );
  await expect(overlay).toBeVisible();

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(overlay).toHaveCount(0);
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
  await page.getByTestId("board-display-menu").click();
  // The open dropdown marks the board inert/aria-hidden, so address the
  // column by its DOM attribute instead of the header's role.
  const accentColumn = page.locator('section[data-column-accent="ocean"]');
  for (const style of styles) {
    await page.getByTestId("column-style-menu").click();
    await page.getByTestId(`column-style-menu-${style}`).click();
    await expect(accentColumn).toHaveAttribute(
      "data-column-accent-style",
      style,
    );
  }
  // Leave a non-default shape and prove the board (not this browser) keeps it.
  await page.getByTestId("column-style-menu").click();
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

  await page.getByTestId("board-display-menu").click();
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

  // The portaled palette still bubbles React pointer events to the header's
  // drag handle — dragging from a swatch must not reorder the columns either.
  await openPalette(page, "Todo");
  const swatch = page.getByTestId("column-style-option-teal");
  const swatchBox = await swatch.boundingBox();
  if (!swatchBox) throw new Error("Accent swatch is not visible");
  await page.mouse.move(
    swatchBox.x + swatchBox.width / 2,
    swatchBox.y + swatchBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    swatchBox.x + swatchBox.width / 2 + 140,
    swatchBox.y + 120,
    {
      steps: 12,
    },
  );
  await page.mouse.up();

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
