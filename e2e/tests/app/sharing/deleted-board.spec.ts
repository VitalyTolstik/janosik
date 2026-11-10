import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 90_000 });

test("deleting the board kills live links but leaves the snapshot readable", async ({
  browser,
  sharing,
}) => {
  test.slow();
  const live = await sharing.createShare("live");
  const snapshot = await sharing.createShare("snapshot");

  const anonymous = await browser.newContext();
  try {
    const snapshotPage = await anonymous.newPage();
    const livePage = await anonymous.newPage();
    await snapshotPage.goto(publicUrl(snapshot.token));
    await livePage.goto(publicUrl(live.token));
    await expect(
      snapshotPage
        .getByTestId("card-title")
        .filter({ hasText: "Original card" }),
    ).toBeVisible();
    await expect(
      livePage.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible();

    const deleted = await sharing.api.delete(
      `/api/v1/boards/${sharing.boardId}`,
    );
    expect(deleted.ok()).toBeTruthy();

    // Deleting the board revokes its live links, so the open stream drops to
    // the same 404 as a revoked token (a snapshot is untouched).
    await expect(livePage.getByTestId("share-unavailable-code")).toHaveText(
      "404",
      { timeout: 40_000 },
    );
    await snapshotPage.reload();
    await expect(
      snapshotPage
        .getByTestId("card-title")
        .filter({ hasText: "Original card" }),
    ).toBeVisible();

    await livePage.reload();
    await expect(livePage.getByTestId("share-unavailable-code")).toHaveText(
      "404",
    );
  } finally {
    await anonymous.close();
  }
});
