import { expect, test } from "@/fixtures/board.js";
import { getBoard } from "@/helpers/boards.js";
import {
  expectNoPageOverflow,
  touchDragTo,
  touchDragToOffscreen,
  touchSlowTap,
} from "@/helpers/touch.js";
import {
  adjacentVisibleDay,
  calendarChip,
  calendarDay,
  openCalendar,
  openTable,
  tableRow,
  todayKey,
  unscheduledCard,
} from "@/helpers/views.js";

/**
 * Touch layer for the calendar and the table (TASK-31) at a phone viewport.
 *
 * The desktop paths in `views/calendar.spec.ts` and `views/table.spec.ts`
 * exercise HTML5 drag & drop. These scenarios only use the touch transport:
 * a long press lifts the chip/row and a release over a target reschedules or
 * moves it — the browser never fires `dragstart` here.
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("reschedules a calendar chip with a long-press touch drag", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Touch calendar task");
  const source = new Date();
  source.setHours(14, 30, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: source.getTime(),
  });

  await board.open(page);
  await openCalendar(page);
  await expectNoPageOverflow(page, "calendar touch");
  const target = await adjacentVisibleDay(page);
  const chip = calendarChip(page, "Touch calendar task");
  await expect(chip).toBeVisible();

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragTo(page, chip, calendarDay(page, target.key));
  await saved;

  await expect(
    calendarDay(page, target.key)
      .getByTestId("calendar-chip")
      .filter({ hasText: "Touch calendar task" }),
  ).toBeVisible();
  await expect(
    calendarDay(page, todayKey())
      .getByTestId("calendar-chip")
      .filter({ hasText: "Touch calendar task" }),
  ).toHaveCount(0);
  // A drop is not a tap: the card dialog must stay closed.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  expect([
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
    due.getHours(),
    due.getMinutes(),
  ]).toEqual([
    target.date.getFullYear(),
    target.date.getMonth(),
    target.date.getDate(),
    14,
    30,
  ]);
});

test("plans an unscheduled chip from the touch panel", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Touch loose task");
  await board.open(page);
  await openCalendar(page);

  // On a phone the side panel starts collapsed to leave the grid usable.
  const toggle = page.getByTestId("unscheduled-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.tap();
  await expect(page.getByTestId("unscheduled-list")).toBeVisible();

  const target = await adjacentVisibleDay(page);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragTo(
    page,
    unscheduledCard(page, "Touch loose task"),
    calendarDay(page, target.key),
  );
  await saved;

  await expect(
    calendarDay(page, target.key)
      .getByTestId("calendar-chip")
      .filter({ hasText: "Touch loose task" }),
  ).toBeVisible();
  const due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([
    target.date.getFullYear(),
    target.date.getMonth(),
    target.date.getDate(),
  ]);
});

test("moves a table row between columns with a long-press touch drag", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const cardId = await board.card(todo, "Touch row");
  await board.card(doing, "Target row");

  await board.open(page);
  await openTable(page);
  await expectNoPageOverflow(page, "table touch");
  const source = tableRow(page, "Touch row");
  const target = tableRow(page, "Target row");
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragTo(
    page,
    source.getByTestId("table-title-cell"),
    target.getByTestId("table-title-cell"),
  );
  await saved;

  await expect
    .poll(async () =>
      (await getBoard(board.api, board.id)).columns
        .find((column) => column.id === doing)
        ?.cardIds.includes(cardId),
    )
    .toBe(true);
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Touch row" }),
  ).toContainText("Doing");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page
    .getByTestId("table-row")
    .filter({ hasText: "Touch row" })
    .getByTestId("table-row-menu")
    .tap();
  const menu = page.getByTestId("card-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Labels", { exact: true })).toBeVisible();
  await expect(menu.getByText("Move to", { exact: true })).toBeVisible();
  await expect(menu.getByText("Due date", { exact: true })).toBeVisible();
  await expect(menu.getByText("Priority", { exact: true })).toBeVisible();
  await expect(menu.getByText("Duplicate card", { exact: true })).toBeVisible();
  await expect(menu.getByText("Archive", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("sets a table due date by tapping the cell and a day", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Touch due row");
  await board.open(page);
  await openTable(page);
  const row = tableRow(page, "Touch due row");
  const dayLabel = await page.evaluate(() => new Date().toLocaleDateString());

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await row.getByTestId("table-due-cell").tap();
  const popover = page.locator("[data-radix-popper-content-wrapper]");
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  if (!box) throw new Error("due-date popover has no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  await page.locator(`button[data-day="${dayLabel}"]`).tap();
  await saved;
  await expect
    .poll(
      async () => (await getBoard(board.api, board.id)).cards[cardId]?.dueDate,
    )
    .toBeDefined();
  await expect(row.getByTestId("card-due-badge")).toBeVisible();
});

test("keeps a slow tap and the explicit menu on a calendar chip", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Slow tap task");
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: due.getTime(),
  });

  await board.open(page);
  await openCalendar(page);
  const chip = calendarChip(page, "Slow tap task");

  // 300 ms is past the 220 ms drag activation, but the finger never moved:
  // the release must still be a tap, not a swallowed drop.
  await touchSlowTap(page, chip, { holdMs: 300 });
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .tap();
  await expect(dialog).toBeHidden();

  await page
    .getByTestId("calendar-day")
    .filter({ hasText: "Slow tap task" })
    .tap({ position: { x: 3, y: 3 } });
  const dayPanel = page.getByTestId("day-panel");
  await expect(dayPanel).toBeVisible();
  await dayPanel.getByTestId("day-panel-card-menu").tap();
  const menu = page.getByTestId("card-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Labels", { exact: true })).toBeVisible();
  await expect(menu.getByText("Move to", { exact: true })).toBeVisible();
  await expect(menu.getByText("Due date", { exact: true })).toBeVisible();
  await expect(menu.getByText("Priority", { exact: true })).toBeVisible();
  await expect(menu.getByText("Duplicate card", { exact: true })).toBeVisible();
  await expect(menu.getByText("Archive", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("a slow tap on a chip at the grid edge is still a tap", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Edge slow tap");
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: due.getTime(),
  });
  await board.open(page);
  await openCalendar(page);

  const grid = page.getByTestId("calendar-grid");
  await grid.evaluate((element) => {
    const chip = element.querySelector<HTMLElement>(
      '[data-testid="calendar-chip"]',
    );
    if (!chip) return;
    const chipRect = chip.getBoundingClientRect();
    const gridRect = element.getBoundingClientRect();
    element.scrollTop += chipRect.bottom - (gridRect.bottom - 16);
  });
  await expectNoPageOverflow(page, "calendar edge");

  const chip = calendarChip(page, "Edge slow tap");
  await touchSlowTap(page, chip, { holdMs: 300, scroll: false });
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .tap();
});

test("auto-scrolls the calendar from Unscheduled to an offscreen day", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Auto plan");
  await board.open(page);
  await openCalendar(page);
  await page.getByTestId("unscheduled-toggle").tap();
  await expect(page.getByTestId("unscheduled-list")).toBeVisible();

  const targetKey = await page.evaluate(() => {
    const viewport = window.innerHeight;
    const cell = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="calendar-day"]'),
    ].find((element) => element.getBoundingClientRect().top > viewport + 40);
    return cell?.getAttribute("data-date") ?? null;
  });
  if (!targetKey) throw new Error("no offscreen day in the grid");

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragToOffscreen(
    page,
    unscheduledCard(page, "Auto plan"),
    calendarDay(page, targetKey),
    { direction: "down" },
  );
  await saved;

  const [year, month, day] = targetKey.split("-").map(Number);
  await expect
    .poll(async () => {
      const due = (await getBoard(board.api, board.id)).cards[cardId]?.dueDate;
      if (typeof due !== "number") return null;
      const date = new Date(due);
      return [date.getFullYear(), date.getMonth(), date.getDate()];
    })
    .toEqual([year, month, day]);
});

test("auto-scrolls a virtualized table to an unmounted far row", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const cardId = await board.card(todo, "Virtual source");
  for (let index = 1; index <= 100; index += 1) {
    await board.card(todo, `Virtual filler ${index}`);
  }
  await board.card(doing, "Virtual target");
  await board.open(page);
  await openTable(page);

  // The target row is past the windowing threshold and is not mounted yet.
  expect(await tableRow(page, "Virtual target").count()).toBe(0);

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragToOffscreen(
    page,
    tableRow(page, "Virtual source").getByTestId("table-title-cell"),
    tableRow(page, "Virtual target").getByTestId("table-title-cell"),
    {
      direction: "down",
      scrollContainer: page.getByTestId("table-scroll"),
    },
  );
  await saved;

  await expect
    .poll(async () =>
      (await getBoard(board.api, board.id)).columns
        .find((column) => column.id === doing)
        ?.cardIds.includes(cardId),
    )
    .toBe(true);
});

test("reschedules in the week scale with the touch layer", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Week touch task");
  const source = new Date();
  source.setHours(9, 15, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: source.getTime(),
  });

  await board.open(page);
  await openCalendar(page);
  await page
    .getByRole("group", { name: "Calendar scale" })
    .getByRole("button", { name: "Week", exact: true })
    .tap();
  await page.getByRole("button", { name: "Today" }).tap();
  await expect(page.getByTestId("calendar-chip-menu")).toBeVisible();
  const target = await adjacentVisibleDay(page);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragTo(
    page,
    calendarChip(page, "Week touch task"),
    calendarDay(page, target.key),
  );
  await saved;

  const due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  expect([due.getHours(), due.getMinutes()]).toEqual([9, 15]);
  expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([
    target.date.getFullYear(),
    target.date.getMonth(),
    target.date.getDate(),
  ]);
});

test("reorders rows in the same column with a touch drag", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const first = await board.card(todo, "Reorder first");
  const second = await board.card(todo, "Reorder second");
  await board.open(page);
  await openTable(page);

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragTo(
    page,
    tableRow(page, "Reorder first").getByTestId("table-title-cell"),
    tableRow(page, "Reorder second").getByTestId("table-title-cell"),
  );
  await saved;

  await expect
    .poll(
      async () =>
        (await getBoard(board.api, board.id)).columns.find(
          (column) => column.id === todo,
        )?.cardIds,
    )
    .toEqual([second, first]);
});

test("refuses a touch row drop into a full WIP column", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const cardId = await board.card(todo, "WIP source");
  await board.card(doing, "WIP occupant");
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: doing,
    wipLimit: 1,
  });
  await board.open(page);
  await openTable(page);

  await touchDragTo(
    page,
    tableRow(page, "WIP source").getByTestId("table-title-cell"),
    tableRow(page, "WIP occupant").getByTestId("table-title-cell"),
  );

  await expect(
    page.getByText(/reached its WIP limit/, { exact: false }),
  ).toBeVisible();
  const snapshot = await getBoard(board.api, board.id);
  expect(
    snapshot.columns.find((column) => column.id === doing)?.cardIds,
  ).not.toContain(cardId);
  expect(
    snapshot.columns.find((column) => column.id === todo)?.cardIds,
  ).toContain(cardId);
});

test("auto-scrolls the table to a row outside the first viewport", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  const cardId = await board.card(todo, "Auto-scroll source");
  for (let index = 1; index <= 18; index += 1) {
    await board.card(todo, `Filler ${index}`);
  }
  await board.card(doing, "Offscreen target");
  await board.open(page);
  await openTable(page);

  const target = tableRow(page, "Offscreen target");
  const initiallyVisible = await target.boundingBox();
  expect(initiallyVisible?.y ?? 0).toBeGreaterThan(844);

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await touchDragToOffscreen(
    page,
    tableRow(page, "Auto-scroll source").getByTestId("table-title-cell"),
    target.getByTestId("table-title-cell"),
  );
  await saved;

  await expect
    .poll(async () =>
      (await getBoard(board.api, board.id)).columns
        .find((column) => column.id === doing)
        ?.cardIds.includes(cardId),
    )
    .toBe(true);
});
