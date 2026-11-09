import { test, expect } from "@/fixtures/account.js";
import { login } from "@/fixtures/auth.js";
import { newSession, tokenRequest } from "@/helpers/account.js";
import { waitForRecoveryCode } from "@/helpers/mail.js";
import { appUrl } from "@/helpers/urls.js";

const NEW_PASSWORD = "recovered-password-123";

test("a password reset revokes other sessions and API keys", async ({
  page,
  browser,
  request,
  playwright,
  testIp,
  account,
}) => {
  const other = await newSession(browser, account.user, testIp);
  const pat = await account.createToken("Reset revokes this");
  const client = await tokenRequest(playwright, pat.token, testIp);
  try {
    const before = await client.get("/api/v1/boards");
    expect(before.status()).toBe(200);

    await page.goto(appUrl);
    await page.getByTestId("forgot-password").click();
    await page.getByTestId("recovery-email").fill(account.user.email);
    await page.getByTestId("recovery-submit").click();
    const code = await waitForRecoveryCode(request, account.user.email);
    await page.getByTestId("recovery-code").fill(code);
    await page.getByTestId("recovery-password").fill(NEW_PASSWORD);
    await page.getByTestId("recovery-confirm").fill(NEW_PASSWORD);
    await page.getByTestId("recovery-submit").click();
    await expect(page.getByText("Password updated")).toBeVisible();

    // Both promises the reset makes to the user: other browsers are signed
    // out, and every personal API key stops authenticating.
    await other.page.reload();
    await expect(other.page.getByTestId("login-submit")).toBeVisible();

    const after = await client.get("/api/v1/boards");
    expect(after.status()).toBe(401);

    await page.getByTestId("recovery-back").click();
    await login(page, { ...account.user, password: NEW_PASSWORD });
    await expect(page.getByTestId("account-trigger")).toBeVisible();
  } finally {
    await client.dispose();
    await other.context.close();
  }
});
