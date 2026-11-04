import { randomUUID } from "node:crypto";
import { test, expect } from "../../../fixtures/auth.js";
import { siteUrl } from "../../../helpers/urls.js";

async function expectAudit(
  admin: import("@playwright/test").APIRequestContext,
  action: string,
  ip: string,
) {
  await expect
    .poll(async () => {
      const response = await admin.get(`/api/v1/admin/audit?search=${action}`);
      const body = (await response.json()) as {
        items: Array<{ action: string; details: { ip: string } }>;
      };
      return body.items.some(
        (row) => row.action === action && row.details.ip === ip,
      );
    })
    .toBe(true);
}

test("record recovery requests in the admin audit", async ({
  request,
  admin,
  testIp,
}) => {
  const response = await request.post(
    new URL("api/v1/auth/password/reset/request", siteUrl).href,
    { data: { email: `unknown-${randomUUID()}@example.com` } },
  );
  expect(response.status()).toBe(200);
  await expectAudit(admin, "user.password_reset_requested", testIp);
});

test("record failed recovery confirmations without secrets", async ({
  request,
  admin,
  testIp,
}) => {
  const response = await request.post(
    new URL("api/v1/auth/password/reset/confirm", siteUrl).href,
    {
      data: {
        email: `unknown-${randomUUID()}@example.com`,
        code: "a".repeat(32),
        newPassword: "secret-password-123",
      },
    },
  );
  expect(response.status()).toBe(400);
  await expectAudit(admin, "user.password_reset_failed", testIp);
  const audit = await admin.get(
    "/api/v1/admin/audit?search=user.password_reset_failed",
  );
  const text = await audit.text();
  expect(text).not.toContain("secret-password-123");
  expect(text).not.toContain("a".repeat(32));
});

test("record recovery rate-limit violations", async ({
  request,
  admin,
  testIp,
}) => {
  for (let i = 0; i < 4; i++) {
    const response = await request.post(
      new URL("api/v1/auth/password/reset/request", siteUrl).href,
      { data: { email: `unknown-${randomUUID()}@example.com` } },
    );
    expect(response.status()).toBe(i < 3 ? 200 : 429);
  }
  await expectAudit(admin, "user.password_reset_rate_limited", testIp);
});

test("record per-account recovery limits", async ({
  request,
  admin,
  testIp,
  createUser,
}) => {
  const user = await createUser();
  for (let i = 0; i < 2; i++) {
    const response = await request.post(
      new URL("api/v1/auth/password/reset/request", siteUrl).href,
      { data: { email: user.email } },
    );
    expect(response.status()).toBe(200);
  }
  await expectAudit(admin, "user.password_reset_account_limited", testIp);
});

test("record successful password recovery", async ({
  request,
  admin,
  testIp,
  createUser,
}) => {
  const user = await createUser();
  const requested = await request.post(
    new URL("api/v1/auth/password/reset/request", siteUrl).href,
    { data: { email: user.email } },
  );
  expect(requested.status()).toBe(200);
  const { waitForRecoveryCode } = await import("../../../helpers/mail.js");
  const code = await waitForRecoveryCode(request, user.email);
  const confirmed = await request.post(
    new URL("api/v1/auth/password/reset/confirm", siteUrl).href,
    { data: { email: user.email, code, newPassword: "new-password-123" } },
  );
  expect(confirmed.status()).toBe(200);
  await expectAudit(admin, "user.password_reset_completed", testIp);
});
