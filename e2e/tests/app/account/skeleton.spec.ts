import { test, expect } from "@/fixtures/account.js";
import { openAccount } from "@/helpers/account.js";
import { delayNextRoute } from "@/helpers/network.js";

/**
 * Account skeleton (SKELETON-AUDIT §4.9): the API keys panel used to be
 * empty until its list arrived; now it reserves three rows and says it is
 * busy.
 */

test("reserves the API key list while it loads", async ({ page, account }) => {
  await account.open(page);
  await delayNextRoute(page, "**/api/v1/users/me/tokens", 1500);
  const panel = await openAccount(page, "tokens");

  const section = page.getByTestId("account-tokens");
  await expect(section).toHaveAttribute("aria-busy", "true");
  const skeleton = page.getByTestId("account-tokens-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(panel.getByText("No API keys yet")).toHaveCount(0);

  await expect(panel.getByText("No API keys yet")).toBeVisible({
    timeout: 10_000,
  });
  await expect(skeleton).toHaveCount(0);
  await expect(section).toHaveAttribute("aria-busy", "false");
});
