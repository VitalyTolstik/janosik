import { randomUUID } from "node:crypto";
import { test, expect, enterCode, login } from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";
import { waitForCodes } from "../../../helpers/mail.js";

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
});

test("require an email address", async ({ page }) => {
  await page.getByTestId("login-submit").click();
  expect(
    await page
      .getByTestId("login-email")
      .evaluate((el: HTMLInputElement) => el.validity.valueMissing),
  ).toBe(true);
});

test("reject a malformed email address", async ({ page }) => {
  const email = page.getByTestId("login-email");
  await email.fill("not-an-email");
  await page.getByTestId("login-password").fill("valid-password");
  await page.getByTestId("login-submit").click();
  expect(
    await email.evaluate((el: HTMLInputElement) => el.validity.typeMismatch),
  ).toBe(true);
});

test("require a password", async ({ page }) => {
  await page
    .getByTestId("login-email")
    .fill(`validation-${randomUUID()}@e2e.example`);
  await page.getByTestId("login-submit").click();
  expect(
    await page
      .getByTestId("login-password")
      .evaluate((el: HTMLInputElement) => el.validity.valueMissing),
  ).toBe(true);
});

test("reject a password shorter than eight characters", async ({ page }) => {
  await page
    .getByTestId("login-email")
    .fill(`validation-${randomUUID()}@e2e.example`);
  await page.getByTestId("login-password").fill("short");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "Check the entered data (password must be at least 8 characters)",
  );
});

test("resending invalidates the previous confirmation code", async ({
  page,
  request,
  createUser,
}) => {
  test.setTimeout(90_000);
  await page.clock.install();
  const user = await createUser(false);
  const [original] = await waitForCodes(request, user.email, 1);
  await login(page, user);
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  const resend = page.getByTestId("email-verify-resend");
  await expect(resend).toBeDisabled();
  let latest = original;
  for (let count = 2; count <= 4 && latest === original; count++) {
    await page.clock.runFor("01:00");
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(resend).toBeDisabled();
    const codes = await waitForCodes(request, user.email, count);
    latest = codes[0];
  }
  expect(latest).not.toBe(original);
  await enterCode(page, original);
  await expect(page.getByTestId("email-verify-error")).toHaveText(
    "Invalid verification code",
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
  await enterCode(page, latest);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});
