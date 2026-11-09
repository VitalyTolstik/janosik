import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  confirmAction,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";

/**
 * Boards list (TASK-162.15 full): create for an owner, archive/restore,
 * soft-delete and the bulk delete/restore/clear flow.
 */

test("B1: creating a board assigns it to the owner email", async ({
  page,
  admin,
  targetUser,
}) => {
  const title = uniqueToken("board-created");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-create-board").click();
  await page.getByTestId("admin-board-title").fill(title);
  await page.getByTestId("admin-board-owner").fill(targetUser.email);
  await page.getByTestId("admin-board-submit").click();

  await searchAdminList(page, "boards", title);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText(targetUser.email);
  await expect(row).toContainText("Active");
  await expect(
    page.getByRole("link", { name: targetUser.email, exact: true }),
  ).toBeVisible();

  await expectAudit(admin, { action: "board.create", detailsText: title });
});

test("B3: archive and restore a board from the list", async ({
  page,
  admin,
  board,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", board.title);
  const row = page.getByTestId(`admin-board-row-${board.id}`);
  await expect(row).toContainText("Active");

  await page.getByTestId(`admin-row-actions-${board.id}`).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Archived");

  await page.getByTestId(`admin-row-actions-${board.id}`).click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(row).toContainText("Active");

  await expectAudit(admin, { action: "board.archive", targetId: board.id });
  await expectAudit(admin, { action: "board.unarchive", targetId: board.id });
});

test("B4: deleting a board is a soft delete visible in the Deleted tab", async ({
  page,
  admin,
  board,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", board.title);
  const row = page.getByTestId(`admin-board-row-${board.id}`);

  await page.getByTestId(`admin-row-actions-${board.id}`).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Deleted");

  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  await expect(page.getByTestId(`admin-board-row-${board.id}`)).toBeVisible();
  await expectAudit(admin, { action: "board.delete", targetId: board.id });
});

test("B5: bulk delete, restore and clear selection", async ({
  page,
  admin,
  targetUser,
}) => {
  const prefix = uniqueToken("bulk-board");
  const created: string[] = [];
  for (const suffix of ["one", "two"]) {
    const response = await admin.post("/api/v1/admin/boards", {
      data: { title: `${prefix} ${suffix}`, ownerEmail: targetUser.email },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as { id: string };
    created.push(body.id);
  }

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", prefix);

  for (const id of created) {
    await page.getByTestId(`admin-select-${id}`).click();
  }
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("2 selected", { exact: true })).toHaveCount(0);

  for (const id of created) {
    await page.getByTestId(`admin-select-${id}`).click();
  }
  await page.getByTestId("admin-bulk-delete").click();
  await confirmAction(page);
  for (const id of created) {
    await expect(page.getByTestId(`admin-board-row-${id}`)).toContainText(
      "Deleted",
    );
  }

  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  for (const id of created) {
    await page.getByTestId(`admin-select-${id}`).click();
  }
  await page.getByTestId("admin-bulk-restore").click();
  await expectToast(page, "Restore selected");
  await page.getByRole("button", { name: "Active", exact: true }).click();
  for (const id of created) {
    await expect(page.getByTestId(`admin-board-row-${id}`)).toContainText(
      "Active",
    );
  }

  await expectAudit(admin, {
    action: "entity.bulk_deleted",
    adminEmail: ownerCredentials().email,
  });
  await expectAudit(admin, {
    action: "entity.bulk_restored",
    adminEmail: ownerCredentials().email,
  });
});
