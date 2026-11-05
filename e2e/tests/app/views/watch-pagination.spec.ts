import { test, expect } from "@/fixtures/board.js";

test("watch pages through older events and returns to the latest", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  for (let i = 1; i <= 23; i += 1)
    await board.card(column, `Task ${String(i).padStart(2, "0")}`);
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await page.getByTestId("watch-page-size-20").click();
  const feed = page.getByTestId("watch-feed");
  await expect(feed).toContainText("Task 23");
  await expect(feed).not.toContainText("Task 01");
  await page.getByTestId("watch-page-2").click();
  await expect(feed).toContainText("Task 01");
  await expect(feed).not.toContainText("Task 23");
  await page.getByTestId("watch-page-1").click();
  await expect(feed).toContainText("Task 23");
});
