import { readFile } from "node:fs/promises";
import { test, expect } from "@/fixtures/board.js";
import { cardDialog, closeCardDialog, openCard } from "@/helpers/history.js";

const FILE_BYTES = "proof bytes";

test("downloads an attachment through the authenticated stream", async ({
  page,
  board,
}) => {
  const column = await board.column("Files");
  await board.card(column, "Downloadable");
  await board.open(page);
  await openCard(page, "Downloadable");
  const dialog = cardDialog(page);

  await dialog.getByTestId("card-attachments-input").setInputFiles({
    name: "proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(FILE_BYTES),
  });
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "proof.txt",
  );

  const firstDownload = page.waitForEvent("download");
  await dialog
    .getByTestId("card-attachment-row")
    .getByRole("button", { name: "Download" })
    .click();
  const download = await firstDownload;
  expect(download.suggestedFilename()).toBe("proof.txt");
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (path === null) throw new Error("The download has no local path");
  expect(await readFile(path, "utf8")).toBe(FILE_BYTES);
  await expect(
    page.getByRole("status").filter({ hasText: "Could not download the file" }),
  ).toHaveCount(0);

  // The attachment survives a reload and still streams through the same
  // authenticated fetch path.
  await closeCardDialog(page);
  await page.reload();
  await openCard(page, "Downloadable");
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "proof.txt",
  );
  const secondDownload = page.waitForEvent("download");
  await dialog
    .getByTestId("card-attachment-row")
    .getByRole("button", { name: "Download" })
    .click();
  const again = await secondDownload;
  expect(again.suggestedFilename()).toBe("proof.txt");
  const againPath = await again.path();
  if (againPath === null) throw new Error("The download has no local path");
  expect(await readFile(againPath, "utf8")).toBe(FILE_BYTES);
});
