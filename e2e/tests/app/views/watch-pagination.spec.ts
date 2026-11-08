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

test("changes page size and uses Prev/Next through the last page", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  for (let index = 1; index <= 60; index += 1) {
    await board.card(column, `Page task ${String(index).padStart(2, "0")}`);
  }
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const feed = page.getByTestId("watch-feed");

  const responseFor = (limit: number) =>
    page.waitForResponse(
      (response) =>
        response.url().includes("/activity") &&
        new URL(response.url()).searchParams.get("limit") === String(limit),
    );

  const twenty = responseFor(20);
  await page.getByTestId("watch-page-size-20").click();
  await twenty;
  await expect(page.getByTestId("watch-entry")).toHaveCount(20);
  await expect(page.getByTestId("watch-prev")).toBeDisabled();
  await expect(page.getByTestId("watch-next")).toBeEnabled();
  await expect(page.getByTestId("watch-page-1")).toHaveAttribute(
    "aria-current",
    "page",
  );

  for (const target of [2, 3, 4]) {
    await page.getByTestId("watch-next").click();
    await expect(page.getByTestId(`watch-page-${target}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await expect(page.getByTestId("watch-next")).toBeDisabled();
  await expect(page.getByTestId("watch-prev")).toBeEnabled();
  await expect(feed).not.toContainText("Page task 60");

  await page.getByTestId("watch-prev").click();
  await expect(page.getByTestId("watch-page-3")).toHaveAttribute(
    "aria-current",
    "page",
  );

  const fifty = responseFor(50);
  await page.getByTestId("watch-page-size-50").click();
  await fifty;
  await expect(page.getByTestId("watch-entry")).toHaveCount(50);
  await expect(page.getByTestId("watch-prev")).toBeDisabled();
  await expect(page.getByTestId("watch-page-1")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByTestId("watch-next").click();
  await expect(page.getByTestId("watch-page-2")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("watch-entry")).toHaveCount(11);
  await expect(page.getByTestId("watch-next")).toBeDisabled();
  await expect(page.getByTestId("watch-prev")).toBeEnabled();

  const hundred = responseFor(100);
  await page.getByTestId("watch-page-size-100").click();
  await hundred;
  await expect(page.getByTestId("watch-entry")).toHaveCount(61);
  await expect(page.getByTestId("watch-prev")).toBeDisabled();
  await expect(page.getByTestId("watch-next")).toBeDisabled();
});
