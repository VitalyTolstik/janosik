import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";
import { test as authTest, expect, login } from "./auth.js";
import { siteUrl } from "../helpers/urls.js";

export type AccountUser = { email: string; password: string };

type CreatedToken = { id: string; token: string };

type Account = {
  user: AccountUser;
  /** Session-authenticated API client for setup and assertions. */
  api: APIRequestContext;
  /** Sign in through the UI and wait for the account trigger. */
  open: (page: Page) => Promise<void>;
  createBoard: (title?: string) => Promise<string>;
  createToken: (name?: string) => Promise<CreatedToken>;
};

/**
 * One fresh account per test. The fixture starts from a unique verified user
 * and exposes both the UI entry point and a session-authenticated API client,
 * so a test can prepare data without driving unrelated screens. It never
 * shares a user or a board with another test.
 */
export const test = authTest.extend<{ account: Account }>({
  account: async ({ playwright, createUser, testIp }, use) => {
    const user = await createUser();
    const client = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const logged = await client.post("/api/v1/auth/login", { data: user });
    expect(logged.ok()).toBeTruthy();
    const { accessToken } = (await logged.json()) as { accessToken: string };
    await client.dispose();

    const api = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    try {
      await use({
        user,
        api,
        open: async (page) => {
          await login(page, user);
          await expect(page.getByTestId("account-trigger")).toBeVisible();
        },
        createBoard: async (title = `Account board ${randomUUID()}`) => {
          const response = await api.post("/api/v1/boards", {
            data: { title },
          });
          expect(response.status()).toBe(201);
          const { id } = (await response.json()) as { id: string };
          return id;
        },
        createToken: async (name = `Token ${randomUUID()}`) => {
          const response = await api.post("/api/v1/users/me/tokens", {
            data: { name, expiresAt: null },
          });
          expect(response.status()).toBe(201);
          const body = (await response.json()) as {
            token: string;
            apiToken: { id: string };
          };
          return { token: body.token, id: body.apiToken.id };
        },
      });
    } finally {
      await api.dispose();
    }
  },
});

export { expect };
