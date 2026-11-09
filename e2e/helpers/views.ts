import { expect, type Locator, type Page } from "@playwright/test";

/** Shared browser steps for the calendar, table and watch projections. */

export type BoardViewName = "Board" | "Table" | "Calendar" | "Watch";

export function viewSwitcher(page: Page): Locator {
  return page.getByRole("group", { name: "View", exact: true });
}

export async function openView(page: Page, view: BoardViewName): Promise<void> {
  await viewSwitcher(page)
    .getByRole("button", { name: view, exact: true })
    .click();
}

export async function openCalendar(page: Page): Promise<void> {
  await openView(page, "Calendar");
  await expect(page.getByTestId("calendar-day").first()).toBeVisible();
}

export async function openTable(page: Page): Promise<void> {
  await openView(page, "Table");
  await expect(page.getByRole("table")).toBeVisible();
}

export async function openWatch(page: Page): Promise<void> {
  await openView(page, "Watch");
  await expect(page.getByTestId("watch-view")).toBeVisible();
}

/**
 * Local day key exactly as CalendarView builds `data-date` (unpadded month
 * and day, month is zero-based). Keeping one helper avoids tests that parse
 * a UI format by hand.
 */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function todayKey(now = new Date()): string {
  return dayKey(now);
}

export function dateFromDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month, day);
}

export function calendarDay(page: Page, key: string): Locator {
  return page.locator(`[data-testid="calendar-day"][data-date="${key}"]`);
}

export function calendarChip(page: Page, title: string): Locator {
  return page.getByTestId("calendar-chip").filter({ hasText: title });
}

export function tableRow(page: Page, title: string): Locator {
  return page.getByTestId("table-row").filter({ hasText: title });
}

export function unscheduledCard(page: Page, title: string): Locator {
  return page
    .getByTestId("unscheduled-list")
    .getByRole("button", { name: title, exact: true });
}

/** All day keys currently rendered, left to right. */
export async function visibleDayKeys(page: Page): Promise<string[]> {
  return page
    .getByTestId("calendar-day")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-date") ?? ""),
    );
}

/**
 * A day next to today that is guaranteed to be in the rendered grid. The
 * month grid can start or end exactly on today (e.g. a 28-day February), so
 * blindly using "tomorrow" is not stable; the drag tests only need a
 * different visible day, and the API assertion derives the expected date
 * from the returned key.
 */
export async function adjacentVisibleDay(
  page: Page,
): Promise<{ key: string; date: Date }> {
  const keys = await visibleDayKeys(page);
  const today = todayKey();
  const index = keys.indexOf(today);
  if (index === -1) throw new Error("Today is not visible in the grid");
  const key = keys[index + 1] ?? keys[index - 1];
  if (!key) throw new Error("The grid has no adjacent day");
  return { key, date: dateFromDayKey(key) };
}
