import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("refreshing a snapshot from the share dialog serves the new content", async ({
  page,
  browser,
  sharing,
}) => {
  const snapshot = await sharing.createShare("snapshot", {
    includeComments: true,
    includeAttachments: true,
  });
  const before = await sharing.api.get(`/api/v1/share/${snapshot.token}`);
  expect(before.ok()).toBeTruthy();
  const beforePayload = (await before.json()) as {
    takenAt: number;
    seq: number | null;
  };

  await sharing.addCard("Later card");
  const laterComment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "Later comment" } },
  );
  expect(laterComment.status()).toBe(201);

  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(snapshot.token));
    await expect(viewer.getByText("Shared · read-only")).toBeVisible();
    await expect(
      viewer.getByTestId("card-title").filter({ hasText: "Later card" }),
    ).toHaveCount(0);

    await sharing.openOwner(page);
    await page.getByTestId("share-mode-snapshot").click();
    const row = page
      .getByTestId("share-row")
      .filter({ hasText: snapshot.token });
    await row.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page.locator(".janosik-toast").filter({ hasText: "Snapshot refreshed" }),
    ).toBeVisible();
    await expect(
      page.locator(".janosik-toast").filter({ hasText: "Snapshot refreshed" }),
    ).toBeHidden({ timeout: 10_000 });

    const after = await sharing.api.get(`/api/v1/share/${snapshot.token}`);
    expect(after.ok()).toBeTruthy();
    const afterPayload = (await after.json()) as {
      takenAt: number;
      seq: number | null;
    };
    expect(afterPayload.takenAt).toBeGreaterThan(beforePayload.takenAt);
    expect(afterPayload.seq).not.toBe(beforePayload.seq);

    await viewer.reload();
    await expect(viewer.getByText("Shared · read-only")).toBeVisible();
    await expect(
      viewer.getByTestId("card-title").filter({ hasText: "Later card" }),
    ).toBeVisible();
    await viewer
      .getByTestId("card-title")
      .filter({ hasText: "Original card" })
      .click();
    await expect(viewer.getByTestId("public-comments")).toContainText(
      "Later comment",
    );
  } finally {
    await anonymous.close();
  }
});
