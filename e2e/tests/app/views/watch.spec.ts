import { test, expect } from "@/fixtures/board.js";

test("watch reflects board columns and card counts across view changes", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  await board.card(column, "First task");
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();
  const todo = page
    .getByTestId("watch-column-list")
    .getByRole("listitem")
    .filter({ hasText: "Todo" });
  await expect(todo).toContainText("1");
  await views.getByRole("button", { name: "Table" }).click();
  await page.getByTestId("table-add-card").click();
  const composer = page.getByTestId("table-composer-input");
  await composer.fill("Second task");
  await composer.press("Enter");
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("table-row").filter({ hasText: "Second task" }),
  ).toBeVisible();
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(todo).toContainText("2");
  await expect(
    page
      .getByTestId("watch-entry")
      .filter({ hasText: "Second task" })
      .filter({ hasText: "Created" }),
  ).toBeVisible();
  await page.reload();
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(todo).toContainText("2");
});

test("shows status, WIP, online roster and no cards", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const doing = await board.column("Doing");
  await board.card(todo, "Todo card");
  await board.card(doing, "Doing card");
  const archived = await board.card(todo, "Archived card");
  await board.command({ type: "ARCHIVE_CARD", cardId: archived });
  await board.command({
    type: "SET_COLUMN_WIP_LIMIT",
    columnId: todo,
    wipLimit: 1,
  });

  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();

  // The archived card is in board.cards but not in any column: it must not
  // inflate the status (the old Math.max counted it).
  await expect(page.getByTestId("watch-cards")).toHaveText("2");
  await expect(page.getByTestId("watch-columns")).toHaveText("2");
  await expect
    .poll(async () =>
      Number(await page.getByTestId("watch-online").textContent()),
    )
    .toBeGreaterThanOrEqual(1);
  const columns = page.getByTestId("watch-column-list");
  await expect(
    columns.getByRole("listitem").filter({ hasText: "Todo" }),
  ).toContainText("1/1");
  await expect(
    columns.getByRole("listitem").filter({ hasText: "Doing" }),
  ).toContainText("1");
  await expect(page.getByTestId("watch-presence-list")).toContainText(
    board.email,
  );
  await expect(page.getByTestId("watch-agents")).toHaveText("0");
  await expect(page.locator("article")).toHaveCount(0);
  await expect(page.getByTestId("card-title")).toHaveCount(0);
});

test("shows an empty feed and loses it when the board is deleted", async ({
  page,
  board,
}) => {
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await expect(page.getByText("No activity yet")).toBeVisible();

  const deleted = await board.api.delete(`/api/v1/boards/${board.id}`);
  expect(deleted.ok()).toBeTruthy();
  // The feed endpoint is gone; the open Watch wall must say so and offer a
  // retry instead of pretending the board is empty.
  await expect(page.getByTestId("watch-error")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("watch-retry")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  const feed = await board.api.get(`/api/v1/boards/${board.id}/activity`);
  expect(feed.status()).toBe(404);

  // A reload resolves the now-unknown board id to the 404 page, not an
  // endless loading skeleton (an extra active board exists, but the URL is
  // still a dead board link).
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
});
