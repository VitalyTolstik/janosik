import { test, expect } from "@/fixtures/board.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";

test("pages older comments with Show older", async ({ page, board }) => {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Busy thread");
  for (let index = 0; index < 51; index += 1) {
    const response = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: `Comment ${index + 1}` },
    });
    expect(response.status()).toBe(201);
  }

  await board.open(page);
  await openCard(page, "Busy thread");
  const dialog = cardDialog(page);
  await expect(dialog.getByTestId("comment")).toHaveCount(50);
  await dialog.getByTestId("comments-show-older").click();
  await expect(dialog.getByTestId("comment")).toHaveCount(51);
  await expect(dialog.getByTestId("comments-show-older")).toHaveCount(0);

  await closeCardDialog(page);
  await page.reload();
  await openCard(page, "Busy thread");
  await expect(dialog.getByTestId("comment")).toHaveCount(50);
  await dialog.getByTestId("comments-show-older").click();
  await expect(dialog.getByTestId("comment")).toHaveCount(51);
});
