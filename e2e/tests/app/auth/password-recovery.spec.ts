import { randomUUID } from "node:crypto";
import { test, expect, login } from "../../../fixtures/auth.js";
import { waitForRecoveryCode } from "../../../helpers/mail.js";
import { appUrl } from "../../../helpers/urls.js";

async function requestRecovery(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.goto(appUrl);
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("recovery-email").fill(email);
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByTestId("recovery-code")).toBeVisible();
}

async function fillReset(page: import("@playwright/test").Page, code: string) {
  await page.getByTestId("recovery-code").fill(code);
  await page.getByTestId("recovery-password").fill("new-password-123");
  await page.getByTestId("recovery-confirm").fill("new-password-123");
  await page.getByTestId("recovery-submit").click();
}

test("recover a password using the emailed code", async ({
  page,
  request,
  createUser,
}) => {
  const user = await createUser();
  await requestRecovery(page, user.email);
  const code = await waitForRecoveryCode(request, user.email);
  await fillReset(page, code);
  await expect(page.getByText("Password updated")).toBeVisible();
  await page.getByTestId("recovery-back").click();
  await login(page, { ...user, password: "new-password-123" });
  await expect(page.getByTestId("account-trigger")).toBeVisible();
});

test("show the same response for an unknown email", async ({ page }) => {
  await requestRecovery(page, `unknown-${randomUUID()}@e2e.example`);
  await expect(page.getByText(/If an eligible account exists/)).toBeVisible();
});

test("reject an incorrect recovery code", async ({ page, createUser }) => {
  const user = await createUser();
  await requestRecovery(page, user.email);
  await fillReset(page, "a".repeat(32));
  await expect(page.getByTestId("recovery-error")).toContainText(
    "Invalid or expired",
  );
});

test("reject mismatched new passwords", async ({ page, createUser }) => {
  const user = await createUser();
  await requestRecovery(page, user.email);
  await page.getByTestId("recovery-code").fill("a".repeat(32));
  await page.getByTestId("recovery-password").fill("new-password-123");
  await page.getByTestId("recovery-confirm").fill("different-password");
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Passwords do not match.",
  );
});

test("show an inline error when the recovery email is missing", async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Enter your email address.",
  );
  await expect(page.getByTestId("recovery-email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("show an inline error for a malformed recovery email", async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("recovery-email").fill("not-an-email");
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Enter a valid email address.",
  );
});

test("show a recovery-specific error when the server request fails", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/password/reset/request", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "Not Found" }),
    }),
  );
  await page.goto(appUrl);
  await page.getByTestId("forgot-password").click();
  await page.getByTestId("recovery-email").fill("user@example.com");
  await page.getByTestId("recovery-submit").click();
  await expect(page.getByTestId("recovery-error")).toHaveText(
    "Could not recover your password — please try again.",
  );
});
