import { test, expect, publicUrl } from "@/fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("creating a link copies the real public address to the clipboard", async ({
  page,
  context,
  sharing,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sharing.openOwner(page);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("share-create").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const share = (await response.json()) as { token: string };

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(publicUrl(share.token));
  await expect(
    page
      .locator(".janosik-toast")
      .filter({ hasText: "Link created and copied" }),
  ).toBeVisible();
});

test("a blocked clipboard is reported instead of a copied-link success", async ({
  page,
  sharing,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("clipboard blocked")),
      },
    });
  });
  await sharing.openOwner(page);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/boards/${sharing.boardId}/shares`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId("share-create").click();
  expect((await created).status()).toBe(201);

  await expect(
    page.locator(".janosik-toast").filter({ hasText: "clipboard is blocked" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".janosik-toast")
      .filter({ hasText: "Link created and copied" }),
  ).toHaveCount(0);
  // The row still exists, so the user can copy it manually.
  await expect(page.getByTestId("share-row")).toHaveCount(1);
});
