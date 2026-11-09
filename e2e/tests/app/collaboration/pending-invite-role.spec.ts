import { test, expect } from "@/fixtures/collaboration.js";
import {
  acceptInvitation,
  invitationRow,
  inviteMember,
  memberRow,
  openInvitations,
  openMembers,
} from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 60_000 });

test("re-inviting a pending address with a new role revives the invitation", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.open(page);
  await inviteMember(page, partner.user.email, "Viewer");
  await page.keyboard.press("Escape");

  await partnerBrowser.page.reload();
  const panel = await openInvitations(partnerBrowser.page);
  const row = invitationRow(partnerBrowser.page, board.title);
  await expect(row).toHaveAttribute("data-role", "VIEWER");
  await expect(row).toContainText("Viewer");
  await expect(panel.getByTestId("invitation-row")).toHaveCount(1);
  await partnerBrowser.page.keyboard.press("Escape");

  await inviteMember(page, partner.user.email, "Admin");
  await page.keyboard.press("Escape");

  await partnerBrowser.page.reload();
  const updated = await openInvitations(partnerBrowser.page);
  const updatedRow = invitationRow(partnerBrowser.page, board.title);
  await expect(updatedRow).toHaveAttribute("data-role", "ADMIN");
  await expect(updatedRow).toContainText("Admin");
  await expect(updated.getByTestId("invitation-row")).toHaveCount(1);
  await partnerBrowser.page.keyboard.press("Escape");

  await acceptInvitation(partnerBrowser.page, board.title);
  await expect.poll(() => partner.role()).toBe("ADMIN");
  await expect(partnerBrowser.page.locator("header h2")).toHaveText(
    board.title,
  );

  await openMembers(page);
  await expect(memberRow(page, partner.user.email)).toHaveAttribute(
    "data-role",
    "ADMIN",
  );
});
