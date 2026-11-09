import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

/**
 * P0: a snapshot is a frozen copy. Comments and attachments created after
 * the capture must never leak into the public payload — neither through the
 * rendered card nor through the direct public REST endpoints.
 */
test("a snapshot freezes comments and attachments at capture time", async ({
  page,
  browser,
  sharing,
}) => {
  const beforeComment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "Before the snapshot" } },
  );
  expect(beforeComment.status()).toBe(201);
  const beforeAttachment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "frozen-before.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("frozen before"),
        },
      },
    },
  );
  expect(beforeAttachment.status()).toBe(201);

  await sharing.openOwner(page);
  await page.getByTestId("share-mode-snapshot").click();
  const comments = page.getByRole("checkbox", { name: "Show comments" });
  const attachments = page.getByRole("checkbox", {
    name: "Show attachments",
  });
  await comments.check();
  await attachments.check();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("share-create").click();
  const snapshot = (await (await created).json()) as { token: string };

  // Everything below is newer than the capture: none of it belongs to the
  // frozen copy.
  const afterComment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "After the snapshot" } },
  );
  expect(afterComment.status()).toBe(201);
  const afterAttachment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "after.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("after"),
        },
      },
    },
  );
  expect(afterAttachment.status()).toBe(201);

  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(snapshot.token));
    await expect(viewer.getByText("Shared · read-only")).toBeVisible();
    await viewer
      .getByTestId("card-title")
      .filter({ hasText: "Original card" })
      .click();

    const thread = viewer.getByTestId("public-comments");
    await expect(thread).toContainText("Before the snapshot");
    await expect(thread).not.toContainText("After the snapshot");
    await expect(
      viewer.getByRole("link", { name: "frozen-before.txt" }),
    ).toBeVisible();
    await expect(viewer.getByRole("link", { name: "after.txt" })).toHaveCount(
      0,
    );
  } finally {
    await anonymous.close();
  }

  // The API contract itself must be frozen too, not only the rendered card.
  const publicComments = await sharing.api.get(
    `/api/v1/share/${snapshot.token}/cards/${sharing.cardId}/comments`,
  );
  expect(publicComments.ok()).toBeTruthy();
  const commentPage = (await publicComments.json()) as {
    items: { text: string }[];
  };
  expect(commentPage.items.map((item) => item.text)).toEqual([
    "Before the snapshot",
  ]);

  const publicAttachments = await sharing.api.get(
    `/api/v1/share/${snapshot.token}/cards/${sharing.cardId}/attachments`,
  );
  expect(publicAttachments.ok()).toBeTruthy();
  const attachmentRows = (await publicAttachments.json()) as {
    fileName: string;
  }[];
  expect(attachmentRows.map((row) => row.fileName)).toEqual([
    "frozen-before.txt",
  ]);
});
