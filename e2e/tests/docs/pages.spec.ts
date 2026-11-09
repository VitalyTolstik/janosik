import { expect, test } from "@playwright/test";

import { DOCS_PAGES, docsPath, docsUrl } from "@/helpers/docs.js";

/**
 * Every documentation route exists in both locales: 23 English + 23 Russian
 * pages with a 200 status, the right `<html lang>`, one H1, a title and a
 * self-referencing canonical. The docs are public.
 */

test("serves all 23 English and 23 Russian documentation pages", async ({
  page,
}) => {
  test.slow();

  for (const lang of ["en", "ru"] as const) {
    for (const path of DOCS_PAGES) {
      const url = docsUrl(path, lang);
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      expect(response?.status(), url).toBe(200);
      await expect(page.locator("html"), url).toHaveAttribute("lang", lang);
      await expect(page, url).toHaveTitle(/Janosik/);

      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading, url).toHaveCount(1);
      await expect(heading, url).toBeVisible();
      expect((await heading.textContent())?.trim(), url).not.toBe("");

      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(canonical, url).not.toBeNull();
      expect(new URL(canonical ?? "").pathname, url).toBe(docsPath(path, lang));

      const description = await page
        .locator('meta[name="description"]')
        .getAttribute("content");
      expect(description?.trim(), url).not.toBe("");
    }
  }
});
