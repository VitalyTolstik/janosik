import { test, expect, publicUrl } from "../../../fixtures/sharing.js";

test("live and snapshot links remain read-only and diverge as the board changes", async ({
  page,
  browser,
  sharing,
}) => {
  const comment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "A visible comment" } },
  );
  expect(comment.status()).toBe(201);
  const attachment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "visible.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("visible attachment"),
        },
      },
    },
  );
  expect(attachment.status()).toBe(201);
  await sharing.openOwner(page);
  await page.getByTestId("share-mode-snapshot").click();
  await page.getByRole("checkbox", { name: "Show comments" }).uncheck();
  const snapshotCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("share-create").click();
  const snapshotResponse = await snapshotCreated;
  expect(snapshotResponse.status()).toBe(201);
  const snapshot = (await snapshotResponse.json()) as { token: string };
  await page.getByTestId("share-mode-live").click();
  await page.getByRole("checkbox", { name: "Show comments" }).check();
  await page.getByRole("checkbox", { name: "Show attachments" }).click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("share-create").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const live = (await response.json()) as { token: string };
  const anonymous = await browser.newContext();
  try {
    const livePage = await anonymous.newPage();
    const snapshotPage = await anonymous.newPage();
    await livePage.goto(publicUrl(live.token));
    await expect(livePage.getByText("Live · read-only")).toBeVisible();
    await expect(
      livePage.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible();
    await expect(livePage.getByTestId("share-trigger")).toHaveCount(0);
    await livePage
      .getByTestId("card-title")
      .filter({ hasText: "Original card" })
      .click();
    await expect(livePage.getByTestId("public-comments")).toContainText(
      "A visible comment",
    );
    await expect(
      livePage.getByRole("link", { name: "visible.txt" }),
    ).toBeVisible();
    await expect(livePage.getByRole("textbox")).toHaveCount(0);
    await livePage.getByRole("button", { name: "Close" }).click();
    await snapshotPage.goto(publicUrl(snapshot.token));
    await expect(snapshotPage.getByText("Shared · read-only")).toBeVisible();
    await expect(
      snapshotPage
        .getByTestId("card-title")
        .filter({ hasText: "Original card" }),
    ).toBeVisible();
    await snapshotPage
      .getByTestId("card-title")
      .filter({ hasText: "Original card" })
      .click();
    await expect(snapshotPage.getByTestId("public-comments")).toHaveCount(0);
    await expect(
      snapshotPage.getByRole("link", { name: "visible.txt" }),
    ).toHaveCount(0);
    await snapshotPage.getByRole("button", { name: "Close" }).click();
    await sharing.addCard("Later card");
    await expect(
      livePage.getByTestId("card-title").filter({ hasText: "Later card" }),
    ).toBeVisible();
    await snapshotPage.reload();
    await expect(
      snapshotPage.getByTestId("card-title").filter({ hasText: "Later card" }),
    ).toHaveCount(0);
    const liveRow = page
      .getByTestId("share-row")
      .filter({ hasText: live.token });
    await liveRow.getByRole("button", { name: "Revoke" }).click();
    await expect(liveRow.getByText("Revoked")).toBeVisible();
    await livePage.reload();
    await expect(livePage.getByTestId("share-unavailable-code")).toHaveText(
      "404",
    );
  } finally {
    await anonymous.close();
  }
});
