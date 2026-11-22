import { test, expect } from "@/fixtures/board.js";

test("removes an archived card from the archive", async ({ page, board }) => {
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

test("keeps the archive row and inline confirm usable at 768", async ({
  page,
  board,
}) => {
  const column = await board.column("Archive tablet");
  // The archive is newest-first and the tablet page holds 17 rows. Create and
  // archive the extras first so the target stays on page one.
  for (let index = 0; index < 20; index += 1) {
    const extra = await board.card(column, `Archive tablet extra ${index}`);
    await board.command({ type: "ARCHIVE_CARD", cardId: extra });
  }
  const cardId = await board.card(column, "Tablet archive row");
  await board.command({ type: "ARCHIVE_CARD", cardId });
  await page.setViewportSize({ width: 768, height: 1024 });
  await board.open(page);

  await page.getByRole("button", { name: "Data & backups" }).click();
  await page.getByTestId("data-archive").click();
  const row = page
    .getByTestId("archive-row")
    .filter({ hasText: "Tablet archive row" });
  await expect(row).toBeVisible();
  const trigger = row.getByTestId("archive-delete");
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
  const selectAll = page.getByRole("checkbox", {
    name: "Select all matching cards",
  });
  const selectAllBox = await selectAll.boundingBox();
  expect(selectAllBox).not.toBeNull();
  expect(selectAllBox!.width).toBeGreaterThanOrEqual(44);
  expect(selectAllBox!.height).toBeGreaterThanOrEqual(44);

  await selectAll.click();
  const pagination = page.getByTestId("archive-pagination");
  await expect(pagination).toBeVisible();
  for (const control of [
    page.getByRole("button", { name: "Clear", exact: true }),
    page.getByRole("button", { name: "Restore selected" }),
    page.getByRole("button", { name: "Delete selected" }),
    pagination.getByRole("button", { name: "Previous page" }),
    pagination.getByRole("button", { name: "Next page" }),
  ]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await trigger.click();
  await expect(row).toContainText("Delete?");
  for (const button of [
    row.getByRole("button", { name: "Yes, delete" }),
    row.getByRole("button", { name: "Cancel", exact: true }),
  ]) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await row.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.getByTestId("archive-delete")).toBeVisible();
});
