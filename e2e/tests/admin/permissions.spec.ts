import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createMasterViaAdmin,
  createUserViaAdmin,
  loginAsMaster,
  searchAdminList,
} from "@/helpers/admin.js";

/**
 * OWNER / OPERATOR rights (TASK-162.15): the operator must not see or reach
 * owner-only areas, while day-to-day moderation keeps working.
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

  await expect(page.getByText("Could not load the data")).toBeVisible();
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
  await page.getByTestId("admin-confirm-accept").click();

  await expect(row).toContainText("Disabled");
});
