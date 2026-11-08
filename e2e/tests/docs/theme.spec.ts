import { expect, test } from "@playwright/test";

import { openDocs, siteHomeUrl, themeSelect } from "@/helpers/docs.js";

test("keeps an explicit docs theme on the site and after reload", async ({
  page,
}) => {
  await openDocs(page);

  await themeSelect(page).selectOption("dark");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("starlight-theme")))
    .toBe("dark");

  await page.goto(siteHomeUrl());

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openDocs(page);
  await expect(themeSelect(page)).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("keeps a theme chosen on the site in the docs and after reload", async ({
  page,
}) => {
  await page.goto(siteHomeUrl());
  await page.evaluate(() => localStorage.setItem("starlight-theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.locator("[data-theme-toggle]").click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("starlight-theme")))
    .toBe("dark");

  await openDocs(page);
  await expect(themeSelect(page)).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("follows the system theme in automatic mode across docs and site", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openDocs(page);

  await themeSelect(page).selectOption("auto");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("starlight-theme")))
    .toBe("");

  await page.goto(siteHomeUrl());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await openDocs(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
