import { readFile } from "node:fs/promises";
import { test, expect } from "../../../fixtures/board.js";

test("a QuickTime attachment becomes a playable MP4", async ({
  page,
  board,
}) => {
  const column = await board.column("Tasks");
  const cardId = await board.card(column, "Video task");
  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Video task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  const video = await readFile(
    new URL(
      "../../../../backend/test/fixtures/sample-video.mp4",
      import.meta.url,
    ),
  );
  video.write("qt  ", 8, "ascii");
  await dialog.getByTestId("card-attachments-input").setInputFiles({
    name: "clip.mov",
    mimeType: "video/quicktime",
    buffer: video,
  });
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "clip.mov",
  );
  await expect
    .poll(
      async () => {
        const response = await board.api.get(
          `/api/v1/cards/${cardId}/attachments`,
        );
        expect(response.ok()).toBeTruthy();
        const files = (await response.json()) as {
          mimeType: string;
          transcodeStatus: string;
        }[];
        return files[0] && `${files[0].mimeType}:${files[0].transcodeStatus}`;
      },
      { timeout: 30_000 },
    )
    .toBe("video/mp4:done");
  const files = (await (
    await board.api.get(`/api/v1/cards/${cardId}/attachments`)
  ).json()) as { id: string }[];
  const content = await board.api.get(
    `/api/v1/attachments/${files[0].id}/content`,
  );
  expect(content.ok()).toBeTruthy();
  const encoded = (await content.body()).toString("base64");
  const width = await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
    try {
      const video = document.createElement("video");
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("Video could not be decoded"));
      });
      return video.videoWidth;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, encoded);
  expect(width).toBeGreaterThan(0);
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("card-attachment-row")).toContainText(
    "clip.mov",
  );
});
