import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/auth.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueEmail,
} from "@/helpers/admin.js";

/**
 * Owner key actions (TASK-162.15): create, block, unblock and delete a user,
 * mint another master and open a support impersonation session. Every test
 * provisions its own accounts through the owner API.
 */

test("creates a user and reveals the generated password once", async ({
  page,
}) => {
  const email = uniqueEmail("panel-created");
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-user").click();
  await page.getByTestId("admin-user-email").fill(email);
  await page.getByTestId("admin-user-submit").click();

  await expect(page.getByTestId("admin-created-password")).toHaveText(/\S+/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();

  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", email);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("blocks a user from the roster", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", user.email);
  const row = page.getByTestId(`admin-user-row-${user.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Active");

  await page.getByTestId(`admin-row-actions-${user.id}`).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  await page.getByTestId("admin-confirm-accept").click();

  await expect(row).toContainText("Disabled");
});

test("unblocks a blocked user", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  const blocked = await admin.patch(`/api/v1/admin/users/${user.id}`, {
    data: { disabled: true },
  });
  expect(blocked.ok(), await blocked.text()).toBeTruthy();
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "users", user.email);
  const row = page.getByTestId(`admin-user-row-${user.id}`);
  await expect(row).toContainText("Disabled");

  await page.getByTestId(`admin-row-actions-${user.id}`).click();
  await page.getByRole("menuitem", { name: "Unblock", exact: true }).click();
  await page.getByTestId("admin-confirm-accept").click();

  await expect(row).toContainText("Active");
});

test("deletes a user after the typed confirmation", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin);
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();
  await page.getByTestId("admin-user-delete").click();

  const dialog = page.getByTestId("admin-delete-user-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("admin-delete-user-input").fill(user.email);
  await dialog.getByTestId("admin-delete-user-submit").click();

  await expect(page).toHaveURL(/\/admin\/users$/);
  const removed = await admin.get(`/api/v1/admin/users/${user.id}/detail`);
  expect(removed.status()).toBe(404);
});

test("mints an operator master and shows the password once", async ({
  page,
}) => {
  const email = uniqueEmail("panel-new-master");
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath("masters"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-master").click();
  await page.getByTestId("admin-master-email").fill(email);
  await page.getByTestId("admin-master-submit").click();

  await expect(page.getByTestId("admin-master-password")).toHaveText(/\S+/);
  await page.getByTestId("admin-master-done").click();

  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Operator");
});

test("impersonates a user in a new tab", async ({ page, admin }) => {
  const user = await createUserViaAdmin(admin, { verified: true });
  const board = await admin.post("/api/v1/admin/boards", {
    data: {
      title: `Impersonation ${randomUUID()}`,
      ownerEmail: user.email,
    },
  });
  expect(board.ok(), await board.text()).toBeTruthy();
  const { id: boardId } = (await board.json()) as { id: string };
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath(`users/${user.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-user-detail-actions").click();

  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("menuitem", { name: "Impersonate", exact: true })
    .click();
  const popup = await popupPromise;

  try {
    await popup.waitForLoadState("domcontentloaded");
    const banner = popup.getByTestId("impersonation-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(user.email);
    await expect(popup).toHaveURL(new RegExp(`/board/${boardId}$`));
  } finally {
    await popup.close();
  }
});
