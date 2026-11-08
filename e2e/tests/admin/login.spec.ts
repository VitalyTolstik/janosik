import { test as authTest, expect } from "@/fixtures/auth.js";
import {
  createMasterViaAdmin,
  openAdminLogin,
  ownerCredentials,
  submitAdminLogin,
} from "@/helpers/admin.js";

/**
 * Master sign-in smoke (TASK-162.15): a wrong password, a regular account,
 * the owner session and its lifecycle. Each negative case uses its own fresh
 * master (or user) so the shared owner account never accumulates failures.
 */

const test = authTest;

test("rejects a wrong master password with an inline error", async ({
  page,
  admin,
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
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
});

test("refuses a regular user's credentials at the master login", async ({
  page,
  createUser,
}) => {
  const user = await createUser();

  await openAdminLogin(page);
  await submitAdminLogin(page, user);

  await expect(page.getByTestId("admin-login-error")).toHaveText(
    "Invalid credentials",
  );
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
});

test("signs the owner in and restores the session after a reload", async ({
  page,
}) => {
  const owner = ownerCredentials();

  await openAdminLogin(page);
  await submitAdminLogin(page, owner);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Master panel" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toContainText(owner.email);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Master panel" }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-login-form")).toHaveCount(0);
});

test("signs out and stays signed out after a reload", async ({ page }) => {
  await openAdminLogin(page);
  await submitAdminLogin(page, ownerCredentials());
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();

  await page.getByTestId("admin-logout").click();
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("admin-login-form")).toBeVisible();
  await expect(page.getByTestId("admin-sidebar")).toHaveCount(0);
});
