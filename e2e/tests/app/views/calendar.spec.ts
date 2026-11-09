import { test, expect } from "@/fixtures/board.js";
import { getBoard } from "@/helpers/boards.js";
import { search } from "@/helpers/filters.js";
import {
  adjacentVisibleDay,
  calendarChip,
  calendarDay,
  dayKey,
  openCalendar,
  openView,
  todayKey,
} from "@/helpers/views.js";

test("create a scheduled card in the calendar and find it on the board", async ({
  page,
  board,
}) => {
  await board.column("Planned");
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Calendar" }).click();
  const today = await page.evaluate(() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth()),
      String(now.getDate()),
    ].join("-");
  });
  await page
    .locator(`[data-testid="calendar-day"][data-date="${today}"]`)
    .click();
  const input = page.getByTestId("day-composer-input");
  await input.fill("Calendar task");
  await input.press("Enter");
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Calendar task" }),
  ).toBeVisible();
  // Creating from the day composer opens the card dialog asynchronously, after
  // the board update. Wait for it and close it explicitly; pressing Escape
  // before it mounts only dismisses the day panel and leaves the dialog open.
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toBeHidden();
  await views.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Calendar task" }),
  ).toBeVisible();
  await page.reload();
  await views.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Calendar task" }),
  ).toBeVisible();
});

test("reschedules a chip between days and keeps the time of day", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Rescheduled task");
  const source = new Date();
  source.setHours(14, 30, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: source.getTime(),
  });

  await board.open(page);
  await openCalendar(page);
  const target = await adjacentVisibleDay(page);
  const chip = calendarChip(page, "Rescheduled task");
  await expect(chip).toBeVisible();

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await chip.dragTo(calendarDay(page, target.key));
  await saved;

  const targetCell = calendarDay(page, target.key);
  await expect(
    targetCell.getByTestId("calendar-chip").filter({
      hasText: "Rescheduled task",
    }),
  ).toBeVisible();
  await expect(
    calendarDay(page, todayKey()).getByTestId("calendar-chip").filter({
      hasText: "Rescheduled task",
    }),
  ).toHaveCount(0);

  const snapshot = await getBoard(board.api, board.id);
  const due = new Date(snapshot.cards[cardId]?.dueDate as number);
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

  await page.reload();
  await openCalendar(page);
  await expect(
    calendarDay(page, target.key)
      .getByTestId("calendar-chip")
      .filter({ hasText: "Rescheduled task" }),
  ).toBeVisible();
});

test("keeps drag and drop disabled while a filter is active", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const first = await board.card(todo, "Keep first");
  const second = await board.card(todo, "Keep second");
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  for (const cardId of [first, second]) {
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId,
      dueDate: noon.getTime(),
    });
  }

  await board.open(page);
  await openCalendar(page);
  const target = await adjacentVisibleDay(page);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId: second,
    dueDate: new Date(
      target.date.getFullYear(),
      target.date.getMonth(),
      target.date.getDate(),
      12,
    ).getTime(),
  });
  await expect(
    calendarDay(page, target.key)
      .getByTestId("calendar-chip")
      .filter({ hasText: "Keep second" }),
  ).toBeVisible();

  await search(page, "Keep");
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Keep first" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("calendar-chip").filter({ hasText: "Keep second" }),
  ).toBeVisible();
  await expect(
    page.getByText("Dragging is disabled while a filter is active"),
  ).toBeVisible();
  await expect(page.getByTestId("calendar-chip").first()).toHaveAttribute(
    "draggable",
    "false",
  );

  const before = (await getBoard(board.api, board.id)).cards[first]?.dueDate;
  const chipBox = await page
    .getByTestId("calendar-chip")
    .filter({ hasText: "Keep first" })
    .boundingBox();
  const targetBox = await calendarDay(page, target.key).boundingBox();
  if (!chipBox || !targetBox) throw new Error("Calendar cells are not visible");
  const refused = page
    .waitForResponse(
      (response) =>
        response.url().includes(`/boards/${board.id}/commands`) &&
        response.request().method() === "POST",
      { timeout: 1000 },
    )
    .catch(() => null);
  await page.mouse.move(
    chipBox.x + chipBox.width / 2,
    chipBox.y + chipBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 40, {
    steps: 20,
  });
  await page.mouse.up();
  expect(await refused).toBeNull();

  await expect(
    calendarDay(page, todayKey())
      .getByTestId("calendar-chip")
      .filter({ hasText: "Keep first" }),
  ).toBeVisible();
  const after = (await getBoard(board.api, board.id)).cards[first]?.dueDate;
  expect(after).toBe(before);
});

test("caps a busy day at three chips and opens the full list from the counter", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  for (let index = 1; index <= 5; index += 1) {
    const cardId = await board.card(todo, `Busy task ${index}`);
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId,
      dueDate: due.getTime(),
    });
  }

  await board.open(page);
  await openCalendar(page);
  const today = calendarDay(page, todayKey());
  await expect(today.getByTestId("calendar-chip")).toHaveCount(3);
  const overflow = today.getByTestId("day-overflow");
  await expect(overflow).toHaveText("2 more cards");

  await overflow.click();
  const panel = page.getByTestId("day-panel");
  await expect(panel).toBeVisible();
  for (let index = 1; index <= 5; index += 1) {
    await expect(
      panel.getByText(`Busy task ${index}`, { exact: true }),
    ).toBeVisible();
  }

  await panel.getByText("Busy task 5", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Busy task 5",
  );
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(dialog).toBeHidden();
  await expect(today.getByTestId("calendar-chip")).toHaveCount(3);
  await expect(overflow).toHaveText("2 more cards");
});

test("switches to week, navigates and persists the scale", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  await board.open(page);
  await openCalendar(page);
  const scale = page.getByRole("group", { name: "Calendar scale" });
  const label = page.getByTestId("month-year-trigger");
  const monthLabel = (await label.textContent()) ?? "";

  await scale.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    scale.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("calendar-day")).toHaveCount(7);
  const weekLabel = (await label.textContent()) ?? "";
  expect(weekLabel).not.toBe(monthLabel);

  await page.getByRole("button", { name: "Next week" }).click();
  await expect(label).not.toHaveText(weekLabel);
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(label).toHaveText(weekLabel);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(calendarDay(page, todayKey())).toBeVisible();

  await openView(page, "Board");
  await page.reload();
  await openCalendar(page);
  await expect(
    scale.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("calendar-day")).toHaveCount(7);
});

test("plans an unscheduled card by dragging it onto a day", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Loose task");
  await board.open(page);
  await openCalendar(page);
  const target = await adjacentVisibleDay(page);
  const item = page
    .getByTestId("unscheduled-list")
    .getByRole("button", { name: "Loose task", exact: true });
  await expect(item).toBeVisible();

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/commands`) &&
      response.request().method() === "POST",
  );
  await item.dragTo(calendarDay(page, target.key));
  await saved;

  await expect(
    page
      .getByTestId("unscheduled-list")
      .getByText("Loose task", { exact: true }),
  ).toHaveCount(0);
  const targetCell = calendarDay(page, target.key);
  await expect(
    targetCell.getByTestId("calendar-chip").filter({ hasText: "Loose task" }),
  ).toBeVisible();

  const due = new Date(
    (await getBoard(board.api, board.id)).cards[cardId]?.dueDate as number,
  );
  expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([
    target.date.getFullYear(),
    target.date.getMonth(),
    target.date.getDate(),
  ]);

  await page.reload();
  await openCalendar(page);
  await expect(
    calendarDay(page, target.key)
      .getByTestId("calendar-chip")
      .filter({ hasText: "Loose task" }),
  ).toBeVisible();
});

test("creates a card in a chosen column with labels and cancels the draft", async ({
  page,
  board,
}) => {
  await board.column("Todo");
  const doing = await board.column("Doing");
  const bug = await board.label("Bug", "red");
  await board.open(page);
  await openCalendar(page);
  const today = calendarDay(page, todayKey());
  await today.click();
  const panel = page.getByTestId("day-panel");
  await expect(panel).toBeVisible();

  await panel.getByTestId("day-composer-column").click();
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
  await panel.getByRole("button", { name: "Bug", exact: true }).click();
  await panel.getByTestId("day-composer-input").fill("Planned task");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel).toBeHidden();
  expect(
    Object.values((await getBoard(board.api, board.id)).cards),
  ).toHaveLength(0);

  await today.click();
  await panel.getByTestId("day-composer-column").click();
  await page.getByRole("menuitem", { name: "Doing", exact: true }).click();
  await panel.getByRole("button", { name: "Bug", exact: true }).click();
  const input = panel.getByTestId("day-composer-input");
  await input.fill("Planned task");
  await input.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(
      async () =>
        Object.values((await getBoard(board.api, board.id)).cards).find(
          (card) => card.title === "Planned task",
        )?.dueDate,
    )
    .toBeDefined();
  const snapshot = await getBoard(board.api, board.id);
  const planned = Object.values(snapshot.cards).find(
    (card) => card.title === "Planned task",
  );
  expect(planned).toBeDefined();
  expect(
    snapshot.columns.find((column) => column.id === doing)?.cardIds,
  ).toContain(planned!.id);
  expect(planned?.labelIds).toContain(bug);
  expect(dayKey(new Date(planned?.dueDate as number))).toBe(todayKey());
});
