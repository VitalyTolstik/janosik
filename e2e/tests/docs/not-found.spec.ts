import { expect, test } from "@playwright/test";

import { docsUrl } from "@/helpers/docs.js";
import { sitePath } from "@/helpers/urls.js";

/**
 * Unknown docs paths fall through to the marketing site's dual-language 404:
 * status 404, copy in the URL's language, a working docs link and noindex.
 */

function langSlot(page: import("@playwright/test").Page, lang: "en" | "ru") {
  return page
    .locator(`.lang-slot[data-lang="${lang}"]`)
    .filter({ has: page.getByRole("heading", { level: 1 }) });
}

test("unknown docs paths show the localized 404 with a docs link", async ({
  page,
}) => {
  const english = await page.goto(docsUrl("does-not-exist/"));
  expect(english?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Page not found — Janosik");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This page seems to be missing.",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    langSlot(page, "en").getByRole("link", { name: "Read the docs" }),
  ).toHaveAttribute("href", sitePath("/docs/"));

  const russian = await page.goto(docsUrl("nope/", "ru"));
  expect(russian?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page).toHaveTitle("Страница не найдена — Janosik");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Не удалось найти эту страницу.",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    langSlot(page, "ru").getByRole("link", { name: "Документация" }),
  ).toHaveAttribute("href", sitePath("/ru/docs/"));
});
