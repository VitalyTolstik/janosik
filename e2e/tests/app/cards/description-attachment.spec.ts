import { test, expect } from "../../../fixtures/board.js";

test("description image follows deletion, undo and redo", async ({
  page,
  board,
}) => {
  const column = await board.column("Tasks");
  const cardId = await board.card(column, "Image task");
  await board.open(page);
  const openCard = async () =>
    page.getByTestId("card-title").filter({ hasText: "Image task" }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  const editor = dialog
    .locator("section")
    .filter({ has: page.getByTestId("card-description-toggle") })
    .locator('[contenteditable="true"]');
  const close = async () =>
    dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  const attachmentCount = async () => {
    const response = await board.api.get(`/api/v1/cards/${cardId}/attachments`);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as unknown[]).length;
  };
  await openCard();
  await editor.click();
  await editor.evaluate((element) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAFAgEAmmHRGwAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(editor.locator("img")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Title" }).click();
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "pasted.png",
  );
  await close();
  await expect.poll(attachmentCount).toBe(1);
  await openCard();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await close();
  await expect.poll(attachmentCount).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(attachmentCount).toBe(1);
  await openCard();
  await expect(editor.locator("img")).toBeVisible();
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "pasted.png",
  );
  await close();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(attachmentCount).toBe(0);
  await openCard();
  await expect(editor.locator("img")).toHaveCount(0);
  await expect(dialog.getByTestId("card-attachment-row")).toHaveCount(0);
  const removed = dialog.getByTestId("card-detached-attachments");
  await removed.locator("summary").click();
  await expect(
    removed.getByTestId("card-detached-attachment-row"),
  ).toContainText("pasted.png");
  await removed.getByRole("button", { name: "Delete file" }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete this file?" });
  await expect(confirmation).toContainText("no longer be available");
  await confirmation.getByRole("button", { name: "Delete file" }).click();
  await expect(removed).toHaveCount(0);
});
