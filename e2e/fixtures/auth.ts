import { randomBytes, randomUUID } from "node:crypto";
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { appUrl, siteUrl } from "../helpers/urls.js";

export const password = "e2e-password-123";
type User = { email: string; password: string };
type Fixtures = {
  testIp: string;
  admin: APIRequestContext;
  createUser: (verified?: boolean) => Promise<User>;
};

export const test = base.extend<Fixtures>({
  testIp: async ({}, use) => {
    const bytes = randomBytes(3);
    await use(`10.${bytes[0]}.${bytes[1]}.${bytes[2]}`);
  },
  extraHTTPHeaders: async ({ testIp }, use) => {
    await use({ "X-Forwarded-For": testIp });
  },
  admin: async ({ playwright, testIp }, use) => {
    const request = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    const response = await request.post("/api/v1/admin/auth/login", {
      data: {
        email: process.env.E2E_MASTER_EMAIL,
        password: process.env.E2E_MASTER_PASSWORD,
      },
    });
    expect(response.ok()).toBe(true);
    const { accessToken } = (await response.json()) as { accessToken: string };
    await request.dispose();
    const authorized = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": testIp,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    await use(authorized);
    await authorized.dispose();
  },
  createUser: async ({ admin }, use) => {
    await use(async (verified = true) => {
      const email = `auth-${randomUUID()}@e2e.example`;
      const created = await admin.post("/api/v1/admin/users", {
        data: { email, password },
      });
      expect(created.ok()).toBe(true);
      const { user } = (await created.json()) as { user: { id: string } };
      const configured = verified
        ? await admin.patch(`/api/v1/admin/users/${user.id}`, {
            data: { emailVerified: true },
          })
        : await admin.post(
            `/api/v1/admin/users/${user.id}/verification/resend`,
          );
      expect(configured.ok()).toBe(true);
      return { email, password };
    });
  },
});

export { expect };
export async function login(page: Page, user: User) {
  await page.goto(appUrl);
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
}
export async function enterCode(page: Page, code: string) {
  const inputs = page.getByTestId("email-verify-code").locator("input");
  for (let i = 0; i < code.length; i++) await inputs.nth(i).fill(code[i]);
  await page.getByTestId("email-verify-verify").click();
}
