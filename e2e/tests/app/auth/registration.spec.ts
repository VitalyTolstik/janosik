import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "../../../helpers/urls.js";
import { waitForCodes } from "../../../helpers/mail.js";

const password = "e2e-password-123";

async function register(page: Page, email: string) {
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-display-name").fill("E2E User");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("register, verify email, sign out and sign back in", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const email = `auth-${randomUUID()}@e2e.example`;
  await register(page, email);
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const [code] = await waitForCodes(request, email, 1);
  await page.getByTestId("email-verify-signout").click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("email-verify-code")).toBeVisible();

  const inputs = page.getByTestId("email-verify-code").locator("input");
  const wrongCode = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < wrongCode.length; i++)
    await inputs.nth(i).fill(wrongCode[i]);
  await page.getByTestId("email-verify-verify").click();
  await expect(page.getByTestId("email-verify-error")).toHaveText(
    "Invalid verification code",
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
  for (let i = 0; i < code.length; i++) await inputs.nth(i).fill(code[i]);
  await page.getByTestId("email-verify-verify").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await page.getByTestId("account-trigger").click();
  await page.getByTestId("account-logout").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "An account with this email already exists",
  );
  await page.getByTestId("login-toggle").click();

  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("incorrect-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "Wrong email or password",
  );
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-trigger")).toBeVisible();
  await expect(page.getByTestId("email-verify-code")).toHaveCount(0);
});
