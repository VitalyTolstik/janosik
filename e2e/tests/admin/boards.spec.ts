import type { APIRequestContext } from "@playwright/test";
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
 * soft-delete and the bulk delete/restore/clear flow. B6/B7 pin the
 * TASK-176.1 contract: selection spans pages and the request carries every
 * saved id, while a partial failure keeps exactly the refused id selected.
 */

async function createBoard(
  admin: APIRequestContext,
  title: string,
  ownerEmail: string,
): Promise<string> {
  const response = await admin.post("/api/v1/admin/boards", {
    data: { title, ownerEmail },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

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
  await expect(
    page.getByText("2 selected (2 on this page)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText(/2 selected/)).toHaveCount(0);

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

test("B6: bulk delete and restore span two pages", async ({
  page,
  admin,
  targetUser,
}) => {
  const prefix = uniqueToken("bulk-pages");
  // The list is ordered by `updatedAt` desc: the oldest row is last, so the
  // 26 boards below put `oldest` alone on page 2 with page size 25.
  const oldest = await createBoard(admin, `${prefix} oldest`, targetUser.email);
  for (let index = 0; index < 24; index += 1) {
    await createBoard(admin, `${prefix} filler ${index}`, targetUser.email);
  }
  const newest = await createBoard(admin, `${prefix} newest`, targetUser.email);

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", prefix);
  await page.getByTestId("admin-page-size").selectOption("25");

  await expect(page.getByTestId(`admin-board-row-${newest}`)).toBeVisible();
  await expect(page.getByTestId(`admin-board-row-${oldest}`)).toHaveCount(0);

  await page.getByTestId(`admin-select-${newest}`).click();
  await page.getByTestId("admin-pagination-next").click();
  await expect(page.getByTestId(`admin-board-row-${oldest}`)).toBeVisible();
  await expect(
    page.getByText("1 selected (0 on this page)", { exact: true }),
  ).toBeVisible();

  await page.getByTestId(`admin-select-${oldest}`).click();
  await expect(
    page.getByText("2 selected (1 on this page)", { exact: true }),
  ).toBeVisible();

  const bulkRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/admin/entities/boards/bulk"),
  );
  await page.getByTestId("admin-bulk-delete").click();
  await expect(
    page.getByRole("dialog", { name: "Apply to 2 selected?" }),
  ).toBeVisible();
  await confirmAction(page);
  await expectToast(page, "Delete selected");

  const body = (await bulkRequest).postDataJSON() as {
    ids: string[];
    action: string;
  };
  expect(body.action).toBe("delete");
  expect(body.ids).toHaveLength(2);
  expect(body.ids).toEqual(expect.arrayContaining([oldest, newest]));

  // Both rows — including the one selected on page 2 — are soft-deleted.
  await searchAdminList(page, "boards", `${prefix} oldest`);
  await expect(page.getByTestId(`admin-board-row-${oldest}`)).toContainText(
    "Deleted",
  );
  await searchAdminList(page, "boards", `${prefix} newest`);
  await expect(page.getByTestId(`admin-board-row-${newest}`)).toContainText(
    "Deleted",
  );

  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  await searchAdminList(page, "boards", prefix);
  for (const id of [oldest, newest]) {
    await page.getByTestId(`admin-select-${id}`).click();
  }
  await page.getByTestId("admin-bulk-restore").click();
  await expectToast(page, "Restore selected");

  await page.getByRole("button", { name: "Active", exact: true }).click();
  await searchAdminList(page, "boards", `${prefix} oldest`);
  await expect(page.getByTestId(`admin-board-row-${oldest}`)).toContainText(
    "Active",
  );
  await searchAdminList(page, "boards", `${prefix} newest`);
  await expect(page.getByTestId(`admin-board-row-${newest}`)).toContainText(
    "Active",
  );

  await expectAudit(admin, {
    action: "entity.bulk_deleted",
    adminEmail: ownerCredentials().email,
  });
  await expectAudit(admin, {
    action: "entity.bulk_restored",
    adminEmail: ownerCredentials().email,
  });
});

test("B7: a partial bulk restore keeps only the refused row selected", async ({
  page,
  admin,
  targetUser,
}) => {
  const prefix = uniqueToken("bulk-partial");
  const live = await createBoard(admin, `${prefix} live`, targetUser.email);
  const deleted = await createBoard(
    admin,
    `${prefix} deleted`,
    targetUser.email,
  );
  const seeded = await admin.post("/api/v1/admin/entities/boards/bulk", {
    data: { ids: [deleted], action: "delete" },
  });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("boards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "boards", prefix);

  // Restoring a live board is refused; the deleted one succeeds.
  await page.getByTestId(`admin-select-${live}`).click();
  await page.getByTestId(`admin-select-${deleted}`).click();
  const bulkResponse = page.waitForResponse((response) =>
    response.url().includes("/admin/entities/boards/bulk"),
  );
  await page.getByTestId("admin-bulk-restore").click();
  const result = (await (await bulkResponse).json()) as {
    affected: number;
    failed?: string[];
  };
  expect(result.affected).toBe(1);
  expect(result.failed).toEqual([live]);

  await expectToast(page, "1 refused — kept selected for retry.");
  await expect(
    page.getByText("1 selected (1 on this page)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`admin-board-row-${live}`)).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(
    page.getByTestId(`admin-board-row-${deleted}`),
  ).not.toHaveAttribute("data-selected", "true");

  // The successful half was restored; the failed board was already live.
  await searchAdminList(page, "boards", `${prefix} live`);
  await expect(page.getByTestId(`admin-board-row-${live}`)).toContainText(
    "Active",
  );
  await searchAdminList(page, "boards", `${prefix} deleted`);
  await expect(page.getByTestId(`admin-board-row-${deleted}`)).toContainText(
    "Active",
  );
});
