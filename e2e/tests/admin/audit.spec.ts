import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  createMasterViaAdmin,
  createUserViaAdmin,
  expectAudit,
  loginAsMaster,
  openAdminLogin,
  ownerCredentials,
  searchAdminList,
  submitAdminLogin,
  uniqueToken,
} from "@/helpers/admin.js";
import { seedRichCard } from "@/helpers/admin-content.js";

/**
 * Audit and security events (TASK-162.15 full): successful/failed sign-ins,
 * user moderation, period/search/target/detail rendering, the master link,
 * impersonation and the mutation-family matrix.
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

test("F1: audit period tabs, target search and JSON details", async ({
  page,
  admin,
}) => {
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
    .filter({ hasText: "user.disable" })
    .filter({ has: page.getByTestId(`admin-id-${user.id}`) });
  await expect(row).toContainText("user");
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toContainText(user.email);

  await page.getByRole("button", { name: "24 hours", exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(row).toBeVisible();
});

test("F2: an audit master link opens Masters and survives master deletion", async ({
  page,
  admin,
}) => {
  const master = await createMasterViaAdmin(admin);
  await loginAsMaster(page, master);
  await page.getByTestId("admin-logout").click();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", master.email);
  const row = page
    .getByRole("row")
    .filter({ hasText: master.email })
    .filter({ hasText: "admin.login" });
  const link = row.getByRole("link", { name: master.email, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/admin\/masters$/);

  const removed = await admin.delete(`/api/v1/admin/admins/${master.id}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", master.email);
  const kept = page
    .getByRole("row")
    .filter({ hasText: master.email })
    .filter({ hasText: "admin.login" });
  await expect(kept).toContainText(master.email);
  await expect(kept.getByTestId(`admin-copy-${master.email}`)).toBeVisible();
  await expect(
    kept.getByRole("link", { name: master.email, exact: true }),
  ).toHaveCount(0);
});

test("F3: impersonation is recorded with master and target", async ({
  page,
  admin,
  targetUser,
}) => {
  const board = await admin.post("/api/v1/admin/boards", {
    data: {
      title: uniqueToken("audit-impersonation"),
      ownerEmail: targetUser.email,
    },
  });
  expect(board.ok(), await board.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${targetUser.id}`), {
    waitUntil: "domcontentloaded",
  });

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-impersonate").click();
  const popup = await popupPromise;
  await popup.close();

  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", targetUser.id);
  const row = page
    .getByRole("row")
    .filter({ hasText: "user.impersonated" })
    .filter({ has: page.getByTestId(`admin-id-${targetUser.id}`) });
  await expect(row).toContainText(ownerCredentials().email);
  await row.locator("button[aria-expanded]").click();
  await expect(row.locator("pre")).toBeVisible();
});

test("ADM-X7: each mutation family writes its own audit action", async ({
  page,
  admin,
  board,
}) => {
  const verified = await createUserViaAdmin(admin, { verified: false });
  await admin.patch(`/api/v1/admin/users/${verified.id}`, {
    data: { emailVerified: true },
  });
  await admin.post(`/api/v1/admin/users/${verified.id}/password/reset`, {
    data: {},
  });
  const seed = await seedRichCard(board);
  await admin.delete(`/api/v1/admin/attachments/${seed.attachmentId}`);
  const announcementTitle = uniqueToken("audit-family");
  const announcement = await admin.post("/api/v1/admin/announcements", {
    data: {
      title: announcementTitle,
      body: `Body ${announcementTitle}`,
      level: "info",
      audience: "segment",
      segment: "nobody@e2e.example",
      sendEmail: false,
    },
  });
  const announcementBody = (await announcement.json()) as { id: string };
  const share = await board.api.post(`/api/v1/boards/${board.id}/shares`, {
    data: { mode: "live" },
  });
  const shareBody = (await share.json()) as { id: string };
  await admin.post(`/api/v1/admin/shares/${shareBody.id}/revoke`, {
    data: {},
  });

  for (const expectation of [
    { action: "user.verified", targetId: verified.id },
    { action: "user.password_reset", targetId: verified.id },
    { action: "attachment.delete", targetId: seed.attachmentId },
    { action: "announcement.created", targetId: announcementBody.id },
    { action: "share.revoked", targetId: shareBody.id },
  ]) {
    await expectAudit(admin, expectation);
  }

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("audit"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "audit", seed.attachmentId);
  await expect(
    page.getByRole("row").filter({ hasText: "attachment.delete" }),
  ).toContainText("attachment");
});
