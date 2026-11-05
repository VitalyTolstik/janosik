import { test, expect } from "@/fixtures/board.js";

test("watch displays an added comment and its text", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const response = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: "Ready for review" },
  });
  expect(response.status()).toBe(201);
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Added a comment" });
  await expect(entry).toContainText("Ready for review", { timeout: 15000 });
});

test("watch shows the deleted comment text as the previous value", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  const response = await board.api.post(`/api/v1/cards/${card}/comments`, {
    data: { text: "Obsolete comment" },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Added a comment" }),
  ).toBeVisible();
  const removed = await board.api.delete(`/api/v1/comments/${id}`);
  expect(removed.ok()).toBeTruthy();
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Deleted a comment" });
  await expect(entry.locator(".line-through")).toHaveText(
    "“Obsolete comment”",
    { timeout: 15000 },
  );
  await expect(entry).toContainText("→—");
});
