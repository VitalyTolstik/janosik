import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  enterCode,
  login,
  password,
} from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";
import { waitForCodes } from "../../../helpers/mail.js";

test("register and confirm an email address", async ({ page, request }) => {
  const email = `register-${randomUUID()}@e2e.example`;
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-display-name").fill("E2E User");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  const [code] = await waitForCodes(request, email, 1);
  await enterCode(page, code);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("reject a registered email address", async ({ page, createUser }) => {
  const user = await createUser();
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(user.email);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "An account with this email already exists",
  );
});

test("reject an incorrect confirmation code", async ({
  page,
  request,
  createUser,
}) => {
  const user = await createUser(false);
  const [code] = await waitForCodes(request, user.email, 1);
  await login(page, user);
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  await enterCode(page, code === "000000" ? "000001" : "000000");
  await expect(page.getByTestId("email-verify-error")).toHaveText(
    "Invalid verification code",
  );
  await expect(page.getByTestId("account-trigger")).toHaveCount(0);
  await enterCode(page, code);
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("return to email confirmation after signing out before verification", async ({
  page,
  createUser,
}) => {
  const user = await createUser(false);
  await login(page, user);
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  await page.getByTestId("email-verify-signout").click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await login(page, user);
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
});
