import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  adminContext,
  loginMasterApi,
} from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import { appUrl, siteUrl } from "@/helpers/urls.js";
import {
  adminPath,
  confirmAction,
  createMasterViaAdmin,
  expectAudit,
  expectToast,
  loginAsMaster,
  openAdminLogin,
  ownerCredentials,
  readMaster,
  setMasterAllowlist,
  submitAdminLogin,
  uniqueEmail,
} from "@/helpers/admin.js";
import { totp, totpCodeAfter, totpStep } from "@/helpers/totp.js";

/**
 * Auth and security (TASK-162.15 full): lockout/unlock, the master-only login
 * screen, TOTP enrollment/replay/disable, IP allowlists at login and per
 * request, login throttling, and admin/user session isolation.
 */

async function enableTotp(
  playwright: Parameters<typeof loginMasterApi>[0],
  operator: { email: string; password: string },
  ip: string,
): Promise<{
  api: Awaited<ReturnType<typeof loginMasterApi>>;
  secret: string;
  step: number;
}> {
  const api = await loginMasterApi(playwright, operator, ip);
  const setup = await api.post("/api/v1/admin/security/totp", { data: {} });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const { secret } = (await setup.json()) as { secret: string };
  const step = totpStep();
  const confirmed = await api.post("/api/v1/admin/security/totp/verify", {
    data: { code: totp(secret, step * 30_000) },
  });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  return { api, secret, step };
}

test("ADM-X1: a disabled master sees its own message, not generic invalid", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  const disabled = await admin.patch(`/api/v1/admin/admins/${operator.id}`, {
    data: { disabled: true },
  });
  expect(disabled.ok(), await disabled.text()).toBeTruthy();

  await openAdminLogin(page);
  await submitAdminLogin(page, operator);
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "This master account is disabled — contact an owner.",
  );
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
});

test("A5: five wrong passwords lock the master and the owner unlocks it", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await openAdminLogin(page);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitAdminLogin(page, {
      email: operator.email,
      password: `wrong-${attempt}-${randomUUID()}`,
    });
    await expect(page.getByTestId("admin-login-error")).toHaveText(
      "Invalid credentials",
    );
  }
  await submitAdminLogin(page, operator);
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Account is temporarily locked",
  );
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await page.getByTestId(`admin-master-menu-${operator.email}`).click();
  await page.getByTestId(`admin-master-unlock-${operator.email}`).click();
  await confirmAction(page);
  await expectToast(page, `${operator.email} unlocked`);

  await page.getByTestId("admin-logout").click();
  await loginAsMaster(page, operator);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await expectAudit(admin, {
    action: "admin.unlock",
    targetId: operator.id,
  });
  const row = await readMaster(admin, operator.id);
  expect(row.lockedUntil).toBeNull();
  expect(row.failedLogins).toBe(0);
});

test("A6: the master login offers no registration, recovery or social entry", async ({
  page,
}) => {
  await openAdminLogin(page);

  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(page.getByTestId("login-toggle")).toHaveCount(0);
  await expect(page.getByTestId("forgot-password")).toHaveCount(0);
  await expect(page.getByTestId("login-oauth-google")).toHaveCount(0);
  await expect(page.getByTestId("login-oauth-yandex")).toHaveCount(0);
  await expect(
    page.getByText(
      "Master accounts are created on the server via the admin CLI.",
    ),
  ).toBeVisible();
});

test("A7: TOTP enrollment shows a secret, confirms a code and turns 2FA on", async ({
  page,
  admin,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-totp-status")).toHaveText("off");
  await page.getByTestId("admin-totp-enable").click();

  const secret = page.getByTestId("admin-totp-secret");
  await expect(secret).not.toBeEmpty();
  const secretValue = (await secret.textContent())?.trim() ?? "";
  expect(secretValue).toMatch(/^[A-Z2-7]{16,}$/);

  await page.getByTestId("admin-totp-code").fill(totp(secretValue));
  await page.getByTestId("admin-totp-confirm").click();
  await expect(page.getByTestId("admin-totp-status")).toHaveText("on");

  await expectAudit(admin, {
    action: "security.totp_enabled",
    targetId: operator.id,
  });
});

test("A8: TOTP login rejects a wrong code and accepts the next one", async ({
  page,
  admin,
  operator,
  playwright,
  testIp,
}) => {
  const { api, secret, step } = await enableTotp(playwright, operator, testIp);
  await api.dispose();

  await openAdminLogin(page);
  await submitAdminLogin(page, operator);
  const codeInput = page.getByTestId("admin-login-totp");
  await expect(codeInput).toBeVisible();
  await codeInput.fill("000000");
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Invalid two-factor code",
  );

  const next = await totpCodeAfter(secret, step);
  await codeInput.fill(next.code);
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await expectAudit(admin, {
    action: "admin.login",
    adminEmail: operator.email,
  });
});

test("A9: a used TOTP code cannot be replayed", async ({
  page,
  admin,
  operator,
  playwright,
  testIp,
}) => {
  test.slow();
  const { api, secret, step } = await enableTotp(playwright, operator, testIp);
  await api.dispose();
  const used = await totpCodeAfter(secret, step);

  await loginAsMasterWithTotp(page, operator, used.code);
  await page.getByTestId("admin-logout").click();
  await expect(page.getByTestId("admin-login-form")).toBeVisible();

  await submitAdminLogin(page, operator);
  await page.getByTestId("admin-login-totp").fill(used.code);
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Invalid two-factor code",
  );

  const next = await totpCodeAfter(secret, used.step);
  await page.getByTestId("admin-login-totp").fill(next.code);
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await expectAudit(admin, {
    action: "admin.login",
    adminEmail: operator.email,
  });
});

test("A10: disabling TOTP needs a fresh code and restores password-only login", async ({
  page,
  admin,
  operator,
  playwright,
  testIp,
}) => {
  test.slow();
  const { api, secret, step } = await enableTotp(playwright, operator, testIp);
  await api.dispose();

  const login = await totpCodeAfter(secret, step);
  await loginAsMasterWithTotp(page, operator, login.code);
  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-totp-status")).toHaveText("on");

  const disable = await totpCodeAfter(secret, login.step);
  await page.getByTestId("admin-totp-code").fill(disable.code);
  await page.getByTestId("admin-totp-disable").click();
  await expect(page.getByTestId("admin-totp-status")).toHaveText("off");

  await page.getByTestId("admin-logout").click();
  await loginAsMaster(page, operator);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
  await expect(page.getByTestId("admin-login-totp")).toHaveCount(0);

  await expectAudit(admin, {
    action: "security.totp_disabled",
    targetId: operator.id,
  });
});

test("A11: a login from outside the IP allowlist is refused", async ({
  page,
  admin,
  operator,
}) => {
  await setMasterAllowlist(admin, operator.id, "203.0.113.250");
  try {
    await openAdminLogin(page);
    await submitAdminLogin(page, operator);
    await expect(page.getByTestId("admin-login-error")).toContainText(
      "Sign-in from this IP address is not allowed",
    );
    await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
  } finally {
    await setMasterAllowlist(admin, operator.id, null);
  }

  await submitAdminLogin(page, operator);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await expectAudit(admin, {
    action: "security.ip_allowlist_changed",
    targetId: operator.id,
  });
});

test("A12: the IP allowlist is enforced on every request, not just login", async ({
  page,
  admin,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await setMasterAllowlist(admin, operator.id, "203.0.113.250");
  try {
    const forbidden = page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/api/v1/admin/entities/users") &&
        candidate.status() === 403,
    );
    await page
      .getByTestId("admin-sidebar")
      .getByRole("link", { name: "Users", exact: true })
      .click();
    await forbidden;
    await expect(page.getByText("Could not load the data")).toBeVisible();
  } finally {
    await setMasterAllowlist(admin, operator.id, null);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();

  await expectAudit(admin, {
    action: "admin.login_failed",
    adminEmail: operator.email,
    detailsText: "ip_not_allowed",
  });
});

test("A13: the 11th login attempt in a minute is throttled", async ({
  browser,
  playwright,
}) => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const request = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request.post("/api/v1/admin/auth/login", {
        data: {
          email: uniqueEmail("throttle-missing"),
          password: "not-a-real-password",
        },
      });
      expect(response.status()).toBe(401);
    }
  } finally {
    await request.dispose();
  }

  const { context, page } = await adminContext(browser, ip);
  try {
    await openAdminLogin(page);
    await submitAdminLogin(page, {
      email: uniqueEmail("throttle-form"),
      password: "not-a-real-password",
    });
    await expect(page.getByTestId("admin-login-error")).toHaveText(
      "Account is temporarily locked",
    );
    await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("A14: admin and user sessions are isolated", async ({
  browser,
  page,
  targetUser,
  testIp,
}) => {
  const userContext = await adminContext(browser, testIp);
  const adminSide = await adminContext(browser, testIp);
  try {
    await login(userContext.page, targetUser);
    await expect(userContext.page.getByTestId("account-trigger")).toBeVisible();

    await loginAsMaster(adminSide.page, ownerCredentials());
    await expect(adminSide.page.getByTestId("admin-sidebar")).toBeVisible();

    await adminSide.page.getByTestId("admin-logout").click();
    await expect(adminSide.page.getByTestId("admin-login-form")).toBeVisible();
    await expect(userContext.page.getByTestId("account-trigger")).toBeVisible();

    await userContext.page.getByTestId("account-trigger").click();
    await userContext.page.getByTestId("account-logout").click();
    await userContext.page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(userContext.page.getByTestId("login-email")).toBeVisible();

    await adminSide.page
      .getByTestId("admin-login-email")
      .fill(ownerCredentials().email);
    await adminSide.page
      .getByTestId("admin-login-password")
      .fill(ownerCredentials().password);
    await adminSide.page.getByTestId("admin-login-submit").click();
    await expect(adminSide.page.getByTestId("admin-sidebar")).toBeVisible();

    await userContext.page.goto(adminPath(), {
      waitUntil: "domcontentloaded",
    });
    await expect(
      userContext.page.getByTestId("admin-login-form"),
    ).toBeVisible();
  } finally {
    await userContext.context.close();
    await adminSide.context.close();
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  }
});

async function loginAsMasterWithTotp(
  page: import("@playwright/test").Page,
  credentials: { email: string; password: string },
  code: string,
): Promise<void> {
  await openAdminLogin(page);
  await submitAdminLogin(page, credentials);
  await page.getByTestId("admin-login-totp").fill(code);
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
}
