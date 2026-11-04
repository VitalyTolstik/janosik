import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { appUrl } from "../../../helpers/urls.js";
import { waitForCodes } from "../../../helpers/mail.js";

test("registration rejects missing, malformed and short credentials", async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  const email = page.getByTestId("login-email");
  const password = page.getByTestId("login-password");
  await page.getByTestId("login-submit").click();
  expect(
    await email.evaluate(
      (element: HTMLInputElement) => element.validity.valueMissing,
    ),
  ).toBe(true);
  await email.fill("not-an-email");
  await password.fill("valid-password");
  await page.getByTestId("login-submit").click();
  expect(
    await email.evaluate(
      (element: HTMLInputElement) => element.validity.typeMismatch,
    ),
  ).toBe(true);
  await email.fill(`validation-${randomUUID()}@e2e.example`);
  await password.fill("");
  await page.getByTestId("login-submit").click();
  expect(
    await password.evaluate(
      (element: HTMLInputElement) => element.validity.valueMissing,
    ),
  ).toBe(true);
  await password.fill("short");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "Check the entered data (password must be at least 8 characters)",
  );
  await expect(page.getByTestId("login-email")).toBeVisible();
});

test("resending invalidates the previous confirmation code", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.clock.install();
  const email = `resend-${randomUUID()}@e2e.example`;
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("e2e-password-123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  const [original] = await waitForCodes(request, email, 1);
  const resend = page.getByTestId("email-verify-resend");
  await expect(resend).toBeDisabled();
  let latest = original;
  for (let count = 2; count <= 4 && latest === original; count++) {
    await page.clock.runFor("01:00");
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(resend).toBeDisabled();
    const codes = await waitForCodes(request, email, count);
    latest = codes[0];
  }
  expect(latest).not.toBe(original);
  const inputs = page.getByTestId("email-verify-code").locator("input");
  for (let i = 0; i < original.length; i++)
    await inputs.nth(i).fill(original[i]);
  await page.getByTestId("email-verify-verify").click();
  await expect(page.getByTestId("email-verify-error")).toHaveText(
    "Invalid verification code",
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
  for (let i = 0; i < latest.length; i++) await inputs.nth(i).fill(latest[i]);
  await page.getByTestId("email-verify-verify").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});
