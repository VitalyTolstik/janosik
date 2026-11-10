import type { Page } from "@playwright/test";

/**
 * Delay only the next matching request (SKELETON-AUDIT §8.3). The first
 * match waits `ms`, everything after — including realtime streams and
 * follow-up commands — continues immediately. This keeps the skeleton
 * assertions deterministic without slowing down the whole spec.
 */
export async function delayNextRoute(
  page: Page,
  pattern: string | RegExp,
  ms = 900,
): Promise<void> {
  let delayed = false;
  await page.route(pattern, async (route) => {
    if (delayed) {
      await route.continue();
      return;
    }
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}
