import { test, expect } from "@/fixtures/account.js";
import { openAccount } from "@/helpers/account.js";

/**
 * Account skeleton (SKELETON-AUDIT §4.9): the API keys panel used to be
 * empty until its list arrived; now it reserves three rows and says it is
 * busy.
 */

test("reserves the API key list while it loads", async ({ page, account }) => {
  await account.open(page);
  // Hold every tokens request until the skeleton assertions have run. This is
  // a deterministic gate, not a fixed delay: a loaded CI runner cannot race
  // past the skeleton, and React StrictMode's double mount is held too.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = "**/api/v1/users/me/tokens";
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const panel = await openAccount(page, "tokens");

    const section = page.getByTestId("account-tokens");
    await expect(section).toHaveAttribute("aria-busy", "true");
    const skeleton = page.getByTestId("account-tokens-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(panel.getByText("No API keys yet")).toHaveCount(0);

    release();
    await expect(panel.getByText("No API keys yet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(skeleton).toHaveCount(0);
    await expect(section).toHaveAttribute("aria-busy", "false");
  } finally {
    release();
    await page.unroute(pattern);
  }
});
