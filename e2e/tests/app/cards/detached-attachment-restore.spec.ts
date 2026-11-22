import { test, expect } from "@/fixtures/board.js";
import {
  cardDialog,
  closeCardDialog,
  descriptionEditor,
  openCard,
} from "@/helpers/history.js";

/**
 * G-13: a file removed from the description can be restored after a reload,
 * the save survives another reload and the image renders from the canonical
 * attachment reference.
 */
test("restores a removed description image after reload and renders it", async ({
  page,
  board,
}) => {
  const column = await board.column("Files");
  const cardId = await board.card(column, "Restore removed image");
  await board.open(page);
  await openCard(page, "Restore removed image");
  const dialog = cardDialog(page);
  const editor = descriptionEditor(page);
  const attachmentCount = async () => {
    const response = await board.api.get(`/api/v1/cards/${cardId}/attachments`);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as unknown[]).length;
  };

  await editor.click();
  await editor.evaluate((element) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAFAgEAmmHRGwAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], "restored.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(editor.locator("img")).toBeVisible();
  // Blur/save, then remove the reference and save again.
  await dialog.getByRole("textbox", { name: "Title" }).click();
  await expect.poll(attachmentCount).toBe(1);
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await dialog.getByRole("textbox", { name: "Title" }).click();
  await expect.poll(attachmentCount).toBe(0);
  await closeCardDialog(page);

  // Reload: the file must still be in the detached bin.
  await page.reload();
  await openCard(page, "Restore removed image");
  const group = dialog.getByTestId("card-detached-attachments");
  await group.locator("summary").click();
  await expect(group.getByTestId("card-detached-attachment-row")).toContainText(
    "restored.png",
  );
  await group
    .getByRole("button", { name: "Restore restored.png to description" })
    .click();

  await expect(editor.locator("img")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Title" }).click();
  await expect
    .poll(async () => {
      const response = await board.api.get(`/api/v1/boards/${board.id}`);
      expect(response.ok()).toBeTruthy();
      const aggregate = (await response.json()) as {
        cards: Record<string, { description?: string }>;
      };
      return aggregate.cards[cardId]?.description ?? "";
    })
    .toContain("/attachments/");
  await expect.poll(attachmentCount).toBe(1);
  await closeCardDialog(page);

  // Save + reload: the normal attachment row and the rendered image persist.
  await page.reload();
  await openCard(page, "Restore removed image");
  await expect(editor.locator("img")).toBeVisible();
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "restored.png",
  );
  await expect(dialog.getByTestId("card-detached-attachments")).toHaveCount(0);
});
