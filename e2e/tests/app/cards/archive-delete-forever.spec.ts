import { test, expect } from "@/fixtures/board.js";

test("deletes an archived card forever from the archive", async ({
  page,
  board,
}) => {
  const column = await board.column("Archive");
  const cardId = await board.card(column, "Delete forever");
  await board.command({ type: "ARCHIVE_CARD", cardId });
  await board.open(page);

  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  const row = page
    .getByTestId("archive-row")
    .filter({ hasText: "Delete forever" });
  await expect(row).toBeVisible();
  await row.getByTestId("archive-delete").click();
  await expect(row).toContainText("Delete?");
  await row.getByRole("button", { name: "Yes, delete" }).click();
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await board.api.get(`/api/v1/boards/${board.id}`);
      const aggregate = (await response.json()) as {
        cards: Record<string, unknown>;
      };
      return cardId in aggregate.cards;
    })
    .toBe(false);
  await expect(page.getByTestId("archive-list")).toContainText(
    "The archive is empty.",
  );

  await page.reload();
  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  await expect(
    page.getByTestId("archive-row").filter({ hasText: "Delete forever" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("archive-list")).toContainText(
    "The archive is empty.",
  );

  const snapshot = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(snapshot.ok()).toBeTruthy();
  const aggregate = (await snapshot.json()) as {
    cards: Record<string, { title: string }>;
  };
  expect(Object.keys(aggregate.cards)).not.toContain(cardId);
});
