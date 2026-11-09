import { expect, test } from "@playwright/test";

import { sitePage, sitePath } from "@/helpers/urls.js";

/** The visible language block on the dual-language 404. */
function langSlot(page: import("@playwright/test").Page, lang: "en" | "ru") {
  return page.locator(`.lang-slot[data-lang="${lang}"]`).filter({
    has: page.getByRole("heading", { level: 1 }),
  });
}

/**
 * Site 404: the self-host server answers an unknown marketing path with the
 * Astro `404.html` and status 404, in the language of the URL.
 */

test("unknown path shows the site 404 page", async ({ page }) => {
  const response = await page.goto(sitePage("/missing-page/"));

  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This page seems to be missing.",
  );
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();
});

test("404 page links back to the home page", async ({ page }) => {
  await page.goto(sitePage("/missing-page/"));

  await page.getByRole("link", { name: "Back to home" }).click();

  await expect(page).toHaveURL(sitePage("/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kanban for your agent swarm.",
  );
});

test("Russian unknown path shows the Russian 404 page", async ({ page }) => {
  const response = await page.goto(sitePage("/ru/missing-page/"));

  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Не удалось найти эту страницу.",
  );
  await expect(page.getByRole("link", { name: "На главную" })).toHaveAttribute(
    "href",
    sitePath("/ru/"),
  );
});

test("404 links to the docs, switches language and stays noindex", async ({
  page,
}) => {
  const response = await page.goto(sitePage("/missing-page/"));
  expect(response?.status()).toBe(404);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    langSlot(page, "en").getByRole("link", { name: "Read the docs" }),
  ).toHaveAttribute("href", sitePath("/docs/"));

  const langSwitch = page
    .getByRole("banner")
    .locator('.lang-btn[hreflang="ru"]');
  await expect(langSwitch).toHaveAttribute("href", sitePath("/ru/"));
  await langSwitch.click();

  await expect(page).toHaveURL(sitePage("/ru/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Канбан для вашего роя агентов.",
  );

  const russian = await page.goto(sitePage("/ru/missing-page/"));
  expect(russian?.status()).toBe(404);
  await expect(
    langSlot(page, "ru").getByRole("link", { name: "Документация" }),
  ).toHaveAttribute("href", sitePath("/ru/docs/"));
  await expect(
    page.getByRole("banner").locator('.lang-btn[hreflang="en"]'),
  ).toHaveAttribute("href", sitePath("/"));
});
