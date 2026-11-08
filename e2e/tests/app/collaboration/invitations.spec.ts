import { test, expect } from "@/fixtures/collaboration.js";
import {
  acceptInvitation,
  declineInvitation,
  expectStillAlive,
  invitationRow,
  inviteMember,
  markAlive,
  memberRow,
  openInvitations,
} from "@/helpers/collaboration.js";
import { columnSection } from "@/helpers/history.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

test("an admin invites a new account by email", async ({
  page,
  board,
  partner,
}) => {
  await board.open(page);

  await inviteMember(page, partner.user.email);

  // The invitation is pending: it must not appear as an accepted member.
  await expect(memberRow(page, partner.user.email)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Members (1)" }),
  ).toBeVisible();
  const invitations = await partner.invitations();
  expect(
    invitations.some(
      (invitation) =>
        invitation.boardId === board.id && invitation.role === "MEMBER",
    ),
  ).toBe(true);
});

test("the invitee sees the board, inviter and role in the bell", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  // Invite through the dialog role picker, not the API: the requested role
  // must survive the UI path into the notification.
  await board.open(page);
  await inviteMember(page, partner.user.email, "Viewer");
  await partnerBrowser.page.reload();
  const panel = await openInvitations(partnerBrowser.page);

  const row = invitationRow(partnerBrowser.page, board.title);
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Invited by ${board.email}`);
  await expect(row).toContainText("Viewer");
  await expect(
    partnerBrowser.page.getByTestId("notifications-badge"),
  ).toHaveText("1");
  await expect(panel.getByTestId("invitation-row")).toHaveCount(1);
});

test("a pending invitation grants no board access", async ({
  board,
  partner,
  partnerBrowser,
}) => {
  await partner.invite("MEMBER");
  await partnerBrowser.page.reload();
  await expect(
    partnerBrowser.page.getByTestId("notifications-bell"),
  ).toBeVisible();

  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);

  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
  // The invitation itself is untouched: pending, not declined or accepted.
  expect(await partner.invitations()).toHaveLength(1);
});

test("accepting an invitation opens the shared board", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await partner.invite("MEMBER");
  await partnerBrowser.page.reload();
  await markAlive(partnerBrowser.page);

  await acceptInvitation(partnerBrowser.page, board.title);

  await expect(partnerBrowser.page.locator("header h2")).toHaveText(
    board.title,
  );
  await expect(columnSection(partnerBrowser.page, "Todo")).toBeVisible();
  await expect(
    partnerBrowser.page.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  await partnerBrowser.page
    .getByRole("button", { name: "Switch board" })
    .click();
  await expect(
    partnerBrowser.page.getByRole("option").filter({ hasText: board.title }),
  ).toBeVisible();
  await partnerBrowser.page.keyboard.press("Escape");
  await expect.poll(() => partner.role()).toBe("MEMBER");
  await expectStillAlive(partnerBrowser.page);
  expect(await partner.invitations()).toEqual([]);
});

test("declining an invitation leaves the board out of my boards", async ({
  board,
  partner,
  partnerBrowser,
}) => {
  await partner.invite("MEMBER");
  await partnerBrowser.page.reload();

  await declineInvitation(partnerBrowser.page, board.title);

  await expect(
    partnerBrowser.page.getByTestId("notifications-badge"),
  ).toHaveCount(0);
  await partnerBrowser.page
    .getByRole("button", { name: "Switch board" })
    .click();
  await expect(
    partnerBrowser.page.getByRole("option").filter({ hasText: board.title }),
  ).toHaveCount(0);
  await partnerBrowser.page.keyboard.press("Escape");

  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
  expect(await partner.role()).toBeUndefined();
  expect(await partner.invitations()).toEqual([]);
});
