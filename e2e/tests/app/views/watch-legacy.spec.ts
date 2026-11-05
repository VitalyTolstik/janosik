import { test, expect } from "@/fixtures/board.js";
import { clearCommandSnapshot } from "@/helpers/disposable-database.js";

test("watch hides a legacy edit without a snapshot but retains other history", async ({
  page,
  board,
}) => {
  test.skip(
    !process.env.E2E_COMPOSE_PROJECT,
    "Requires the disposable Docker database",
  );
  const column = await board.column("Todo");
  const card = await board.card(column, "Original task");
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Legacy task",
  });
  const response = await board.api.get(`/api/v1/boards/${board.id}/activity`);
  const { items } = (await response.json()) as {
    items: { id: string; type: string }[];
  };
  const legacy = items.find((item) => item.type === "UPDATE_CARD");
  expect(legacy).toBeDefined();
  await clearCommandSnapshot(board.id, legacy!.id);
  await board.command({
    type: "UPDATE_CARD",
    cardId: card,
    title: "Current task",
  });
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const entries = page.getByTestId("watch-entry");
  await expect(entries.filter({ hasText: "Title changed" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "Title changed" })).toContainText(
    "Legacy task→Current task",
  );
  await expect(entries.filter({ hasText: "Created" })).toHaveCount(1);
});
