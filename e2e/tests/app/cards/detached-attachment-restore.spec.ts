import { test, expect, type BoardFixture } from "@/fixtures/board.js";
import {
  cardDialog,
  closeCardDialog,
  descriptionEditor,
  openCard,
} from "@/helpers/history.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAFAgEAmmHRGwAAAABJRU5ErkJggg==",
  "base64",
);

/** Upload named description files and remove their references again. */
async function seedDetachedFiles(
  board: BoardFixture,
  cardId: string,
  names: string[],
): Promise<void> {
  const references: string[] = [];
  for (const name of names) {
    const uploaded = await board.api.post(
      `/api/v1/cards/${cardId}/attachments?description=1`,
      { multipart: { file: { name, mimeType: "image/png", buffer: PNG } } },
    );
    const body = await uploaded.text();
    expect(uploaded.status(), body).toBe(201);
    const { id } = JSON.parse(body) as { id: string };
    references.push(`![${name}](/api/v1/attachments/${id}/content)`);
  }
  await board.command({
    type: "UPDATE_CARD",
    cardId,
    description: references.join("\n\n"),
  });
  await board.command({ type: "UPDATE_CARD", cardId, description: "" });
}

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

test("hands focus to the surviving row after a keyboard restore", async ({
  page,
  board,
}) => {
  const column = await board.column("Files");
  const cardId = await board.card(column, "Focus detached restore");
  await seedDetachedFiles(board, cardId, ["first.png", "second.png"]);
  await board.open(page);
  await openCard(page, "Focus detached restore");
  const group = cardDialog(page).getByTestId("card-detached-attachments");
  await group.locator("summary").click();
  const rows = group.getByTestId("card-detached-attachment-row");
  await expect(rows).toHaveCount(2);

  // Restore the second row from the keyboard. Chrome moves focus to the
  // dialog container when the row unmounts; the first row's restore button
  // must still receive focus.
  await rows.nth(1).getByTestId("card-attachment-restore").focus();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(
    rows.nth(0).getByTestId("card-attachment-restore"),
  ).toBeFocused();
});

test("clamps a long detached filename to two lines at 390 and 768", async ({
  page,
  board,
}) => {
  const column = await board.column("Files");
  const cardId = await board.card(column, "Long detached filename");
  const longName =
    "this-is-a-very-long-attachment-filename-that-must-clamp-to-two-lines-on-mobile.png";
  await seedDetachedFiles(board, cardId, [longName]);
  await page.setViewportSize({ width: 390, height: 844 });
  await board.open(page);
  await openCard(page, "Long detached filename");
  const group = cardDialog(page).getByTestId("card-detached-attachments");
  await group.locator("summary").click();
  const name = group.getByTestId("card-detached-file-name");
  await expect(name).toBeVisible();

  const measured = async () => {
    expect(
      await name.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("-webkit-line-clamp"),
      ),
    ).toBe("2");
    return name.evaluate((element) => {
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight) || 16;
      return {
        overflow: style.overflow,
        height: element.getBoundingClientRect().height,
        lineHeight,
      };
    });
  };

  const narrow = await measured();
  expect(narrow.overflow).toBe("hidden");
  expect(narrow.height).toBeLessThanOrEqual(narrow.lineHeight * 2 + 1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(name).toBeVisible();
  const tablet = await measured();
  expect(tablet.overflow).toBe("hidden");
  expect(tablet.height).toBeLessThanOrEqual(tablet.lineHeight * 2 + 1);
});
