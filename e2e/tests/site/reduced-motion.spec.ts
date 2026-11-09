import { expect, test } from "@playwright/test";

import { sitePage } from "@/helpers/urls.js";

/**
 * Reduced-motion visitors get the static poster instead of autoplaying clips,
 * no decorative garden animation and no 404 card animation. All pages are
 * public.
 */

test.use({ reducedMotion: "reduce" });

test("shows posters instead of playing clips and disables 404 motion", async ({
  page,
}) => {
  await page.goto(sitePage("/"));

  const videos = page.locator("video[data-lazy-video]");
  expect(await videos.count()).toBeGreaterThan(0);
  for (const video of await videos.all()) {
    await expect(video).toHaveAttribute("poster", /\/media\/.+\.jpg$/);
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true);
  }
  await expect(page.locator(".hero-garden")).toBeHidden();

  await page.goto(sitePage("/missing-page/"));
  const card = page.locator(".nf-card").first();
  await expect(card).toBeVisible();
  expect(
    await card.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
});
