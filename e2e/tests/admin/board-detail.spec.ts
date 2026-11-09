import { test, expect } from "@/fixtures/admin.js";
import type { BoardFixture } from "@/fixtures/board.js";
import { siteUrl } from "@/helpers/urls.js";
import {
  adminPath,
  confirmAction,
  createUserViaAdmin,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/**
 * Board detail (TASK-162.15 full): the meta/counter/roster/columns/labels
 * graph, member add/role/remove/owner transfer, and the destructive action
 * menu with a confirmation that Cancel leaves untouched.
 */

interface DetailMember {
  id: string;
  userId: string;
  userEmail: string;
  role: string;
}

async function membersOf(
  admin: import("@playwright/test").APIRequestContext,
  boardId: string,
): Promise<DetailMember[]> {
  const response = await admin.get(`/api/v1/admin/boards/${boardId}/meta`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { members: DetailMember[] };
  return body.members;
}

async function addAcceptedMember(
  board: BoardFixture,
  user: { email: string; password: string },
  role: "ADMIN" | "MEMBER" | "VIEWER",
  playwright: typeof import("playwright-core"),
) {
  const invited = await board.api.post(`/api/v1/boards/${board.id}/members`, {
    data: { email: user.email, role },
  });
  expect(invited.status(), await invited.text()).toBe(201);
  const client = await playwright.request.newContext({
    baseURL: siteUrl,
  });
  const loginResponse = await client.post("/api/v1/auth/login", { data: user });
  expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
  const { accessToken } = (await loginResponse.json()) as {
    accessToken: string;
  };
  await client.dispose();
  const api = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  try {
    const invitations = await api.get("/api/v1/invitations");
    const list = (await invitations.json()) as Array<{
      id: string;
      boardId: string;
    }>;
    const invitation = list.find((item) => item.boardId === board.id);
    expect(invitation).toBeDefined();
    const accepted = await api.post(
      `/api/v1/invitations/${invitation!.id}/accept`,
    );
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
  } finally {
    await api.dispose();
  }
}

test("B6: board detail shows meta, counters, members, columns and labels", async ({
  page,
  board,
}) => {
  const token = `detail-${Date.now()}`;
  const columnA = await board.column(`Column A ${token}`);
  await board.column(`Column B ${token}`);
  await board.card(columnA, `Card ${token}`);
  await board.label(`Label ${token}`, "green");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId(`admin-id-${board.id}`)).toBeVisible();
  const meta = page.getByTestId("admin-board-detail-meta");
  await expect(meta).toContainText(board.email);
  await expect(meta).toContainText(/\d+/);
  const counters = page.getByTestId("admin-board-detail-counters");
  for (const label of [
    "Members",
    "Columns",
    "Cards",
    "Labels",
    "Links",
    "Comments",
    "Files",
    "Commands",
    "Events",
  ]) {
    await expect(counters.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page
      .getByTestId("admin-board-detail-columns")
      .getByText(`Column A ${token}`),
  ).toBeVisible();
  await expect(
    page.getByTestId("admin-board-detail-labels").getByText(`Label ${token}`),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("admin-board-detail-members")
      .getByRole("link", { name: board.email, exact: true }),
  ).toBeVisible();
});

test("B7: adding a member with VIEWER role creates the row", async ({
  page,
  admin,
  board,
}) => {
  const user = await createUserViaAdmin(admin, { verified: true });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("admin-board-add-member").click();
  const dialog = page.getByTestId("admin-add-member-dialog");
  await dialog.getByTestId("admin-add-member-email").fill(user.email);
  await dialog.getByTestId("admin-add-member-role").selectOption("VIEWER");
  await dialog.getByTestId("admin-add-member-submit").click();
  await expectToast(page, "Member added");

  const row = page
    .getByTestId("admin-board-detail-members")
    .getByRole("row")
    .filter({ hasText: user.email });
  await expect(row).toContainText("Viewer");
  await expectAudit(admin, {
    action: "board.member_added",
    targetId: board.id,
  });
});

test("B8: changing a member role updates the badge", async ({
  page,
  admin,
  board,
  playwright,
}) => {
  const user = await createUserViaAdmin(admin, {
    verified: true,
    password: "e2e-member-password-123",
  });
  await addAcceptedMember(
    board,
    { email: user.email, password: "e2e-member-password-123" },
    "MEMBER",
    playwright,
  );
  const member = (await membersOf(admin, board.id)).find(
    (entry) => entry.userEmail === user.email,
  );
  expect(member).toBeDefined();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId(`admin-member-actions-${member!.id}`).click();
  await page.getByRole("menuitem", { name: "ADMIN", exact: true }).click();
  await expectToast(page, "Role updated");

  const row = page
    .getByTestId("admin-board-detail-members")
    .getByRole("row")
    .filter({ hasText: user.email });
  await expect(row).toContainText("Admin");
  await expectAudit(admin, {
    action: "board.member_role_changed",
    targetId: board.id,
  });
});

test("B9: removing a member drops the row", async ({
  page,
  admin,
  board,
  playwright,
}) => {
  const user = await createUserViaAdmin(admin, {
    verified: true,
    password: "e2e-member-password-123",
  });
  await addAcceptedMember(
    board,
    { email: user.email, password: "e2e-member-password-123" },
    "MEMBER",
    playwright,
  );
  const member = (await membersOf(admin, board.id)).find(
    (entry) => entry.userEmail === user.email,
  );
  expect(member).toBeDefined();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId(`admin-member-actions-${member!.id}`).click();
  await page
    .getByRole("menuitem", { name: "Remove member", exact: true })
    .click();
  await expectToast(page, "Member removed");
  await expect(
    page
      .getByTestId("admin-board-detail-members")
      .getByRole("row")
      .filter({ hasText: user.email }),
  ).toHaveCount(0);
  await expectAudit(admin, {
    action: "board.member_removed",
    targetId: board.id,
  });
});

test("B10: transferring ownership demotes the old owner and other admins", async ({
  page,
  admin,
  board,
  playwright,
}) => {
  const next = await createUserViaAdmin(admin, {
    verified: true,
    password: "e2e-next-owner-123",
  });
  const otherAdmin = await createUserViaAdmin(admin, {
    verified: true,
    password: "e2e-other-admin-123",
  });
  await addAcceptedMember(
    board,
    { email: next.email, password: "e2e-next-owner-123" },
    "MEMBER",
    playwright,
  );
  await addAcceptedMember(
    board,
    { email: otherAdmin.email, password: "e2e-other-admin-123" },
    "ADMIN",
    playwright,
  );
  const nextMember = (await membersOf(admin, board.id)).find(
    (entry) => entry.userEmail === next.email,
  );
  expect(nextMember).toBeDefined();

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId(`admin-member-actions-${nextMember!.id}`).click();
  await page.getByRole("menuitem", { name: "Make owner", exact: true }).click();
  await expectToast(page, "Ownership transferred");

  const nextRow = page
    .getByTestId("admin-board-detail-members")
    .getByRole("row")
    .filter({ hasText: next.email })
    .first();
  await expect(nextRow).toContainText("Admin");
  const oldOwnerRow = page
    .getByTestId("admin-board-detail-members")
    .getByRole("row")
    .filter({ hasText: board.email })
    .first();
  await expect(oldOwnerRow).toContainText("Member");
  const otherRow = page
    .getByTestId("admin-board-detail-members")
    .getByRole("row")
    .filter({ hasText: otherAdmin.email })
    .first();
  await expect(otherRow).toContainText("Member");

  await expectAudit(admin, {
    action: "board.owner_transferred",
    targetId: board.id,
  });
});

test("B15/ADM-X12: board detail archive is confirmed and delete ends in an error state", async ({
  page,
  admin,
  board,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  const status = page.getByTestId("admin-board-status");
  await expect(status).toHaveText("Active");

  await page.getByTestId("admin-board-detail-actions").click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  const confirm = page.getByTestId("admin-confirm-accept");
  await expect(confirm).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(status).toHaveText("Active");

  await page.getByTestId("admin-board-detail-actions").click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await confirmAction(page);
  await expect(status).toHaveText("Archived");

  await page.getByTestId("admin-board-detail-actions").click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(status).toHaveText("Active");

  await page.getByTestId("admin-board-detail-actions").click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmAction(page);
  await expect(status).toHaveText("Deleted");

  await expectAudit(admin, { action: "board.archive", targetId: board.id });
  await expectAudit(admin, { action: "board.unarchive", targetId: board.id });
  await expectAudit(admin, { action: "board.delete", targetId: board.id });
});
