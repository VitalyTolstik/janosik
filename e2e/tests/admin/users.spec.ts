import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, adminContext } from "@/fixtures/admin.js";
import { enterCode, login } from "@/fixtures/auth.js";
import { appUrl } from "@/helpers/urls.js";
import {
  adminPath,
  confirmAction,
  createUserViaAdmin,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueEmail,
  uniqueToken,
} from "@/helpers/admin.js";
import { createApiToken, seedRichCard } from "@/helpers/admin-content.js";
import { waitForCodes, waitForMessage } from "@/helpers/mail.js";
import type { BoardFixture } from "@/fixtures/board.js";

/**
 * Users list and support actions (TASK-162.15 full): search/status, create with
 * a chosen password, verification, email change, session/token revocation,
 * password reset, promotion, blocked impersonation, export and the full detail.
 */

test("U1: user list searches by email and filters by status", async ({
  page,
  admin,
}) => {
  const active = await createUserViaAdmin(admin, {
    email: uniqueEmail("list-active"),
    verified: true,
  });
  const blocked = await createUserViaAdmin(admin, {
    email: uniqueEmail("list-blocked"),
    verified: true,
  });
  const disabled = await admin.patch(`/api/v1/admin/users/${blocked.id}`, {
    data: { disabled: true },
  });
  expect(disabled.ok(), await disabled.text()).toBeTruthy();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", active.email);
  await expect(page.getByTestId(`admin-user-row-${active.id}`)).toBeVisible();
  await expect(page.getByTestId(`admin-user-row-${blocked.id}`)).toHaveCount(0);
  await expect(page.getByText(/\d+ registered/)).toBeVisible();

  await searchAdminList(page, "users", blocked.email);
  await page.getByRole("button", { name: "Blocked", exact: true }).click();
  const row = page.getByTestId(`admin-user-row-${blocked.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Disabled");
  await expect(page.getByTestId(`admin-user-row-${active.id}`)).toHaveCount(0);
});

test("U2: a user created with a chosen password can sign in", async ({
  browser,
  page,
  admin,
  testIp,
}) => {
  const email = uniqueEmail("chosen-password");
  const password = "e2e-chosen-password-123";
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-user").click();
  await page.getByTestId("admin-user-email").fill(email);
  await page.getByTestId("admin-user-password").fill(password);
  await page.getByTestId("admin-user-submit").click();
  await expect(page.getByTestId("admin-created-password")).toHaveCount(0);

  await searchAdminList(page, "users", email);
  const row = page
    .locator('[data-testid^="admin-user-row-"]')
    .filter({ hasText: email });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  const createdId = testId?.replace("admin-user-row-", "") ?? "";
  expect(createdId).not.toBe("");
  const verified = await admin.patch(`/api/v1/admin/users/${createdId}`, {
    data: { emailVerified: true },
  });
  expect(verified.ok(), await verified.text()).toBeTruthy();

  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, { email, password });
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();
    await expect(userSide.page).toHaveURL(new RegExp("/app/"));
  } finally {
    await userSide.context.close();
  }
});

test("U3: verifying an email from the detail page updates the badge", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin, { verified: false });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-user-verified-badge")).toHaveText(
    "Unverified",
  );

  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-verify").click();
  await expect(page.getByTestId("admin-user-verified-badge")).toContainText(
    "Verified",
  );
  await page.getByTestId("admin-user-detail-actions").click();
  await expect(page.getByTestId("admin-user-unverify")).toBeVisible();

  await expectAudit(admin, { action: "user.verified", targetId: user.id });
});

test("U4: unverifying an email updates the badge", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin, { verified: true });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-user-verified-badge")).toContainText(
    "Verified",
  );

  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-unverify").click();
  await expect(page.getByTestId("admin-user-verified-badge")).toHaveText(
    "Unverified",
  );
  await expectAudit(admin, { action: "user.unverified", targetId: user.id });
});

test("U5: resend verification delivers a new code", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin, { verified: false });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });

  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-resend").click();
  await expectToast(page, "Resend verification");

  const message = await waitForMessage(admin, {
    to: user.email,
    subjectIncludes: "Janosik",
  });
  expect(message.text).toMatch(/\b\d{6}\b/);
  await expectAudit(admin, {
    action: "user.verification_resent",
    targetId: user.id,
  });
});

test("U6: changing an email moves the login and revokes live sessions", async ({
  browser,
  page,
  admin,
  targetUser,
  testIp,
}) => {
  const nextEmail = uniqueEmail("changed-email");
  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, targetUser);
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath(`users/${targetUser.id}`), {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("admin-user-detail-actions").click();
    await page.getByTestId("admin-user-change-email").click();
    const dialog = page.getByTestId("admin-change-email-dialog");
    await dialog.getByTestId("admin-change-email-input").fill(nextEmail);
    await dialog.getByTestId("admin-change-email-submit").click();
    await expectToast(page, `Email changed to ${nextEmail}`);

    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(userSide.page.getByTestId("login-email")).toBeVisible();

    await userSide.page.getByTestId("login-email").fill(targetUser.email);
    await userSide.page.getByTestId("login-password").fill(targetUser.password);
    await userSide.page.getByTestId("login-submit").click();
    await expect(userSide.page.getByTestId("login-error")).toBeVisible();

    await userSide.page.getByTestId("login-email").fill(nextEmail);
    await userSide.page.getByTestId("login-password").fill(targetUser.password);
    await userSide.page.getByTestId("login-submit").click();
    // The master does not prove ownership of the new mailbox: the user
    // lands on the verification gate and confirms the code sent there.
    await expect(userSide.page.getByTestId("email-verify-code")).toBeVisible();
    const [code] = await waitForCodes(admin, nextEmail, 1);
    await enterCode(userSide.page, code);
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();
  } finally {
    await userSide.context.close();
  }

  await expectAudit(admin, {
    action: "user.email_changed",
    targetId: targetUser.id,
    detailsText: nextEmail,
  });
});

test("U7: revoking sessions ends a live user session", async ({
  browser,
  page,
  admin,
  targetUser,
  testIp,
}) => {
  const userSide = await adminContext(browser, testIp);
  try {
    await login(userSide.page, targetUser);
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();

    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath(`users/${targetUser.id}`), {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("admin-user-detail-actions").click();
    await page.getByRole("menuitem", { name: "Revoke sessions" }).click();
    await confirmAction(page);
    await expectToast(page, "Revoke sessions");

    await userSide.page.reload({ waitUntil: "domcontentloaded" });
    await expect(userSide.page.getByTestId("login-email")).toBeVisible();
  } finally {
    await userSide.context.close();
  }

  await expectAudit(admin, {
    action: "user.sessions_revoked",
    targetId: targetUser.id,
  });
});

test("U8: revoking API tokens stops a personal token", async ({
  page,
  admin,
  board,
  playwright,
  testIp,
}) => {
  const created = await board.api.post("/api/v1/users/me/tokens", {
    data: { name: uniqueToken("revoke-me"), expiresAt: null },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { token } = (await created.json()) as { token: string };

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${board.userId}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByRole("menuitem", { name: "Revoke API tokens" }).click();
  await confirmAction(page);
  await expectToast(page, "Revoke API tokens");

  const pat = await playwright.request.newContext({
    baseURL: appUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const response = await pat.get("/api/v1/boards");
    expect(response.status()).toBe(401);
  } finally {
    await pat.dispose();
  }

  await expectAudit(admin, {
    action: "user.tokens_revoked",
    targetId: board.userId,
  });
});

test("U9: reset password issues a one-time password and kills the old one", async ({
  browser,
  page,
  admin,
  targetUser,
  testIp,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${targetUser.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-reset-password").click();
  const value = page.getByTestId("admin-reset-password-value");
  await expect(value).not.toBeEmpty();
  const temporary = (await value.textContent())?.trim() ?? "";
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();

  const userSide = await adminContext(browser, testIp);
  try {
    await userSide.page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await userSide.page.getByTestId("login-email").fill(targetUser.email);
    await userSide.page.getByTestId("login-password").fill(targetUser.password);
    await userSide.page.getByTestId("login-submit").click();
    await expect(userSide.page.getByTestId("login-error")).toBeVisible();

    await userSide.page.getByTestId("login-email").fill(targetUser.email);
    await userSide.page.getByTestId("login-password").fill(temporary);
    await userSide.page.getByTestId("login-submit").click();
    await expect(userSide.page.getByTestId("account-trigger")).toBeVisible();
  } finally {
    await userSide.context.close();
  }

  await expectAudit(admin, {
    action: "user.password_reset",
    targetId: targetUser.id,
  });
});

test("U10: promoting a user creates an operator master", async ({
  browser,
  page,
  admin,
  targetUser,
  testIp,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${targetUser.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-promote").click();
  const dialog = page.getByTestId("admin-promote-user-dialog");
  await dialog.getByTestId("admin-promote-user-input").fill(targetUser.email);
  await dialog.getByTestId("admin-promote-user-submit").click();
  const value = page.getByTestId("admin-promote-password");
  await expect(value).not.toBeEmpty();
  const temporary = (await value.textContent())?.trim() ?? "";
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();

  const masterSide = await adminContext(browser, testIp);
  try {
    await masterSide.page.goto(`${appUrl}admin`, {
      waitUntil: "domcontentloaded",
    });
    await masterSide.page
      .getByTestId("admin-login-email")
      .fill(targetUser.email);
    await masterSide.page.getByTestId("admin-login-password").fill(temporary);
    await masterSide.page.getByTestId("admin-login-submit").click();
    await expect(masterSide.page.getByTestId("admin-sidebar")).toBeVisible();
    await masterSide.page
      .getByTestId("admin-sidebar")
      .getByRole("link", { name: "Access & security", exact: true })
      .click();
    await expect(
      masterSide.page.getByTestId("admin-hub-tab-masters"),
    ).toHaveCount(0);
  } finally {
    await masterSide.context.close();
  }

  const repeated = await admin.post(
    `/api/v1/admin/users/${targetUser.id}/promote`,
    { data: {} },
  );
  expect(repeated.status()).toBe(409);

  await expectAudit(admin, {
    action: "user.promoted",
    targetId: targetUser.id,
  });
});

test("U11: impersonating a blocked user fails without opening a tab", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin, { verified: true });
  const blocked = await admin.patch(`/api/v1/admin/users/${user.id}`, {
    data: { disabled: true },
  });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });

  const popups: string[] = [];
  page.on("popup", (popup) => popups.push(popup.url()));
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-impersonate").click();
  await expectToast(page, "The action failed");
  await page.waitForTimeout(500);
  expect(popups).toHaveLength(0);
});

test("U12: export downloads a JSON bundle and is audited", async ({
  page,
  admin,
  targetUser,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users/${targetUser.id}`), {
    waitUntil: "domcontentloaded",
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^janosik-user-.*\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bundle = JSON.parse(await readFile(path!, "utf8")) as Record<
    string,
    unknown
  >;
  for (const key of ["user", "memberships", "comments", "sessions", "tokens"]) {
    expect(bundle).toHaveProperty(key);
  }

  await expectAudit(admin, {
    action: "data.export_queued",
    targetId: targetUser.id,
  });
  await expectAudit(admin, {
    action: "data.export_downloaded",
    targetType: "export",
  });
});

test("U13: user detail shows eight counters and nine populated tabs", async ({
  browser,
  page,
  board,
  testIp,
}) => {
  const seeded = await seedDetailUser(browser, board, testIp);
  try {
    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath(`users/${board.userId}`), {
      waitUntil: "domcontentloaded",
    });

    for (const key of [
      "boards",
      "cardsCreated",
      "cardsAssigned",
      "comments",
      "attachments",
      "sessions",
      "tokens",
      "commands",
    ]) {
      const counter = page.getByTestId(`admin-user-counter-${key}`);
      await expect(counter).toBeVisible();
      await expect(counter).toContainText(/[1-9]/);
    }

    for (const key of [
      "memberships",
      "cards",
      "assignedCards",
      "comments",
      "attachments",
      "sessions",
      "tokens",
      "commands",
      "activity",
    ]) {
      await page.getByTestId(`admin-user-tab-${key}`).click();
      await expect(
        page.getByTestId("admin-table-scroll").getByRole("row").nth(1),
      ).toBeVisible();
    }

    await page.getByTestId("admin-user-tab-memberships").click();
    await page.getByRole("link", { name: seeded.boardTitle }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/boards/${board.id}$`));
  } finally {
    await seeded.context.close();
  }
});

async function seedDetailUser(
  browser: import("@playwright/test").Browser,
  board: BoardFixture,
  ip: string,
) {
  const seeded = await seedRichCard(board);
  await createApiToken(board.api, `detail-${randomUUID()}`);
  const panel = await adminContext(browser, ip);
  await login(panel.page, board.user);
  await expect(panel.page.getByTestId("account-trigger")).toBeVisible();
  return { ...seeded, context: panel.context, boardTitle: board.title };
}

test("ADM-X11: an unknown user detail shows the error state", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users/does-not-exist"), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Could not load the data")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});

test("ADM-X11: the user list paginates across 51 matches", async ({
  page,
  admin,
}) => {
  const prefix = uniqueToken("page-user");
  for (let index = 0; index < 51; index += 1) {
    await createUserViaAdmin(admin, {
      email: `${prefix}-${index}@e2e.example`,
      verified: true,
    });
  }
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", prefix);

  const status = page.getByTestId("admin-pagination-status");
  await expect(status).toHaveText("Page 1 of 2");
  await page.getByTestId("admin-pagination-next").click();
  await expect(status).toHaveText("Page 2 of 2");
  await page.getByTestId("admin-pagination-prev").click();
  await expect(status).toHaveText("Page 1 of 2");
});

test("ADM-X11: duplicate email and weak password stay inline", async ({
  page,
  admin,
}) => {
  const existing = await createUserViaAdmin(admin, {
    email: uniqueEmail("duplicate-user"),
    verified: true,
  });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-user").click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("admin-user-email").fill(existing.email);
  await page.getByTestId("admin-user-password").fill("short");
  await expect(dialog.getByRole("alert")).toHaveText("At least 8 characters");

  await page.getByTestId("admin-user-password").fill("e2e-valid-password-123");
  await page.getByTestId("admin-user-submit").click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This email is already registered",
  );
  await expect(dialog.getByTestId("admin-user-email")).toBeVisible();
});
