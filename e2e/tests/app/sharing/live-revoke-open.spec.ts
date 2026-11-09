import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 90_000 });

test("revoking a live link disconnects an already open viewer", async ({
  page,
  browser,
  sharing,
}) => {
  test.slow();
  const live = await sharing.createShare("live");
  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(live.token));
    await expect(viewer.getByText("Live · read-only")).toBeVisible();
    await expect(
      viewer.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible();

    await sharing.openOwner(page);
    const row = page.getByTestId("share-row").filter({ hasText: live.token });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row.getByText("Revoked")).toBeVisible();

    // The open stream checks its share on the keep-alive tick; the page must
    // drop to the unavailable state without a reload (keep-alive is 25 s).
    await expect(viewer.getByTestId("share-unavailable-code")).toHaveText(
      "404",
      { timeout: 40_000 },
    );
    await expect(viewer.getByText("Live · read-only")).toHaveCount(0);
    await expect(
      viewer.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toHaveCount(0);

    await viewer.reload();
    await expect(viewer.getByTestId("share-unavailable-code")).toHaveText(
      "404",
    );
  } finally {
    await anonymous.close();
  }
});
