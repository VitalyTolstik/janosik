import { expect, type Locator, type Page } from "@playwright/test";

import { appUrl } from "./urls.js";

/**
 * Browser navigation helpers: direct board/card links (always including the
 * deploy base from `appUrl`) and the password sign-in path that keeps the
 * current URL — a shared link must survive the login screen.
 */

/** Absolute app URL for a router-relative path such as `board/<id>`. */
export function appLink(path: string): string {
  return new URL(path.replace(/^\/+/, ""), appUrl).href;
}

export function boardLink(boardId: string): string {
  return appLink(`board/${boardId}`);
}

export function cardLink(boardId: string, cardId: string): string {
  return appLink(`board/${boardId}?card=${cardId}`);
}

/** Sign in on the page's current URL instead of starting at the app root. */
export async function signInAt(
  page: Page,
  user: { email: string; password: string },
  url: string,
): Promise<void> {
  await page.goto(url);
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
}

/** The card highlighted by the j/k keyboard cursor. */
export function cursorCard(page: Page): Locator {
  return page.locator('[data-card-cursor="true"]');
}
