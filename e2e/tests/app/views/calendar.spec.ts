import { test, expect } from "@/fixtures/board.js";

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
  await page.keyboard.press("Escape");
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
