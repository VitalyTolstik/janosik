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

test("navigates results with the keyboard and restores focus on Escape", async ({
  page,
}) => {
  await openDocs(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(searchInput(page)).toBeVisible();

  await searchInput(page).fill("self-hosting");
  await expect(searchResults(page).first()).toBeVisible();

  // Query present → the clear button, then the first result (the exact number
  // of stops depends on optional Pagefind controls, so walk until a result).
  let focused = { className: "", focusVisible: false };
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => ({
      className: document.activeElement?.className ?? "",
      focusVisible: document.activeElement?.matches(":focus-visible") ?? false,
    }));
    if (focused.className.includes("pagefind-ui__result-link")) break;
  }
  expect(focused.className).toContain("pagefind-ui__result-link");
  expect(focused.focusVisible).toBe(true);

  // Open whichever result the keyboard focused instead of assuming Pagefind's
  // ranking; the point is that Enter follows the focused link.
  const focusedHref = await page.evaluate(
    () => document.activeElement?.getAttribute("href") ?? "",
  );
  expect(focusedHref).not.toBe("");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new URL(focusedHref, docsUrl()).href);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await openSearch(page);
  await searchInput(page).fill("boards");
  await expect(searchResults(page).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(searchDialog(page)).toBeHidden();
  await expect(searchButton(page)).toBeFocused();
});

test("shows a recoverable error when the Pagefind bundle fails to load", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/pagefind/pagefind.js", (route) => {
    requests += 1;
    return route.abort();
  });

  await openDocs(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(searchInput(page)).toBeVisible();
  await searchInput(page).fill("self-hosting");

  const error = page.locator("#starlight-search-error");
  await expect(error).toBeVisible({ timeout: 10_000 });
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toContainText(/unavailable|недоступен/i);
  await expect(
    error.getByRole("button", { name: /Retry|Повторить/i }),
  ).toBeVisible();
  await expect(page.getByText(/Searching|Поиск/i)).toHaveCount(0);
  expect(requests).toBeGreaterThan(0);

  // Retry reloads the page; once the bundle is reachable again the same query
  // finds the page, proving the failure state is recoverable.
  await Promise.all([
    page.waitForEvent("framenavigated"),
    error.getByRole("button", { name: /Retry|Повторить/i }).click(),
  ]);
  await page.waitForLoadState("load");
  await page.unroute("**/pagefind/pagefind.js");

  await page.goto(docsUrl());
  await openSearch(page);
  await searchInput(page).fill("self-hosting");
  await expect(searchResults(page).first()).toBeVisible();
});
