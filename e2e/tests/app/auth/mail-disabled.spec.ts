import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, login, password } from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";

/**
 * This file flips global email and registration settings, so its tests run
 * one at a time. Every test also snapshots the setting it changes and puts
 * it back, so a re-run on a long-lived stack does not depend on test order.
 */
test.describe.configure({ mode: "serial" });

interface EmailSettings {
  provider: "custom" | "mailpit";
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  enabled: boolean;
}

async function readEmailSettings(
  admin: APIRequestContext,
): Promise<EmailSettings> {
  const response = await admin.get("/api/v1/admin/email-settings");
  expect(response.ok()).toBe(true);
  return (await response.json()) as EmailSettings;
}

async function setEmailEnabled(
  admin: APIRequestContext,
  enabled: boolean,
): Promise<void> {
  const response = await admin.put("/api/v1/admin/email-settings", {
    data: { provider: "mailpit", from: "", username: "", enabled },
  });
  expect(response.ok()).toBe(true);
  expect(((await response.json()) as { active: boolean }).active).toBe(enabled);
}

/** Put the delivery transport back the way the test found it. */
async function restoreEmailSettings(
  admin: APIRequestContext,
  snapshot: EmailSettings,
): Promise<void> {
  if (snapshot.host === "") return;
  if (snapshot.provider === "mailpit") {
    const response = await admin.put("/api/v1/admin/email-settings", {
      data: {
        provider: "mailpit",
        from: snapshot.from,
        username: snapshot.username,
        enabled: snapshot.enabled,
      },
    });
    expect(response.ok()).toBe(true);
    return;
  }
  // The env bootstrap reports `custom`; a stored custom row needs a
  // password to switch delivery on, so restore with a placeholder that the
  // disposable Mailpit accepts.
  const response = await admin.put("/api/v1/admin/email-settings", {
    data: {
      provider: "custom",
      host: snapshot.host,
      port: snapshot.port,
      secure: snapshot.secure,
      from: snapshot.from,
      username: snapshot.username === "" ? "e2e" : snapshot.username,
      password: "e2e",
      enabled: snapshot.enabled,
    },
  });
  expect(response.ok()).toBe(true);
}

test("register when the administrator disables email", async ({
  page,
  admin,
}) => {
  const before = await readEmailSettings(admin);
  try {
    await setEmailEnabled(admin, false);
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
  } finally {
    await restoreEmailSettings(admin, before);
  }
});

test("hide registration while existing users can sign in", async ({
  page,
  admin,
  createUser,
}) => {
  const user = await createUser();
  const closed = await admin.patch("/api/v1/admin/flags/registration_open", {
    data: { enabled: false },
  });
  expect(closed.ok()).toBe(true);
  try {
    const configResponse = page.waitForResponse(
      (response) => response.url().includes("/auth/config") && response.ok(),
    );
    await page.goto(`${appUrl}?mode=register`);
    await configResponse;
    await expect(page.getByTestId("login-toggle")).toHaveCount(0);
    await expect(page.getByTestId("login-display-name")).toHaveCount(0);
    await login(page, user);
    await expect(page.getByTestId("account-trigger")).toBeVisible();
  } finally {
    const reopened = await admin.patch(
      "/api/v1/admin/flags/registration_open",
      { data: { enabled: true } },
    );
    expect(reopened.ok()).toBe(true);
  }
});

test("explain when password recovery is unavailable", async ({
  page,
  admin,
}) => {
  const before = await readEmailSettings(admin);
  try {
    await setEmailEnabled(admin, false);
    await page.goto(appUrl);
    await page.getByTestId("forgot-password").click();
    await page.getByTestId("recovery-email").fill("user@example.com");
    await page.getByTestId("recovery-submit").click();
    await expect(page.getByTestId("recovery-error")).toContainText(
      "Contact your administrator",
    );
  } finally {
    await restoreEmailSettings(admin, before);
  }
});
