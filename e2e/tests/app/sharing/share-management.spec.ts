import { test, expect } from "../../../fixtures/sharing.js";

test.describe.configure({ timeout: 60_000 });

test("mode filters, limits and revoked link deletion", async ({
  page,
  sharing,
}) => {
  for (let i = 0; i < 5; i++) await sharing.createShare("live");
  for (let i = 0; i < 10; i++) await sharing.createShare("snapshot");
  await sharing.openOwner(page);
  const dialog = page.getByRole("dialog");
  const height = (await dialog.boundingBox())!.height;
  await expect(page.getByText("Active links: 5 / 5")).toBeVisible();
  await expect(page.getByTestId("share-row")).toHaveCount(5);
  await expect(page.getByTestId("share-create")).toBeDisabled();
  await page.getByTestId("share-mode-snapshot").click();
  await expect(page.getByText("Active links: 10 / 10")).toBeVisible();
  await expect(page.getByTestId("share-row")).toHaveCount(10);
  await expect(page.getByTestId("share-create")).toBeDisabled();
  await page.getByTestId("share-mode-live").click();
  await page.getByTestId("share-ttl").click();
  await page.getByRole("radio", { name: "Never" }).click();
  await expect(
    page.getByText(/A link with similar settings already exists/),
  ).toBeVisible();
  expect((await dialog.boundingBox())!.height).toBe(height);
  const row = page.getByTestId("share-row").first();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Active links: 4 / 5")).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Embed code" })).toHaveCount(0);
  await row.getByRole("button", { name: "Delete revoked link" }).click();
  await row.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();
  await row.getByRole("button", { name: "Delete revoked link" }).click();
  await row.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page.getByTestId("share-row")).toHaveCount(4);
  await expect(page.getByTestId("share-create")).toBeEnabled();
  expect((await dialog.boundingBox())!.height).toBe(height);
});
