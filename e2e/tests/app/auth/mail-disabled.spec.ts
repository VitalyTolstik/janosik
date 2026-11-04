import { randomUUID } from "node:crypto";
import { test, expect, login, password } from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";

test.describe.configure({ mode: "default" });

test("register when the administrator disables email", async ({
  page,
  admin,
}) => {
  const settings = await admin.put("/api/v1/admin/email-settings", {
    data: { provider: "mailpit", from: "", username: "", enabled: false },
  });
  expect(settings.ok()).toBe(true);
  expect((await settings.json()).active).toBe(false);
  const email = `no-mail-${randomUUID()}@e2e.example`;
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expect(page.getByTestId("email-verify-code")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("hide registration while existing users can sign in", async ({
  page,
  admin,
  createUser,
}) => {
  const user = await createUser();
  const flag = await admin.patch("/api/v1/admin/flags/registration_open", {
    data: { enabled: false },
  });
  expect(flag.ok()).toBe(true);
  const configResponse = page.waitForResponse(
    (response) => response.url().includes("/auth/config") && response.ok(),
  );
  await page.goto(`${appUrl}?mode=register`);
  await configResponse;
  await expect(page.getByTestId("login-toggle")).toHaveCount(0);
  await expect(page.getByTestId("login-display-name")).toHaveCount(0);
  await login(page, user);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});
