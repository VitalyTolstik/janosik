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

test("switches a Russian page back to English", async ({ page }) => {
  await page.goto(sitePage("/ru/pricing/"));

  await langSwitch(page).click();

  await expect(page).toHaveURL(sitePage("/pricing/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Free to run on your own server",
  );
});
