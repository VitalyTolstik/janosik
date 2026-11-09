import { expect, test } from "@playwright/test";

import { langSwitch } from "@/helpers/site.js";
import { sitePage, sitePath } from "@/helpers/urls.js";

/**
 * Language switcher: every marketing page exists in English and Russian, the
 * switch stays on the same page, updates `<html lang>` and translates the
 * navigation and content.
 */

test("switches the home page to Russian in place", async ({ page }) => {
  await page.goto(sitePage("/"));

  await langSwitch(page).click();

  await expect(page).toHaveURL(sitePage("/ru/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Канбан для вашего роя агентов.",
  );
  await expect(
    page
      .locator("header .site-nav")
      .getByRole("link", { name: "Тарифы", exact: true }),
  ).toHaveAttribute("href", sitePath("/ru/pricing/"));
  await expect(page.locator("footer")).toContainText("Продукт");
});

test("switches the pricing page to Russian in place", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await langSwitch(page).click();

  await expect(page).toHaveURL(sitePage("/ru/pricing/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Janosik бесплатно на своём сервере",
  );
  await expect(
    page.getByRole("heading", { name: "На своём сервере", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Облако", exact: true }),
  ).toBeVisible();
});

test("renders the full Russian landing and advertises both locales", async ({
  page,
}) => {
  await page.goto(sitePage("/ru/"));

  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Канбан для вашего роя агентов.",
  );
  for (const heading of [
    "Как рой работает с доской",
    "Всё, что должна уметь доска",
    "Другие возможности",
    "Открытый исходный код и ваши данные",
    "Запуск за минуты",
    "Вопросы",
  ]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator(".more-grid")).toContainText(
    "API-ключи с доступом к одной доске и лимитом запросов",
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
  expect(new URL(byLang.get("en") ?? "").pathname).toBe(sitePath("/"));
  expect(new URL(byLang.get("ru") ?? "").pathname).toBe(sitePath("/ru/"));
  expect(byLang.get("x-default")).toBe(byLang.get("en"));

  await page.goto(sitePage("/ru/pricing/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Janosik бесплатно на своём сервере",
  );
  await expect(page.getByRole("contentinfo")).toContainText("Продукт");
});

test("switches a Russian page back to English", async ({ page }) => {
  await page.goto(sitePage("/ru/pricing/"));

  await langSwitch(page).click();

  await expect(page).toHaveURL(sitePage("/pricing/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );
});
