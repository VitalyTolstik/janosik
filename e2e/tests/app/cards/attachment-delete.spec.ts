import { test, expect } from "@/fixtures/board.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";

test("deletes an attachment after confirmation and frees the row", async ({
  page,
  board,
}) => {
  const column = await board.column("Files");
  const cardId = await board.card(column, "Attachment host");
  await board.open(page);
  await openCard(page, "Attachment host");
  const dialog = cardDialog(page);

  await dialog.getByTestId("card-attachments-input").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  const row = dialog.getByTestId("card-attachment-row");
  await expect(row).toContainText("notes.txt");

  await row.hover();
  await dialog.getByRole("button", { name: "Delete file" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this file?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete file" }).click();
  await expect(dialog.getByTestId("card-attachment-row")).toHaveCount(0);
  await expect(dialog.getByTestId("card-attachments-empty")).toBeVisible();

  const remaining = await board.api.get(`/api/v1/cards/${cardId}/attachments`);
  expect(remaining.ok()).toBeTruthy();
  expect((await remaining.json()) as unknown[]).toHaveLength(0);

  await closeCardDialog(page);
  await page.reload();
  await openCard(page, "Attachment host");
  await expect(dialog.getByTestId("card-attachment-row")).toHaveCount(0);
  await expect(dialog.getByTestId("card-attachments-empty")).toBeVisible();
});
