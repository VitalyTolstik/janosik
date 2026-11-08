import { expect, test } from "@playwright/test";

import { appEntryUrl, docsUrl, openDocs, siteHomeUrl } from "@/helpers/docs.js";

test("opens the English docs from the site header", async ({ page }) => {
  await page.goto(siteHomeUrl());

  await page.locator(".site-nav").getByRole("link", { name: "Docs" }).click();

  await expect(page).toHaveURL(docsUrl());
  await expect(
    page.getByRole("heading", { level: 1, name: "Documentation" }),
  ).toBeVisible();
});

test("opens the Russian docs from the site footer", async ({ page }) => {
  await page.goto(siteHomeUrl("ru"));

  await page
    .locator("footer")
    .getByRole("link", { name: "Документация" })
    .click();

  await expect(page).toHaveURL(docsUrl("", "ru"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("heading", { level: 1, name: "Документация" }),
  ).toBeVisible();
});

test("returns from the English docs to the English site", async ({ page }) => {
  await openDocs(page, "user-guide/boards/");

  await page.locator(".site-title").click();

  await expect(page).toHaveURL(siteHomeUrl());
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Kanban for your agent swarm.",
    }),
  ).toBeVisible();
});

test("returns from the Russian docs to the Russian site", async ({ page }) => {
  await openDocs(page, "user-guide/boards/", "ru");

  await page.locator(".site-title").click();

  await expect(page).toHaveURL(siteHomeUrl("ru"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Канбан для вашего роя агентов.",
    }),
  ).toBeVisible();
});

test("opens the app in English from the docs header", async ({ page }) => {
  await openDocs(page);

  await page.locator("header").getByRole("link", { name: "Open app" }).click();

  await expect(page).toHaveURL(appEntryUrl("en"));
  await expect(page.getByTestId("login-submit")).toHaveText("Sign in");
});

test("opens the app in Russian from the docs header", async ({ page }) => {
  await openDocs(page, "", "ru");

  await page
    .locator("header")
    .getByRole("link", { name: "Открыть приложение" })
    .click();

  await expect(page).toHaveURL(appEntryUrl("ru"));
  await expect(page.getByTestId("login-submit")).toHaveText("Войти");
});
