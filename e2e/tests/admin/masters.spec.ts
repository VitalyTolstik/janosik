import { test, expect, adminContext } from "@/fixtures/admin.js";
import { login } from "@/fixtures/auth.js";
import {
  adminPath,
  confirmAction,
  createMasterViaAdmin,
  createUserViaAdmin,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  readMaster,
  uniqueEmail,
} from "@/helpers/admin.js";

/**
 * Masters roster (TASK-162.15 full): list state, OWNER creation, duplicate
 * errors, disable/enable, password reset, session revocation, removal that
 * leaves the same-email user intact, and the self/last-owner guards.
 */

test("MST-1: master list shows roles, failures, last login and status", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });

  const owner = page
    .getByRole("row")
    .filter({ hasText: ownerCredentials().email });
  await expect(owner).toContainText("Owner");
  await expect(owner).toContainText("Active");

  const row = page.getByRole("row").filter({ hasText: operator.email });
  await expect(row).toContainText("Operator");
  await expect(row).toContainText("Active");
  await expect(row).toContainText(/\d/);
  await expect(row).toContainText(/never|\d/);
});

test("MST-2: creating an OWNER master with the checkbox grants the tier", async ({
  browser,
  page,
  admin,
  testIp,
}) => {
  const email = uniqueEmail("owner-created");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-master").click();
  await page.getByTestId("admin-master-email").fill(email);
  await page.getByTestId("admin-master-owner").click();
  await page.getByTestId("admin-master-submit").click();
  const value = page.getByTestId("admin-master-password");
  await expect(value).not.toBeEmpty();
  const temporary = (await value.textContent())?.trim() ?? "";
  await page.getByTestId("admin-master-done").click();

  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Owner");

  const masterSide = await adminContext(browser, testIp);
  try {
    await masterSide.page.goto(adminPath(), {
      waitUntil: "domcontentloaded",
    });
    await masterSide.page.getByTestId("admin-login-email").fill(email);
    await masterSide.page.getByTestId("admin-login-password").fill(temporary);
    await masterSide.page.getByTestId("admin-login-submit").click();
    await expect(masterSide.page.getByTestId("admin-sidebar")).toBeVisible();
    await masterSide.page
      .getByTestId("admin-sidebar")
      .getByRole("link", { name: "Access & security", exact: true })
      .click();
    await expect(
      masterSide.page.getByTestId("admin-hub-tab-masters"),
    ).toBeVisible();
  } finally {
    await masterSide.context.close();
  }

  await expectAudit(admin, {
    action: "admin.create",
    detailsText: email,
  });
});

test("MST-3: a duplicate master email shows an inline error and keeps the dialog", async ({
  page,
  admin,
}) => {
  const existing = await createMasterViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-master").click();
  await page.getByTestId("admin-master-email").fill(existing.email);
  await page.getByTestId("admin-master-submit").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Master account already exists",
  );
  await expect(dialog.getByTestId("admin-master-email")).toBeVisible();
});

test("MST-4: disabling a master blocks login and enable restores it", async ({
  browser,
  page,
  admin,
  testIp,
}) => {
  const operator = await createMasterViaAdmin(admin);
  const operatorSide = await adminContext(browser, testIp);
  try {
    await loginAsMaster(operatorSide.page, operator);

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-master-menu-${operator.email}`).click();
    await page.getByRole("menuitem", { name: "Block", exact: true }).click();
    await confirmAction(page);
    await expectToast(page, `${operator.email} blocked`);

    await operatorSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      operatorSide.page.getByTestId("admin-login-form"),
    ).toBeVisible();
    await operatorSide.page
      .getByTestId("admin-login-email")
      .fill(operator.email);
    await operatorSide.page
      .getByTestId("admin-login-password")
      .fill(operator.password);
    await operatorSide.page.getByTestId("admin-login-submit").click();
    await expect(operatorSide.page.getByTestId("admin-login-error")).toHaveText(
      "This master account is disabled — contact an owner.",
    );

    await page.getByTestId(`admin-master-menu-${operator.email}`).click();
    await page.getByRole("menuitem", { name: "Unblock", exact: true }).click();
    await confirmAction(page);
    await expectToast(page, `${operator.email} unblocked`);
    const row = await readMaster(admin, operator.id);
    expect(row.disabledAt).toBeNull();
  } finally {
    await operatorSide.context.close();
  }

  await expectAudit(admin, { action: "admin.disable", targetId: operator.id });
  await expectAudit(admin, { action: "admin.enable", targetId: operator.id });
});

test("MST-5: resetting a master password kills old sessions and old credentials", async ({
  browser,
  page,
  admin,
  testIp,
}) => {
  const operator = await createMasterViaAdmin(admin);
  const operatorSide = await adminContext(browser, testIp);
  try {
    await loginAsMaster(operatorSide.page, operator);

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-master-menu-${operator.email}`).click();
    await page
      .getByRole("menuitem", { name: "Reset password", exact: true })
      .click();
    await confirmAction(page);
    const value = page.getByTestId("admin-master-password");
    await expect(value).not.toBeEmpty();
    const temporary = (await value.textContent())?.trim() ?? "";
    await page.getByTestId("admin-master-done").click();

    await operatorSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      operatorSide.page.getByTestId("admin-login-form"),
    ).toBeVisible();

    const fresh = await adminContext(browser, testIp);
    try {
      await fresh.page.goto(adminPath(), {
        waitUntil: "domcontentloaded",
      });
      await fresh.page.getByTestId("admin-login-email").fill(operator.email);
      await fresh.page
        .getByTestId("admin-login-password")
        .fill(operator.password);
      await fresh.page.getByTestId("admin-login-submit").click();
      await expect(fresh.page.getByTestId("admin-login-error")).toBeVisible();

      await fresh.page.getByTestId("admin-login-email").fill(operator.email);
      await fresh.page.getByTestId("admin-login-password").fill(temporary);
      await fresh.page.getByTestId("admin-login-submit").click();
      await expect(fresh.page.getByTestId("admin-sidebar")).toBeVisible();
    } finally {
      await fresh.context.close();
    }
  } finally {
    await operatorSide.context.close();
  }

  await expectAudit(admin, {
    action: "admin.password_reset",
    targetId: operator.id,
  });
});

test("MST-6: revoking master sessions ends the live panel session", async ({
  browser,
  page,
  admin,
  operator,
  testIp,
}) => {
  const operatorSide = await adminContext(browser, testIp);
  try {
    await loginAsMaster(operatorSide.page, operator);

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-master-menu-${operator.email}`).click();
    await page
      .getByRole("menuitem", { name: "Revoke sessions", exact: true })
      .click();
    await confirmAction(page);
    await expectToast(page, "Sessions revoked");

    await operatorSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      operatorSide.page.getByTestId("admin-login-form"),
    ).toBeVisible();
  } finally {
    await operatorSide.context.close();
  }

  await expectAudit(admin, {
    action: "admin.sessions_revoked",
    targetId: operator.id,
  });
});

test("MST-7: removing a master leaves the same-email user intact", async ({
  page,
  admin,
}) => {
  const email = uniqueEmail("master-and-user");
  const user = await createUserViaAdmin(admin, {
    email,
    verified: true,
    password: "e2e-user-password-123",
  });
  const master = await createMasterViaAdmin(admin, { email });

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await page.getByTestId(`admin-master-menu-${master.email}`).click();
  await page.getByTestId(`admin-master-remove-${master.email}`).click();
  await confirmAction(page);
  await expectToast(page, `${master.email} removed`);

  await page.getByTestId("admin-logout").click();
  await page.goto(adminPath(), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-login-email").fill(email);
  await page.getByTestId("admin-login-password").fill(master.password);
  await page.getByTestId("admin-login-submit").click();
  await expect(page.getByTestId("admin-login-error")).toBeVisible();

  const userSide = await page.context().newPage();
  try {
    await login(userSide, {
      email,
      password: "e2e-user-password-123",
    });
    await expect(userSide.getByTestId("account-trigger")).toBeVisible();
  } finally {
    await userSide.close();
  }

  await expectAudit(admin, {
    action: "user.demoted",
    targetId: master.id,
    targetType: "admin",
  });
  expect(user.id).toBeTruthy();
});

test("ADM-X6: self-demote is refused and the last owner survives reload", async ({
  page,
  admin,
}) => {
  const extra = await createMasterViaAdmin(admin, "OWNER");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });

  const own = await admin.get("/api/v1/admin/auth/me");
  expect(own.ok()).toBeTruthy();
  const { id } = (await own.json()) as { id: string };
  const row = page
    .getByRole("row")
    .filter({ hasText: ownerCredentials().email });
  await row.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Block", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByTestId(`admin-master-remove-${ownerCredentials().email}`),
  ).toBeDisabled();

  expect(
    (
      await admin.patch(`/api/v1/admin/admins/${id}`, {
        data: { disabled: true },
      })
    ).status(),
  ).toBe(403);
  expect((await admin.delete(`/api/v1/admin/admins/${id}`)).status()).toBe(400);

  const removed = await admin.delete(`/api/v1/admin/admins/${extra.id}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("row").filter({ hasText: ownerCredentials().email }),
  ).toContainText("Active");
  await expect(
    page.getByRole("row").filter({ hasText: extra.email }),
  ).toHaveCount(0);
});

test("MST-8: self block and removal are disabled and refused by the API", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  const own = await admin.get("/api/v1/admin/auth/me");
  expect(own.ok()).toBeTruthy();
  const { id } = (await own.json()) as { id: string };

  const row = page
    .getByRole("row")
    .filter({ hasText: ownerCredentials().email });
  await row.getByRole("button", { name: "Actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Block", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByTestId(`admin-master-remove-${ownerCredentials().email}`),
  ).toBeDisabled();

  const direct = await admin.patch(`/api/v1/admin/admins/${id}`, {
    data: { disabled: true },
  });
  expect(direct.status()).toBe(403);
});
