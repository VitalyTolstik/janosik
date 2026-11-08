import { expect, test } from "@playwright/test";

import { clickCta, expectAppAuth } from "@/helpers/site.js";
import { appUrl, sitePage } from "@/helpers/urls.js";

/**
 * The marketing site hands visitors to the app (`/app/` in the self-host
 * image). Each CTA must land on the right auth screen with the visitor's
 * language, not on a 404 or the site root.
 */

test("header Sign in opens the app login screen", async ({ page }) => {
  await page.goto(sitePage("/"));

  await clickCta(page, "header-signin");

  await expectAppAuth(page, { lang: "en", mode: "login" });
});

test("header Create account opens the app registration screen", async ({
  page,
}) => {
  await page.goto(sitePage("/"));

  await clickCta(page, "header-signup");

  await expectAppAuth(page, { lang: "en", mode: "register" });
});

test("hero call to action opens the app registration screen", async ({
  page,
}) => {
  await page.goto(sitePage("/"));

  await clickCta(page, "hero-signup");

  await expectAppAuth(page, { lang: "en", mode: "register" });
});

test("pricing call to action opens the app registration screen", async ({
  page,
}) => {
  await page.goto(sitePage("/pricing/"));

  await clickCta(page, "pricing-signup");

  await expectAppAuth(page, { lang: "en", mode: "register" });
});

test("Russian page hands its language to the app", async ({ page }) => {
  await page.goto(sitePage("/ru/"));

  await clickCta(page, "header-signin");

  await expectAppAuth(page, { lang: "ru", mode: "login" });
});

test("every app entry link stays inside the deployed app base", async ({
  page,
}) => {
  await page.goto(sitePage("/"));

  const entries = await page
    .locator('[data-cta$="-signin"], [data-cta$="-signup"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        cta: (element as HTMLElement).dataset.cta ?? "",
        href: (element as HTMLAnchorElement).href,
      })),
    );

  expect(entries.length).toBeGreaterThanOrEqual(5);

  const app = new URL(appUrl);
  for (const { cta, href } of entries) {
    const url = new URL(href);
    expect(url.origin, cta).toBe(app.origin);
    expect(url.pathname, cta).toBe(app.pathname);
    expect(url.searchParams.get("lng"), cta).toBe("en");
    expect(url.searchParams.get("mode"), cta).toBe(
      cta.endsWith("signup") ? "register" : null,
    );
  }
});
