import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createMasterViaAdmin,
  createUserViaAdmin,
  loginAsMaster,
  openAdminLogin,
  ownerCredentials,
  searchAdminList,
  submitAdminLogin,
} from "@/helpers/admin.js";

/**
 * Audit and security events (TASK-162.15): master sign-ins, suspicious
 * failures and user moderation must be traceable in the panel. Every test
 * searches by an identifier it created itself, so parallel rows never mix.
 */

test("records a successful master sign-in in the audit trail", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", operator.email);

  const row = page
    .getByRole("row")
    .filter({ hasText: operator.email })
    .filter({ has: page.getByText("admin.login", { exact: true }) });
  await expect(row).toBeVisible();
});

test("shows a failed master sign-in in suspicious activity", async ({
  page,
  admin,
  testIp,
}) => {
  const operator = await createMasterViaAdmin(admin);

  await openAdminLogin(page);
  await submitAdminLogin(page, {
    email: operator.email,
    password: "definitely-wrong-password",
  });
  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Invalid credentials",
  );
  await submitAdminLogin(page, operator);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });

  const alerts = page.getByTestId("admin-security-alerts");
  await expect(alerts).toContainText(operator.email);
  const alert = alerts
    .getByText(operator.email, { exact: true })
    .locator("xpath=..");
  await expect(alert).toContainText("Wrong password");
  await expect(alert).toContainText(testIp);
});

test("records blocking a user in the audit trail", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const blocked = await admin.patch(`/api/v1/admin/users/${user.id}`, {
    data: { disabled: true },
  });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", user.id);

  const row = page
    .getByRole("row")
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) })
    .filter({ has: page.getByText("user.disable", { exact: true }) });
  await expect(row).toBeVisible();
});

test("records deleting a user in the audit trail", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const removed = await admin.delete(`/api/v1/admin/users/${user.id}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", user.id);

  const row = page
    .getByRole("row")
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) })
    .filter({ has: page.getByText("user.delete", { exact: true }) });
  await expect(row).toBeVisible();
});
