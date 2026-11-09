import { expect, test } from "@playwright/test";

import { sitePage, sitePath } from "@/helpers/urls.js";

/**
 * Small-screen header and footer. The marketing header shows the nav from
 * 720px, so both auth actions must be reachable from that breakpoint too;
 * below it, at least Sign in stays in the header and Pricing/Docs stay in the
 * footer. This is the regression guard for the 720–879px dead zone where both
 * header CTAs used to be hidden.
 */

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
}

test("keeps auth and navigation reachable on phones and tablets", async ({
  page,
}) => {
  const signIn = page.locator(
    'header .header-actions a[data-cta="header-signin"]',
  );
  const signUp = page.locator(
    'header .header-actions a[data-cta="header-signup"]',
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(sitePage("/"));

  await expectNoHorizontalOverflow(page);
  await expect(signIn).toBeVisible();
  // The marketing site links to the app with a root-relative URL, so it keeps
  // working behind a path prefix and on a split host.
  await expect(signIn).toHaveAttribute("href", `${sitePath("/app/")}?lng=en`);
  await expect(signUp).toBeHidden();
  await expect(page.locator(".site-nav")).toBeHidden();

  const footer = page.getByRole("contentinfo");
  await expect(
    footer.getByRole("link", { name: "Pricing", exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByRole("link", { name: "Pricing", exact: true }),
  ).toHaveAttribute("href", sitePath("/pricing/"));
  await expect(
    footer.getByRole("link", { name: "Docs", exact: true }),
  ).toBeVisible();
  await expect(
    footer.getByRole("link", { name: "Docs", exact: true }),
  ).toHaveAttribute("href", sitePath("/docs/"));

  // The regression: from 720px the nav is visible, but both auth CTAs were
  // hidden until 880px, so a tablet had no way into the app.
  for (const width of [720, 768, 879]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(sitePage("/pricing/"));

    await expectNoHorizontalOverflow(page);
    await expect(page.locator(".site-nav"), `${width}px`).toBeVisible();
    await expect(signIn, `${width}px`).toBeVisible();
    await expect(signUp, `${width}px`).toBeVisible();
  }
});
