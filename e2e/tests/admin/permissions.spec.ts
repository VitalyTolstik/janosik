import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  confirmAction,
  createMasterViaAdmin,
  createUserViaAdmin,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";
import { seedRichCard } from "@/helpers/admin-content.js";

/**
 * OWNER / OPERATOR rights (TASK-162.15 full): the operator must not see or
 * reach owner-only areas, while day-to-day moderation keeps working.
 */

test("hides owner-only navigation entries from an operator", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);
  const sidebar = page.getByTestId("admin-sidebar");

  await expect(
    sidebar.getByRole("link", { name: "Users", exact: true }),
  ).toBeVisible();
  for (const name of ["Masters", "Email service", "OAuth login"]) {
    await expect(sidebar.getByRole("link", { name, exact: true })).toHaveCount(
      0,
    );
  }

  // Masters is not even a tab in the operator's Access hub; the limit is
  // enforced by the server anyway, but the UI should not advertise it.
  await sidebar
    .getByRole("link", { name: "Access & security", exact: true })
    .click();
  await expect(page.getByTestId("admin-hub-tab-sessions")).toBeVisible();
  await expect(page.getByTestId("admin-hub-tab-masters")).toHaveCount(0);
});

test("refuses the masters area to an operator on a direct URL", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  const forbidden = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/v1/admin/admins") &&
      candidate.status() === 403,
  );
  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await forbidden;

  await expect(page.getByTestId("admin-forbidden-state")).toBeVisible();
  await expect(
    page.getByText("Owner rights required", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-master-password")).toHaveCount(0);
});

test("shows the IP allowlist read-only to an operator", async ({
  page,
  admin,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page.goto(adminPath("security"), { waitUntil: "domcontentloaded" });

  const allowlist = page.getByTestId("admin-ip-allowlist");
  await expect(allowlist).toBeVisible();
  await expect(allowlist).toBeDisabled();
  await expect(page.getByTestId("admin-ip-readonly")).toBeVisible();
  await expect(page.getByTestId("admin-ip-save")).toHaveCount(0);
});

test("hides owner-only user actions from an operator", async ({
  page,
  admin,
}) => {
  const user = await createUserViaAdmin(admin);
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();

  await expect(
    page.getByRole("menuitem", { name: "Change email", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Reset password",
    "Promote to master",
    "Impersonate",
    "Export data",
    "Delete user",
  ]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toHaveCount(
      0,
    );
  }
});

test("lets an operator block a user", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);

  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", user.email);

  const row = page.getByTestId(`admin-user-row-${user.id}`);
  await expect(row).toBeVisible();
  await page.getByTestId(`admin-row-actions-${user.id}`).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  await confirmAction(page);

  await expect(row).toContainText("Disabled");
});

test("PERM-6: operator sees email settings read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("email"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-email-status")).toBeVisible();
  await expect(page.getByTestId("admin-email-from")).toBeDisabled();
  await expect(page.getByTestId("admin-email-save")).toHaveCount(0);
  await expect(page.getByTestId("admin-email-test-send")).toBeDisabled();
  await expect(
    page.getByText("Viewing only — email settings can be changed by an owner."),
  ).toBeVisible();
});

test("PERM-7: operator sees OAuth settings read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("oauth"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-oauth-client-id-google")).toBeDisabled();
  await expect(page.getByTestId("admin-oauth-save-google")).toHaveCount(0);
  await expect(page.getByTestId("admin-oauth-callback-google")).toContainText(
    /\/api\/v1\/auth\/oauth\/google\/callback/,
  );
  await expect(
    page.getByText(
      "Only owners can change the OAuth providers — the settings are shown read-only.",
    ),
  ).toBeVisible();
});

test("PERM-8: operator sees traffic settings read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("traffic"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-traffic-rpm")).toBeVisible();
  await expect(page.getByTestId("admin-traffic-limit")).toBeVisible();
  await expect(page.getByTestId("admin-traffic-limit-input")).toBeDisabled();
  await expect(page.getByTestId("admin-traffic-save")).toHaveCount(0);
});

test("PERM-9: operator sees the demo runner read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("demo"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-demo-status")).toBeVisible();
  await expect(page.getByTestId("admin-demo-agents")).toBeVisible();
  await expect(page.getByTestId("admin-demo-start")).toHaveCount(0);
  await expect(page.getByTestId("admin-demo-stop")).toHaveCount(0);
  await expect(page.getByText("Only an owner can run the demo.")).toBeVisible();
});

test("PERM-10: operator sees operations read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();

  const switches = page.getByRole("switch");
  await expect(switches.first()).toBeVisible();
  const count = await switches.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(switches.nth(index)).toBeDisabled();
  }
  for (const id of [
    "admin-ops-save",
    "admin-ops-rate-limit-save",
    "admin-ops-retention-save",
    "admin-ops-schedule-save",
    "admin-ops-comms-save",
    "admin-ops-purge",
    "admin-ops-run-sweeps",
  ]) {
    await expect(page.getByTestId(id)).toBeDisabled();
  }
});

test("PERM-11: operator sees communications read-only", async ({
  page,
  operator,
}) => {
  await loginAsMaster(page, operator);
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-announcement-new")).toBeDisabled();
  await expect(page.getByTestId("admin-email-to")).toBeDisabled();
  await expect(page.getByTestId("admin-email-send")).toBeDisabled();
  await expect(
    page.getByTestId("admin-template-save-verification_code"),
  ).toBeDisabled();
  await expect(
    page.getByTestId("admin-template-reset-verification_code"),
  ).toHaveCount(0);
});

test("PERM-12: operator can view an announcement read-only", async ({
  page,
  admin,
  operator,
}) => {
  const title = uniqueToken("perm-announcement");
  const created = await admin.post("/api/v1/admin/announcements", {
    data: {
      title,
      body: `Body ${title}`,
      level: "info",
      audience: "segment",
      segment: "nobody@e2e.example",
      sendEmail: false,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await loginAsMaster(page, operator);
  await page.goto(adminPath("announcements"), {
    waitUntil: "domcontentloaded",
  });
  await searchAdminList(page, "announcements", title);

  const row = page.getByTestId("admin-row-announcements-0");
  await expect(row).toContainText(title);
  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("admin-announcement-title")).toBeDisabled();
  await expect(dialog.getByTestId("admin-announcement-save-draft")).toHaveCount(
    0,
  );
  await expect(dialog.getByTestId("admin-announcement-edit-save")).toHaveCount(
    0,
  );
  await dialog.getByTestId("admin-announcement-close").click();
});

test("PERM-13: operator can still archive a board", async ({
  page,
  admin,
  board,
}) => {
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", board.title);

  const row = page.getByTestId(`admin-board-row-${board.id}`);
  await expect(row).toContainText("Active");
  await page.getByTestId(`admin-row-actions-${board.id}`).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Archived");

  await expectAudit(admin, {
    action: "board.archive",
    targetId: board.id,
    adminEmail: operator.email,
  });
});

test("PERM-14: operator can still delete a comment", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  const operator = await createMasterViaAdmin(admin);
  await loginAsMaster(page, operator);
  await page.goto(adminPath("comments"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "comments", seeded.commentText);

  const row = page.getByRole("row").filter({ hasText: seeded.commentText });
  await expect(row).toContainText("Active");
  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Deleted");

  await expectAudit(admin, {
    action: "comment.delete",
    targetId: seeded.commentId,
    adminEmail: operator.email,
  });
});
