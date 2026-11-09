import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("an expired live link is refused and frees its active slot", async ({
  page,
  browser,
  sharing,
}) => {
  const live = await sharing.createShare("live", {
    expiresAt: new Date(Date.now() + 5_000).toISOString(),
  });
  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(live.token));
    await expect(viewer.getByText("Live · read-only")).toBeVisible();

    await viewer.waitForTimeout(6_000);
    await viewer.reload();
    await expect(viewer.getByTestId("share-unavailable-code")).toHaveText(
      "404",
    );
  } finally {
    await anonymous.close();
  }

  await sharing.openOwner(page);
  await page.getByTestId("share-mode-live").click();
  const row = page.getByTestId("share-row").filter({ hasText: live.token });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Expired");
  await expect(page.getByText("Active links: 0 / 5")).toBeVisible();
  await expect(page.getByTestId("share-create")).toBeEnabled();
});
