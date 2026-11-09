import { expect, test } from "@playwright/test";

import { docsPath, docsUrl } from "@/helpers/docs.js";
import { sitePath } from "@/helpers/urls.js";

/**
 * Documentation SEO: canonical, hreflang, description and the docs social card
 * on the index and a representative content page, in both locales.
 */

test("publishes canonical, hreflang and docs social metadata", async ({
  page,
}) => {
  const pages = [
    { path: "", lang: "en" as const },
    { path: "admin/settings/", lang: "en" as const },
    { path: "", lang: "ru" as const },
    { path: "admin/settings/", lang: "ru" as const },
  ];

  for (const current of pages) {
    const response = await page.goto(docsUrl(current.path, current.lang));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Janosik/);
    await expect(page.locator("html")).toHaveAttribute("lang", current.lang);

    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(new URL(canonical ?? "").pathname).toBe(
      docsPath(current.path, current.lang),
    );

    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          lang: node.getAttribute("hreflang"),
          href: node.getAttribute("href"),
        })),
      );
    const byLang = new Map(alternates.map((item) => [item.lang, item.href]));
    expect(new URL(byLang.get("en") ?? "").pathname).toBe(
      docsPath(current.path, "en"),
    );
    expect(new URL(byLang.get("ru") ?? "").pathname).toBe(
      docsPath(current.path, "ru"),
    );
    expect(byLang.get("x-default")).toBe(byLang.get("en"));

    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description?.trim()).not.toBe("");
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute("content", description ?? "");
    const heading = (
      await page.getByRole("heading", { level: 1 }).textContent()
    )?.trim();
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      heading ?? "",
    );

    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) {
      const image = await page.locator(selector).getAttribute("content");
      expect(new URL(image ?? "").pathname).toBe(sitePath("/og-docs.png"));
    }
  }
});
