import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { login } from "../fixtures/auth.js";
import { siteUrl } from "./urls.js";

export type AccountUser = { email: string; password: string };

export type AccountSection = "profile" | "security" | "tokens" | "preferences";

/** Open the account panel and land on `section`. */
export async function openAccount(
  page: Page,
  section: AccountSection = "profile",
): Promise<Locator> {
  await page.getByTestId("account-trigger").click();
  const dialog = page.getByTestId("account-dialog");
  await expect(dialog).toBeVisible();
  if (section !== "profile") {
    await dialog.getByTestId(`account-nav-${section}`).click();
    await expect(dialog.getByTestId(`account-${section}`)).toBeVisible();
  }
  return dialog;
}

export async function showSection(page: Page, section: AccountSection) {
  await page.getByTestId(`account-nav-${section}`).click();
  const panel = page.getByTestId(`account-${section}`);
  await expect(panel).toBeVisible();
  return panel;
}
/** Create a token through the UI and return the one-time plaintext. */
export async function createTokenThroughUi(
  page: Page,
  name: string,
): Promise<string> {
  await page.getByTestId("token-create").click();
  await page.getByTestId("token-name").fill(name);
  await page.getByTestId("token-create-submit").click();
  const reveal = page.getByTestId("token-reveal");
  await expect(reveal).toBeVisible();
  const token = (await reveal.textContent()) ?? "";
  expect(token).toMatch(/^jnk_/);
  await page.getByTestId("token-done").click();
  await expect(page.getByTestId("token-dialog")).toBeHidden();
  return token;
}

/** An authenticated API client for a raw PAT. */
export function tokenRequest(
  playwright: PlaywrightWorkerArgs["playwright"],
  token: string,
  testIp: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: {
      "X-Forwarded-For": testIp,
      Authorization: `Bearer ${token}`,
    },
  });
}

/** A genuinely separate Chrome context signed in as the same account. */
export async function newSession(
  browser: Browser,
  user: AccountUser,
  testIp: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": testIp },
    locale: "en-US",
  });
  const page = await context.newPage();
  await login(page, user);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  return { context, page };
}

/** Sign out through the account panel (confirmation is part of the flow). */
export async function signOutThroughUi(page: Page): Promise<void> {
  await openAccount(page);
  await page.getByTestId("account-logout").click();
  const confirm = page.getByRole("dialog", { name: "Sign out?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("login-submit")).toBeVisible();
}

export function newEmail(prefix = "changed"): string {
  return `${prefix}-${randomUUID()}@e2e.example`;
}

/** A 1×1 transparent PNG — a real file for the server-side sniff. */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export async function fillCode(
  page: Page,
  testId: string,
  code: string,
): Promise<void> {
  const inputs = page.getByTestId(testId).locator("input");
  await expect(inputs).toHaveCount(code.length);
  for (let index = 0; index < code.length; index += 1) {
    await inputs.nth(index).fill(code[index]);
  }
}
