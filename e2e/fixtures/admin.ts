import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { test as boardTest } from "./board.js";
import { siteUrl } from "../helpers/urls.js";
import {
  createMasterViaAdmin,
  createUserViaAdmin,
  type MasterCredentials,
} from "../helpers/admin.js";

type PlaywrightApi = typeof import("playwright-core");

export const password = "e2e-password-123";

export interface PanelUser {
  id: string;
  email: string;
  password: string;
}

type AdminFixtures = {
  /** A fresh OPERATOR master for the test (never the shared owner). */
  operator: MasterCredentials;
  /** A fresh verified user with a known password and its id. */
  targetUser: PanelUser;
};

/**
 * Master-panel fixtures. Every test gets its own operator and target user so
 * disable/lockout/TOTP/allowlist side effects never leak into another test.
 * The shared owner API context (`admin`) is used only for setup and reads.
 */
export const test = boardTest.extend<AdminFixtures>({
  operator: async ({ admin }, use) => {
    await use(await createMasterViaAdmin(admin, "OPERATOR"));
  },
  targetUser: async ({ admin }, use) => {
    const email = `panel-target-${randomUUID()}@e2e.example`;
    const user = await createUserViaAdmin(admin, {
      email,
      verified: true,
      password,
    });
    await use({ id: user.id, email, password });
  },
});

export { expect };

/** An isolated browser context with its own forwarded address. */
export async function adminContext(
  browser: Browser,
  ip: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": ip },
    locale: "en-US",
  });
  const page = await context.newPage();
  return { context, page };
}

/** Log a master in over the API and return an authorized request context. */
export async function loginMasterApi(
  playwright: PlaywrightApi,
  credentials: Pick<MasterCredentials, "email" | "password">,
  ip: string,
): Promise<APIRequestContext> {
  const client = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  let accessToken: string;
  try {
    const response = await client.post("/api/v1/admin/auth/login", {
      data: credentials,
    });
    expect(
      response.ok(),
      `master login: ${response.status()} ${await response.text()}`,
    ).toBeTruthy();
    ({ accessToken } = (await response.json()) as { accessToken: string });
  } finally {
    await client.dispose();
  }
  return playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: {
      "X-Forwarded-For": ip,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/** The owner API context is fixture-managed; this is for the fixture itself. */
export function ownerLoginApi(
  playwright: PlaywrightApi,
  ip: string,
): Promise<APIRequestContext> {
  return loginMasterApi(
    playwright,
    {
      email: process.env.E2E_MASTER_EMAIL ?? "master@e2e.example",
      password: process.env.E2E_MASTER_PASSWORD ?? "e2e-master-password",
    },
    ip,
  );
}
