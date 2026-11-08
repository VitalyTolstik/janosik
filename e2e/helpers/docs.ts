import { expect, type Page } from "@playwright/test";

import { appUrl, siteUrl } from "./urls.js";

export type DocsLang = "en" | "ru";

/** The site origin with a trailing slash, so relative URLs keep the base. */
function siteBase(): string {
  return siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
}

/** Absolute URL of a docs page (`path` is relative to the docs root). */
export function docsUrl(path = "", lang: DocsLang = "en"): string {
  const clean = path.replace(/^\/+/, "");
  const prefix = lang === "ru" ? "ru/docs/" : "docs/";
  return new URL(`${prefix}${clean}`, siteBase()).href;
}

/** Absolute URL of the marketing home in the requested language. */
export function siteHomeUrl(lang: DocsLang = "en"): string {
  return new URL(lang === "ru" ? "ru/" : "", siteBase()).href;
}

/** Absolute app entry URL the docs CTA should use for a locale. */
export function appEntryUrl(lang: DocsLang = "en"): string {
  const url = new URL(appUrl);
  url.searchParams.set("lng", lang);
  return url.href;
}

/** Open a docs page and fail loudly if it is not served with HTTP 200. */
export async function openDocs(
  page: Page,
  path = "",
  lang: DocsLang = "en",
): Promise<void> {
  const url = docsUrl(path, lang);
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (response === null || response.status() !== 200) {
    throw new Error(
      `Expected ${url} to return 200, got ${response?.status() ?? "no response"}`,
    );
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The docs sidebar (one per page; the mobile pane reuses the same markup). */
export function sidebar(page: Page) {
  return page.locator("nav.sidebar");
}

/** Starlight theme picker in the desktop header. */
export function themeSelect(page: Page) {
  return page.locator("header starlight-theme-select select");
}

/** Starlight language picker in the desktop header. */
export function languageSelect(page: Page) {
  return page.locator("header starlight-lang-select select");
}

export function searchButton(page: Page) {
  return page.locator("button[data-open-modal]");
}

export function searchDialog(page: Page) {
  return page.locator("dialog[open]");
}

export function searchInput(page: Page) {
  return page.locator("#starlight__search input");
}

export function searchResults(page: Page) {
  return page.locator(".pagefind-ui__result");
}

export function searchMessage(page: Page) {
  return page.locator(".pagefind-ui__message");
}

/** Open the Pagefind dialog from the header button and wait for its input. */
export async function openSearch(page: Page): Promise<void> {
  await searchButton(page).click();
  await expect(searchDialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
}
