import { test, expect } from "../../../fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("edits a live link's title and privacy flags, keeping its token", async ({
  page,
  sharing,
}) => {
  const live = await sharing.createShare("live", {
    title: "Before",
    includeComments: true,
    includeAttachments: false,
  });
  await sharing.openOwner(page);

  const row = page.getByTestId("share-row").filter({ hasText: live.token });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Edit link/ }).click();

  await expect(page.getByText("Mode and token can't be changed")).toBeVisible();
  await expect(page.getByTestId("share-mode-live")).toHaveCount(0);
  await expect(page.getByTestId("share-mode-snapshot")).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Label (optional, for your list)" })
    .fill("After");
  await page.getByRole("checkbox", { name: "Show comments" }).click();
  await page.getByRole("checkbox", { name: "Show attachments" }).click();
  await page.getByTestId("share-save").click();

  const confirm = page.getByRole("dialog", {
    name: "Change what this live link shows?",
  });
  await expect(confirm).toBeVisible();
  const patched = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares/${live.id}`) &&
      response.request().method() === "PATCH",
  );
  await confirm.getByRole("button", { name: "Change visibility" }).click();
  expect((await patched).ok()).toBeTruthy();

  await expect(row).toContainText("After");
  await expect(row).toContainText("Attachments visible");
  await expect(row).toContainText(live.token);

  // The same token now serves the edited privacy flags.
  const payload = await sharing.api.get(`/api/v1/share/${live.token}`);
  expect(payload.ok()).toBeTruthy();
  const body = (await payload.json()) as {
    includeComments: boolean;
    includeAttachments: boolean;
  };
  expect(body.includeComments).toBe(false);
  expect(body.includeAttachments).toBe(true);

  // Turning comments off closes the public comment route, not just the UI.
  const comments = await sharing.api.get(
    `/api/v1/share/${live.token}/cards/${sharing.cardId}/comments`,
  );
  expect(comments.status()).toBe(404);
});

test("expired rows stay editable and revoked rows do not", async ({
  page,
  sharing,
}) => {
  const expired = await sharing.createShare("live", {
    expiresAt: new Date(Date.now() + 3_000).toISOString(),
  });
  const revoked = await sharing.createShare("snapshot", { title: "Gone" });
  const revokedResponse = await sharing.api.delete(
    `/api/v1/boards/${sharing.boardId}/shares/${revoked.id}`,
  );
  expect(revokedResponse.ok()).toBeTruthy();

  await sharing.openOwner(page);

  const expiredRow = page
    .getByTestId("share-row")
    .filter({ hasText: expired.token });
  await expect(expiredRow.getByText("Expired")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    expiredRow.getByRole("button", { name: /^Edit link/ }),
  ).toBeVisible();

  await page.getByTestId("share-mode-snapshot").click();
  const revokedRow = page
    .getByTestId("share-row")
    .filter({ hasText: revoked.token });
  await expect(revokedRow).toContainText("Revoked");
  await expect(
    revokedRow.getByRole("button", { name: /^Edit link/ }),
  ).toHaveCount(0);
});
