import { test, expect } from "@/fixtures/account.js";
import { login } from "@/fixtures/auth.js";
import {
  fillCode,
  newEmail,
  newSession,
  openAccount,
  signOutThroughUi,
  tokenRequest,
} from "@/helpers/account.js";
import { waitForCodes } from "@/helpers/mail.js";

const NEW_PASSWORD = "new-password-123";

async function submitPassword(
  page: import("@playwright/test").Page,
  current: string,
  next: string,
  confirm = next,
): Promise<void> {
  await page.getByTestId("security-current").fill(current);
  await page.getByTestId("security-new").fill(next);
  await page.getByTestId("security-confirm").fill(confirm);
  await page.getByTestId("security-submit").click();
}

test("changing the password lets the account sign in with the new one", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "security");

  await submitPassword(page, account.user.password, NEW_PASSWORD);
  await expect(
    page.getByText(
      "Password changed — other devices were signed out and API keys revoked",
    ),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await signOutThroughUi(page);
  await login(page, { ...account.user, password: NEW_PASSWORD });
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("an incorrect current password is reported and keeps the old password", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "security");

  await submitPassword(page, "definitely-wrong", NEW_PASSWORD);

  await expect(page.getByTestId("security-error")).toHaveText(
    "Current password is incorrect",
  );
  await expect(page.getByTestId("security-current")).toHaveValue(
    "definitely-wrong",
  );

  const check = await page.request.post("/api/v1/auth/login", {
    data: { email: account.user.email, password: account.user.password },
  });
  expect(check.ok()).toBeTruthy();
});

test("a short new password is rejected before submit", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "security");

  await page.getByTestId("security-current").fill(account.user.password);
  await page.getByTestId("security-new").fill("short");
  await page.getByTestId("security-confirm").fill("short");
  await expect(page.getByTestId("security-error")).toHaveText(
    "The new password must be at least 8 characters",
  );
  await expect(page.getByTestId("security-submit")).toBeDisabled();
});

test("a mismatched confirmation is rejected before submit", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "security");

  await page.getByTestId("security-current").fill(account.user.password);
  await page.getByTestId("security-new").fill(NEW_PASSWORD);
  await page.getByTestId("security-confirm").fill("different-password");
  await expect(page.getByTestId("security-error")).toHaveText(
    "Passwords do not match",
  );
  await expect(page.getByTestId("security-submit")).toBeDisabled();
});

test("a password change signs out other browser sessions but keeps this one", async ({
  page,
  account,
  browser,
  testIp,
}) => {
  const other = await newSession(browser, account.user, testIp);
  try {
    await account.open(page);
    await openAccount(page, "security");
    await submitPassword(page, account.user.password, NEW_PASSWORD);
    await expect(
      page.getByText(
        "Password changed — other devices were signed out and API keys revoked",
      ),
    ).toBeVisible();

    await other.page.reload();
    await expect(other.page.getByTestId("login-submit")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("account-trigger")).toBeVisible();
  } finally {
    await other.context.close();
  }
});

test("a password change revokes existing API keys", async ({
  page,
  account,
  playwright,
  testIp,
}) => {
  const created = await account.createToken("Pre-rotation key");
  const client = await tokenRequest(playwright, created.token, testIp);
  try {
    const before = await client.get("/api/v1/boards");
    expect(before.status()).toBe(200);

    await account.open(page);
    await openAccount(page, "security");
    await submitPassword(page, account.user.password, NEW_PASSWORD);
    await expect(
      page.getByText(
        "Password changed — other devices were signed out and API keys revoked",
      ),
    ).toBeVisible();

    const after = await client.get("/api/v1/boards");
    expect(after.status()).toBe(401);
  } finally {
    await client.dispose();
  }
});

test("changing the email requires the code sent to the new address", async ({
  page,
  account,
  request,
}) => {
  const next = newEmail();
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("account-email-change").click();
  const change = page.getByTestId("email-change-dialog");
  await expect(change).toBeVisible();
  await change.getByTestId("email-change-new").fill(next);
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByTestId("email-change-send").click();

  const [code] = await waitForCodes(request, next, 1);
  await fillCode(page, "email-change-code", code);
  await change.getByTestId("email-change-verify").click();

  await expect(page.getByText("Email updated")).toBeVisible();
  await expect(change).toBeHidden();
  await expect(dialog.getByTestId("account-email")).toHaveValue(next);

  await page.reload();
  const reopened = await openAccount(page);
  await expect(reopened.getByTestId("account-email")).toHaveValue(next);
});

test("the email-change dialog starts clean after cancelling", async ({
  page,
  account,
}) => {
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("account-email-change").click();
  let change = page.getByTestId("email-change-dialog");
  await change.getByTestId("email-change-new").fill(newEmail("cancel"));
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(change).toBeHidden();

  await dialog.getByTestId("account-email-change").click();
  change = page.getByTestId("email-change-dialog");
  await expect(change.getByTestId("email-change-new")).toHaveValue("");
  await expect(change.getByTestId("email-change-password")).toHaveValue("");
});

test("the email-change dialog starts clean after a successful change", async ({
  page,
  account,
  request,
}) => {
  const next = newEmail("reopen");
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("account-email-change").click();
  const change = page.getByTestId("email-change-dialog");
  await change.getByTestId("email-change-new").fill(next);
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByTestId("email-change-send").click();

  const [code] = await waitForCodes(request, next, 1);
  await fillCode(page, "email-change-code", code);
  await change.getByTestId("email-change-verify").click();
  await expect(page.getByText("Email updated")).toBeVisible();
  await expect(change).toBeHidden();

  await dialog.getByTestId("account-email-change").click();
  await expect(change.getByTestId("email-change-new")).toHaveValue("");
  await expect(change.getByTestId("email-change-code")).toHaveCount(0);
});

test("an invalid email-change code is rejected", async ({
  page,
  account,
  request,
}) => {
  const next = newEmail("invalid");
  await account.open(page);
  const dialog = await openAccount(page);

  await dialog.getByTestId("account-email-change").click();
  const change = page.getByTestId("email-change-dialog");
  await change.getByTestId("email-change-new").fill(next);
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByTestId("email-change-send").click();
  await waitForCodes(request, next, 1);

  await fillCode(page, "email-change-code", "000000");
  await change.getByTestId("email-change-verify").click();

  await expect(change.getByTestId("email-change-error")).toHaveText(
    "Invalid or expired code",
  );
  await expect(change).toBeVisible();
});

test("an email change signs out other browser sessions", async ({
  page,
  account,
  browser,
  request,
  testIp,
}) => {
  const next = newEmail("session");
  const other = await newSession(browser, account.user, testIp);
  try {
    await account.open(page);
    const dialog = await openAccount(page);
    await dialog.getByTestId("account-email-change").click();
    const change = page.getByTestId("email-change-dialog");
    await change.getByTestId("email-change-new").fill(next);
    await change
      .getByTestId("email-change-password")
      .fill(account.user.password);
    await change.getByTestId("email-change-send").click();

    const [code] = await waitForCodes(request, next, 1);
    await fillCode(page, "email-change-code", code);
    await change.getByTestId("email-change-verify").click();
    await expect(page.getByText("Email updated")).toBeVisible();

    await other.page.reload();
    await expect(other.page.getByTestId("login-submit")).toBeVisible();
  } finally {
    await other.context.close();
  }
});
