import { expect, type Locator, type Page } from "@playwright/test";

import { appEntry } from "./urls.js";

/**
 * Helpers for the marketing site (`site/`): every page is public, so tests do
 * not need an account. The app CTAs are checked end to end because the site
 * and the app share an origin in the self-host image (`/` and `/app/`).
 */

export type SiteLang = "en" | "ru";
export type AuthMode = "login" | "register";

/** Auth-screen copy the site CTA hands the visitor to. */
const AUTH_TITLE: Record<SiteLang, Record<AuthMode, string>> = {
  en: { login: "Sign in", register: "Create an account" },
  ru: { login: "Вход", register: "Создать аккаунт" },
};

/** The language switcher in the marketing-site header. */
export function langSwitch(page: Page): Locator {
  return page.locator("header a.lang-btn");
}

/** The theme toggle in the marketing-site header. */
export function themeToggle(page: Page): Locator {
  return page.locator("header [data-theme-toggle]");
}

/** Click a CTA by its analytics hook (`data-cta`). */
export async function clickCta(page: Page, name: string): Promise<void> {
  await page.locator(`[data-cta="${name}"]`).click();
}

/**
 * Assert the CTA really opened the app's login or registration screen on the
 * deployed `/app/` base, with the language handed over through `?lng=`.
 */
export async function expectAppAuth(
  page: Page,
  { lang, mode }: { lang: SiteLang; mode: AuthMode },
): Promise<void> {
  const query = `?lng=${lang}${mode === "register" ? "&mode=register" : ""}`;
  await expect(page).toHaveURL(appEntry(query));
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(
    page.getByRole("heading", { name: AUTH_TITLE[lang][mode] }),
  ).toBeVisible();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("login-password")).toBeVisible();
  if (mode === "register") {
    await expect(page.getByTestId("login-display-name")).toBeVisible();
  } else {
    await expect(page.getByTestId("login-display-name")).toHaveCount(0);
  }
}
