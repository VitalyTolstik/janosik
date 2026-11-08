import { expect, test } from "@playwright/test";

import { themeToggle } from "@/helpers/site.js";
import { sitePage } from "@/helpers/urls.js";

/**
 * Theme toggle: the marketing site and Starlight share `starlight-theme` and
 * the `data-theme` attribute, so a choice survives a reload and follows the
 * visitor into the documentation.
 */

test("toggles the page between light and dark", async ({ page }) => {
  await page.goto(sitePage("/"));

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await themeToggle(page).click();

  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("starlight-theme")),
  ).toBe("dark");

  await themeToggle(page).click();

  await expect(html).toHaveAttribute("data-theme", "light");
});

test("keeps the theme after a reload", async ({ page }) => {
  await page.goto(sitePage("/pricing/"));

  await themeToggle(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("carries the theme into the documentation", async ({ page }) => {
  await page.goto(sitePage("/"));

  await themeToggle(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto(sitePage("/docs/"));

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
