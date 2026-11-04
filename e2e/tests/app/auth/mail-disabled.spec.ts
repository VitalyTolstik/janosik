import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { appUrl, siteUrl } from "../../../helpers/urls.js";

test("registration without email and sign-in with registration disabled", async ({
  page,
  request,
}) => {
  const email = `no-mail-${randomUUID()}@e2e.example`;
  const login = await request.post(
    new URL("api/v1/admin/auth/login", siteUrl).href,
    {
      data: {
        email: process.env.E2E_MASTER_EMAIL,
        password: process.env.E2E_MASTER_PASSWORD,
      },
    },
  );
  expect(login.ok()).toBe(true);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const settings = await request.put(
    new URL("api/v1/admin/email-settings", siteUrl).href,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { provider: "mailpit", from: "", username: "", enabled: false },
    },
  );
  expect(settings.ok()).toBe(true);
  expect((await settings.json()).active).toBe(false);

  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("e2e-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expect(page.getByTestId("email-verify-code")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();

  const flag = await request.patch(
    new URL("api/v1/admin/flags/registration_open", siteUrl).href,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { enabled: false },
    },
  );
  expect(flag.ok()).toBe(true);
  await page.getByTestId("account-trigger").click();
  await page.getByTestId("account-logout").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  const configResponse = page.waitForResponse(
    (response) => response.url().includes("/auth/config") && response.ok(),
  );
  await page.goto(`${appUrl}?mode=register`);
  await configResponse;
  await expect(page.getByTestId("login-toggle")).toHaveCount(0);
  await expect(page.getByTestId("login-display-name")).toHaveCount(0);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("e2e-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});
