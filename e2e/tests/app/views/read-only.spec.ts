import { test, expect } from "@/fixtures/collaboration.js";
import { getBoard } from "@/helpers/boards.js";
import {
  adjacentVisibleDay,
  attemptDropOnDay,
  calendarChip,
  calendarDay,
  openCalendar,
  openTable,
  todayKey,
} from "@/helpers/views.js";

/**
 * C-07: a VIEWER gets the real content but none of the mutating controls in
 * the calendar or table, and a drag cannot change a due date.
 */
test("viewer sees a read-only calendar and table", async ({
  page,
  board,
  partner,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Viewer visible");
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: due.getTime(),
  });
  await partner.invite("VIEWER");
  await partner.accept();
  await partner.open(page);
  await partner.openBoard(page);

  await openCalendar(page);
  await expect(calendarChip(page, "Viewer visible")).toBeVisible();
  await expect(page.getByTestId("day-add")).toHaveCount(0);
  await expect(page.getByTestId("unscheduled-add")).toHaveCount(0);
  await expect(calendarChip(page, "Viewer visible")).toHaveAttribute(
    "draggable",
    "false",
  );

  // A VIEWER can still open the day panel (the full list is useful), but the
  // composer inside it must be absent.
  await calendarDay(page, todayKey()).click();
  const dayPanel = page.getByTestId("day-panel");
  await expect(dayPanel).toBeVisible();
  await expect(dayPanel.getByTestId("day-composer-input")).toHaveCount(0);
  await expect(dayPanel.getByTestId("day-composer-column")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dayPanel).toBeHidden();

  const target = await adjacentVisibleDay(page);
  const before = (await getBoard(board.api, board.id)).cards[cardId]?.dueDate;
  const chipBox = await calendarChip(page, "Viewer visible").boundingBox();
  const targetBox = await calendarDay(page, target.key).boundingBox();
  if (!chipBox || !targetBox) throw new Error("Calendar cells are not visible");
  await page.mouse.move(
    chipBox.x + chipBox.width / 2,
    chipBox.y + chipBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 40, {
    steps: 20,
  });
  await page.mouse.up();
  // The forced native events are the deterministic negative check; the
  // coordinate drag above is a best-effort user-path signal.
  expect(await attemptDropOnDay(page, "Viewer visible", target.key)).toBe(0);
  await expect(
    calendarDay(page, todayKey())
      .getByTestId("calendar-chip")
      .filter({ hasText: "Viewer visible" }),
  ).toBeVisible();
  expect((await getBoard(board.api, board.id)).cards[cardId]?.dueDate).toBe(
    before,
  );

  await openTable(page);
  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Viewer visible" }),
  ).toBeVisible();
  await expect(page.getByTestId("table-add-card")).toHaveCount(0);
  await expect(page.getByTestId("table-column-cell")).toHaveCount(0);
  await expect(page.getByTestId("table-archive-btn")).toHaveCount(0);
  await page.getByText("Viewer visible", { exact: true }).dblclick();
  await expect(page.getByTestId("table-title-input")).toHaveCount(0);
});
