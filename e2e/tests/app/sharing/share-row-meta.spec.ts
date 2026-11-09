import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("a share row shows its title, view count and visibility flags", async ({
  page,
  browser,
  sharing,
}) => {
  const share = await sharing.createShare("snapshot", {
    title: "Release snapshot",
    includeComments: true,
    includeAttachments: true,
  });

  const anonymous = await browser.newContext();
  try {
    const viewer = await anonymous.newPage();
    await viewer.goto(publicUrl(share.token));
    await expect(
      viewer.getByTestId("card-title").filter({ hasText: "Original card" }),
    ).toBeVisible();
  } finally {
    await anonymous.close();
  }

  await sharing.openOwner(page);
  await page.getByTestId("share-mode-snapshot").click();
  const row = page.getByTestId("share-row").filter({ hasText: share.token });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Release snapshot");
  await expect(row).toContainText("1 views");
  await expect(row).toContainText("Comments visible");
  await expect(row).toContainText("Attachments visible");
});
