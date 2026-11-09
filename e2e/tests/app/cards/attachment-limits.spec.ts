import { test, expect } from "@/fixtures/board.js";
import { cardDialog, openCard } from "@/helpers/history.js";

test("rejects a disallowed file type", async ({ page, board }) => {
  const column = await board.column("Files");
  await board.card(column, "No executables");
  await board.open(page);
  await openCard(page, "No executables");
  const dialog = cardDialog(page);

  await dialog.getByTestId("card-attachments-input").setInputFiles({
    name: "malware.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ not really an executable"),
  });

  // Radix marks the page outside the dialog aria-hidden, so the toast has no
  // accessible role while the card dialog is open; match its text instead.
  await expect(page.getByText("This file type is not allowed")).toBeVisible();
  await expect(dialog.getByTestId("card-attachment-row")).toHaveCount(0);
  await expect(dialog.getByTestId("card-attachments-empty")).toBeVisible();
});

test("disables upload at twenty files", async ({ page, board }) => {
  const column = await board.column("Files");
  const cardId = await board.card(column, "Full of files");
  for (let index = 0; index < 20; index += 1) {
    const response = await board.api.post(
      `/api/v1/cards/${cardId}/attachments`,
      {
        multipart: {
          file: {
            name: `file-${index + 1}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from(`content ${index + 1}`),
          },
        },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
  }

  await board.open(page);
  await openCard(page, "Full of files");
  const dialog = cardDialog(page);
  await expect(dialog.getByTestId("card-attachment-row")).toHaveCount(20);
  const upload = dialog.getByTestId("card-attachments-upload");
  await expect(upload).toBeDisabled();
  await expect(upload).toContainText("Up to 20 files per card");
});
