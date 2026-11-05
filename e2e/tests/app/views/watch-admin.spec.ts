import { test, expect } from "@/fixtures/board.js";

test("watch identifies an administrative command without blaming the board owner", async ({
  page,
  board,
  admin,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Before moderation");
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const response = await admin.post(
    `/api/v1/admin/boards/${board.id}/commands`,
    {
      data: {
        action: {
          boardId: board.id,
          at: Date.now(),
          type: "UPDATE_CARD",
          cardId: card,
          title: "After moderation",
        },
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const entry = page
    .getByTestId("watch-entry")
    .filter({ hasText: "Title changed" })
    .first();
  await expect(entry).toContainText("Administrator", { timeout: 15000 });
  await expect(entry).toContainText("Before moderation→After moderation");
});
