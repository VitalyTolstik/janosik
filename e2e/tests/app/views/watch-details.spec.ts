import { test, expect } from "@/fixtures/board.js";

test("watch expands and collapses complete saved values", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Task");
  const before = `Before ${"a".repeat(150)} end-before`;
  const after = `After ${"b".repeat(150)} end-after`;
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    description: before,
  });
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    description: after,
  });
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Description changed" })
    .first();
  await expect(entry).toContainText("After", { timeout: 15000 });
  await expect(entry).not.toContainText("end-after");
  await entry.getByRole("button", { name: "Show full values" }).click();
  await expect(entry).toContainText(before);
  await expect(entry).toContainText(after);
  await entry.getByRole("button", { name: "Show less" }).click();
  await expect(entry).not.toContainText("end-after");
});
