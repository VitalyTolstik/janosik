import { test, expect } from "@/fixtures/board.js";
import { calendarChip, openCalendar, openWatch } from "@/helpers/views.js";

/**
 * C-08: the account's 12/24-hour preference reaches both the calendar chip
 * and the Watch feed, and survives a reload.
 */
test("honours the 12/24-hour preference in calendar and watch", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Timed card");
  const due = new Date();
  due.setHours(14, 30, 0, 0);
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: due.getTime(),
  });

  await board.open(page);
  await page.evaluate(() => localStorage.setItem("janosik-time-format", "12h"));
  await page.reload();

  await openCalendar(page);
  await page
    .getByRole("group", { name: "Calendar scale" })
    .getByRole("button", { name: "Week", exact: true })
    .click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(calendarChip(page, "Timed card")).toContainText(/2:30\s?PM/);

  await openWatch(page);
  await expect(page.getByTestId("watch-view")).toContainText(/2:30\s?PM/);

  await page.evaluate(() => localStorage.setItem("janosik-time-format", "24h"));
  await page.reload();

  await openCalendar(page);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(calendarChip(page, "Timed card")).toContainText("14:30");
  await openWatch(page);
  await expect(page.getByTestId("watch-view")).toContainText("14:30");
});
