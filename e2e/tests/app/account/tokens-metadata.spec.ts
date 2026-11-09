import { test, expect } from "@/fixtures/account.js";
import { openAccount, tokenRequest } from "@/helpers/account.js";

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

test("shows expiry, last-used and scope metadata", async ({
  page,
  playwright,
  testIp,
  account,
}) => {
  await account.createBoard("Metadata board");
  await account.open(page);
  await openAccount(page, "tokens");

  await page.getByTestId("token-create").click();
  await page.getByTestId("token-name").fill("Metadata key");
  await page.getByTestId("token-expiry").click();
  await page.getByRole("menuitemradio", { name: "In 30 days" }).click();
  await page.getByTestId("token-create-submit").click();
  const reveal = page.getByTestId("token-reveal");
  await expect(reveal).toBeVisible();
  const token = (await reveal.textContent()) ?? "";
  await page.getByTestId("token-done").click();

  let row = page.getByTestId("token-row").filter({ hasText: "Metadata key" });
  await expect(row).toContainText(
    `Expires ${shortDate(Date.now() + 30 * 24 * 60 * 60 * 1000)}`,
  );
  await expect(row).toContainText("last used never");
  await expect(row.getByTestId("token-scope")).toContainText("All boards");

  const client = await tokenRequest(playwright, token, testIp);
  try {
    const response = await client.get("/api/v1/boards");
    expect(response.status()).toBe(200);
  } finally {
    await client.dispose();
  }

  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await openAccount(page, "tokens");
  row = page.getByTestId("token-row").filter({ hasText: "Metadata key" });
  await expect(row).toContainText("last used");
  await expect(row).not.toContainText("last used never");
  await expect(row).toContainText("Expires");
  await expect(row.getByTestId("token-scope")).toContainText("All boards");
});
