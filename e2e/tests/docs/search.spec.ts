import { expect, test } from "@playwright/test";

import {
  docsUrl,
  openDocs,
  openSearch,
  searchButton,
  searchDialog,
  searchInput,
  searchMessage,
  searchResults,
} from "@/helpers/docs.js";

test("opens the search dialog from the header button", async ({ page }) => {
  await openDocs(page);

  await searchButton(page).click();

  await expect(searchDialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
});

test("opens and closes the search dialog with the keyboard", async ({
  page,
}) => {
  await openDocs(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(searchDialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toBeHidden();
});

test("finds a page in the English index and opens it", async ({ page }) => {
  await openDocs(page);
  await openSearch(page);

  await searchInput(page).fill("self-hosting");

  await expect(searchResults(page).first()).toBeVisible();
  const firstResult = page.locator(".pagefind-ui__result-link").first();
  await expect(firstResult).toHaveAttribute(
    "href",
    new URL(docsUrl("self-hosting/")).pathname,
  );
  await expect(firstResult).toHaveText("Self-hosting");

  await firstResult.click();

  await expect(page).toHaveURL(docsUrl("self-hosting/"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Self-hosting" }),
  ).toBeVisible();
});

test("searches the Russian index on a Russian page", async ({ page }) => {
  await openDocs(page, "", "ru");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(searchInput(page)).toBeVisible();

  await searchInput(page).fill("установка");

  await expect(searchResults(page).first()).toBeVisible();
  const firstResult = page.locator(".pagefind-ui__result-link").first();
  await expect(firstResult).toHaveAttribute(
    "href",
    new URL(docsUrl("self-hosting/", "ru")).pathname,
  );
  await expect(firstResult).toHaveText("Установка на своём сервере");

  await firstResult.click();

  await expect(page).toHaveURL(docsUrl("self-hosting/", "ru"));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Установка на своём сервере",
    }),
  ).toBeVisible();
});

test("keeps an empty search empty", async ({ page }) => {
  await openDocs(page);
  await openSearch(page);

  await expect(searchInput(page)).toHaveValue("");
  await expect(searchResults(page)).toHaveCount(0);
  await expect(searchMessage(page)).toHaveCount(0);
});

test("reports when a search has no matches", async ({ page }) => {
  await openDocs(page);
  await openSearch(page);

  await searchInput(page).fill("zzzzzz-no-such-page");

  await expect(searchMessage(page)).toContainText(/No results/i);
  await expect(searchResults(page)).toHaveCount(0);
});
