import { test, expect } from "@/fixtures/collaboration.js";
import { memberRow, openMembers } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 60_000 });

test("a MEMBER sees the roster but cannot manage members or shares", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);

  await expect(partnerBrowser.page.getByTestId("share-trigger")).toHaveCount(0);
  const dialog = await openMembers(partnerBrowser.page);
  await expect(memberRow(partnerBrowser.page, board.email)).toBeVisible();
  await expect(
    memberRow(partnerBrowser.page, partner.user.email),
  ).toBeVisible();
  await expect(dialog.getByTestId("board-members-invite")).toHaveCount(0);
  await expect(dialog.getByTestId("role-trigger")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Remove — / })).toHaveCount(
    0,
  );

  const invite = await partner.api.post(`/api/v1/boards/${board.id}/members`, {
    data: { email: "someone@e2e.example", role: "MEMBER" },
  });
  expect(invite.status()).toBe(403);
  const share = await partner.api.post(`/api/v1/boards/${board.id}/shares`, {
    data: { mode: "live" },
  });
  expect(share.status()).toBe(403);
});
