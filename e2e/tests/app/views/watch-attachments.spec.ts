import { test, expect } from "@/fixtures/board.js";

const file = {
  name: "review.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("review notes"),
};

test("watch shows an added attachment and its name", async ({
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
  const response = await board.api.post(`/api/v1/cards/${card}/attachments`, {
    multipart: { file },
  });
  expect(response.status()).toBe(201);
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Added an attachment" }),
  ).toContainText("review.txt", { timeout: 15000 });
});

test("watch shows a deleted attachment and its name", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  const response = await board.api.post(`/api/v1/cards/${card}/attachments`, {
    multipart: { file },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await expect(
    page.getByTestId("watch-entry").filter({ hasText: "Added an attachment" }),
  ).toBeVisible();
  const removed = await board.api.delete(`/api/v1/attachments/${id}`);
  expect(removed.ok()).toBeTruthy();
  await expect(
    page
      .getByTestId("watch-entry")
      .filter({ hasText: "Deleted an attachment" }),
  ).toContainText("review.txt", { timeout: 15000 });
});
