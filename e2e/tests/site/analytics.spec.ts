import { expect, test, type Page } from "@playwright/test";

import { sitePage, siteUrl } from "@/helpers/urls.js";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * CTA analytics on the marketing site. The site is public; each test installs
 * a fake `dataLayer` before the first script runs and stops the CTA's
 * navigation so the event array survives the click.
 */

async function installDataLayer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.dataLayer = [];
    // The analytics listener is delegated at the document level. Preventing
    // the default navigation keeps the page (and its dataLayer) alive without
    // suppressing the event the listener needs.
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-cta]")) event.preventDefault();
      },
      { capture: true },
    );
  });
}

function cspDirective(header: string, name: string): string {
  return (
    header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

test("records one CTA click in dataLayer with its language and page", async ({
  page,
}) => {
  await installDataLayer(page);
  const response = await page.goto(sitePage("/"));
  expect(response?.status()).toBe(200);

  await page.locator('[data-cta="hero-signup"]').click();

  const first = await page.evaluate(() => window.dataLayer);
  expect(first).toEqual([
    {
      event: "cta_clicked",
      cta: "hero-signup",
      lang: "en",
      page: new URL(sitePage("/")).pathname,
    },
  ]);

  await page.locator('[data-cta="header-signin"]').click();

  const second = await page.evaluate(() => window.dataLayer);
  expect(second).toHaveLength(2);
  expect(second?.[1]).toEqual({
    event: "cta_clicked",
    cta: "header-signin",
    lang: "en",
    page: new URL(sitePage("/")).pathname,
  });

  // The server-side CSP must allow the default cookieless provider; otherwise
  // enabling PUBLIC_ANALYTICS_DOMAIN silently blocks both the script and its
  // event beacon.
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(cspDirective(csp, "script-src")).toContain("https://plausible.io");
  expect(cspDirective(csp, "connect-src")).toContain("https://plausible.io");
});

test("honours Do Not Track and loads no provider script", async ({ page }) => {
  await installDataLayer(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "doNotTrack", {
      configurable: true,
      get: () => "1",
    });
  });

  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(siteUrl).origin) external.push(request.url());
  });

  await page.goto(sitePage("/"));
  await page.locator('[data-cta="hero-signup"]').click();

  expect(await page.evaluate(() => window.dataLayer)).toEqual([]);
  expect(external.map((url) => new URL(url).hostname)).not.toContain(
    "plausible.io",
  );
});
