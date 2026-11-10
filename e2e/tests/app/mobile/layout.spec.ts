import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";
import {
  expectInsideViewport,
  expectNoOwnOverflow,
  expectNoPageOverflow,
  touchDoubleTap,
  touchSwipe,
} from "@/helpers/touch.js";

/**
 * 390 px layout and touch-gesture regression suite (TASK-31).
 *
 * The phone width is where the old chrome overflowed: the header packed two
 * icon rows, the calendar kept its 224 px unscheduled rail next to seven day
 * columns, and the table forced its four fixed-width columns into ~350 px.
 * Every dialog opened here must fit the viewport and scroll only vertically,
 * and the gestures that already existed (double-tap rename, touch card
 * creation, column scrolling, closing dialogs) must keep working.
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function expectDialogFits(page: Page, locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  await expectInsideViewport(locator, label);
  await expectNoOwnOverflow(locator, label);
  await expectNoPageOverflow(page, label);
}

test("header, filters and view controls fit a phone without sideways scroll", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Mobile card");
  await board.open(page);

  await expectNoPageOverflow(page, "board");
  const header = page.locator("header").first();
  await expectInsideViewport(header, "header");
  await expectNoOwnOverflow(header, "header");
  await expect(
    page.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expect(page.getByTestId("filter-bar")).toBeVisible();

  // The view switcher keeps its accessible names while showing icons only.
  const views = page.getByRole("group", { name: "View", exact: true });
  for (const name of ["Board", "Calendar", "Table", "Watch"]) {
    await expect(
      views.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }

  const filters = page.getByRole("button", { name: "Filter cards" });
  await filters.tap();
  const popover = page.getByTestId("filters-popover");
  await expectDialogFits(page, popover, "filters popover");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // Inline board-title editing replaces the truncated heading with a field
  // that must also fit the first header row.
  await page.locator("header h2").first().tap();
  const titleInput = page.locator('[name="board-title-edit"]');
  await expect(titleInput).toBeVisible();
  await expectNoPageOverflow(page, "board title editor");
  await expectInsideViewport(titleInput, "board title editor");
  await titleInput.press("Escape");
});

test("board dialogs fit the phone and close by touch", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(
    todo,
    "A long card title that would otherwise push dialog controls out of a 390 px viewport",
  );
  await board.command({ type: "ARCHIVE_CARD", cardId });
  await board.card(todo, "Visible mobile card");
  await board.open(page);

  // Card details.
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Visible mobile card" })
    .tap();
  const cardDialog = page.getByRole("dialog", { name: "Card details" });
  await expectDialogFits(page, cardDialog, "card details");
  await cardDialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .tap();
  await expect(cardDialog).toBeHidden();

  // Members.
  await page.getByRole("button", { name: "Members", exact: true }).tap();
  const members = page.getByRole("dialog");
  await expectDialogFits(page, members, "members");
  await expect(page.getByTestId("board-members-box")).toBeVisible();
  await members.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(members).toBeHidden();

  // Share link.
  await page.getByRole("button", { name: "Share", exact: true }).tap();
  const share = page.getByRole("dialog");
  await expectDialogFits(page, share, "share");
  await share.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(share).toBeHidden();

  // Data → archive of the long archived title.
  await page.getByRole("button", { name: "Data & backups" }).tap();
  await page.getByTestId("data-archive").tap();
  const archive = page.getByRole("dialog");
  await expectDialogFits(page, archive, "archive");
  await expect(archive.getByTestId("archive-list")).toBeVisible();
  await archive.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(archive).toBeHidden();

  // Server mode deliberately hides the local-only backup entries (TASK-166
  // D21): Janosik does not create server backups. The local-mode backup
  // dialogs are covered by the DataMenu unit tests instead.
  await page.getByRole("button", { name: "Data & backups" }).tap();
  await expect(page.getByTestId("data-backups")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Board settings (workflow editor) — admin only.
  await page.getByTestId("board-settings-trigger").tap();
  const settings = page.getByTestId("board-settings-dialog");
  await expectDialogFits(page, settings, "board settings");
  await settings.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(settings).toBeHidden();

  // Column menu → rename and WIP limit dialogs.
  const column = columnSection(page, "Todo");
  await column.getByRole("button", { name: "Column options" }).tap();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).tap();
  const rename = page.getByRole("dialog");
  await expectDialogFits(page, rename, "rename column");
  await expect(rename.locator('[name="column-rename"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rename).toBeHidden();

  await column.getByRole("button", { name: "Column options" }).tap();
  await page.getByRole("menuitem", { name: "WIP limit" }).tap();
  const wip = page.getByRole("dialog");
  await expectDialogFits(page, wip, "wip limit");
  await expect(wip.locator('[name="wip-limit"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(wip).toBeHidden();
});

test("keeps double-tap rename, touch card creation and column scrolling", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  for (let index = 1; index <= 12; index += 1) {
    await board.card(todo, `Card ${index}`);
  }
  await board.open(page);
  const column = columnSection(page, "Todo");

  // Double-tap the header (pointer stream, not the synthetic dblclick).
  const heading = column.getByRole("heading", { name: "Todo" });
  await touchDoubleTap(page, heading);
  const rename = page.getByRole("dialog");
  await expect(rename).toBeVisible();
  const input = rename.locator('[name="column-rename"]');
  await input.fill("Renamed");
  await rename.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(rename).toBeHidden();
  await expect(
    columnSection(page, "Renamed").getByRole("heading", { name: "Renamed" }),
  ).toBeVisible();

  // The touch-visible end zone opens the inline composer.
  const renamed = columnSection(page, "Renamed");
  await renamed.getByTestId("card-insert-12").tap();
  const composer = renamed.locator('[name="card-composer"]');
  await expect(composer).toBeVisible();
  await composer.fill("Touch created");
  await composer.press("Enter");
  await expect(
    renamed.getByTestId("card-title").filter({ hasText: "Touch created" }),
  ).toBeVisible();

  // A swipe over the card list still scrolls it (the long-press did not
  // steal the gesture before its activation delay).
  const scroller = renamed.getByTestId("column-card-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  const before = await scroller.evaluate((element) => element.scrollTop);
  await touchSwipe(page, scroller, -220);
  await expect
    .poll(async () => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);
});

test("calendar and table keep their content on screen at 390 px", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  for (let index = 1; index <= 30; index += 1) {
    await board.card(todo, `Responsive row ${index}`);
  }
  await board.open(page);

  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Calendar", exact: true })
    .tap();
  await expect(page.getByTestId("calendar-day").first()).toBeVisible();
  await expectNoPageOverflow(page, "calendar");
  const grid = page.getByTestId("calendar-grid");
  await expect(grid).toBeVisible();
  const gridBox = await grid.boundingBox();
  expect(gridBox?.height ?? 0).toBeGreaterThan(200);
  // The month grid itself is the scroller on a short phone screen.
  await grid.evaluate((element) => {
    element.scrollTop = 0;
  });
  await touchSwipe(page, grid, -200);
  await expect
    .poll(async () => grid.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Table", exact: true })
    .tap();
  await expect(page.getByTestId("table-row").first()).toBeVisible();
  await expectNoPageOverflow(page, "table");
  const tableScroll = page.getByTestId("table-scroll");
  await expectNoOwnOverflow(tableScroll, "table scroller");
  await tableScroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await touchSwipe(page, tableScroll, -200);
  await expect
    .poll(async () => tableScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  // The phone table keeps the working columns; secondary ones stay hidden
  // instead of forcing a horizontal scrollbar.
  await expect(
    page.getByRole("columnheader", { name: "Title", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Labels", exact: true }),
  ).toBeHidden();
});
