import { test, expect } from "@/fixtures/admin.js";
import { siteUrl } from "@/helpers/urls.js";
import {
  adminPath,
  createMasterViaAdmin,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  setMasterAllowlist,
} from "@/helpers/admin.js";

/** Security page (TASK-162.15 full): suspicious activity and self-lock guard. */

test("S21: security alerts group failed logins, lockouts and IP denials", async ({
  page,
  admin,
  playwright,
  testIp,
}) => {
  const operator = await createMasterViaAdmin(admin);
  const request = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { "X-Forwarded-For": testIp },
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post("/api/v1/admin/auth/login", {
        data: { email: operator.email, password: "wrong-password" },
      });
      expect(response.status()).toBe(401);
    }
  } finally {
    await request.dispose();
  }

  await setMasterAllowlist(admin, operator.id, "203.0.113.44");
  try {
    const denied = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": testIp },
    });
    try {
      const response = await denied.post("/api/v1/admin/auth/login", {
        data: operator,
      });
      expect(response.status()).toBe(403);
    } finally {
      await denied.dispose();
    }
  } finally {
    await setMasterAllowlist(admin, operator.id, null);
  }

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  const alerts = page.getByTestId("admin-security-alerts");
  await expect(alerts).toContainText(operator.email);
  await expect(alerts).toContainText("Wrong password");
  await expect(alerts).toContainText(testIp);
  await expect(alerts).toContainText("Sign-in");
  await expect(alerts).toContainText("IP address not allowed");
  await expect(alerts).toContainText("Occurrences");
});

test("S22: an allowlist that excludes the current address is refused", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-ip-allowlist").fill("203.0.113.0/24");
  await page.getByTestId("admin-ip-save").click();
  await expectToast(page, "must include your current address");

  const security = await admin.get("/api/v1/admin/security");
  expect(security.ok()).toBeTruthy();
  const body = (await security.json()) as { ipAllowlist: string | null };
  expect(body.ipAllowlist).toBeNull();
});
