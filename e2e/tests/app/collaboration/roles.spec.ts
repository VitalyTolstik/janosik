import { test, expect } from "@/fixtures/collaboration.js";
import {
  changeMemberRole,
  expectPresence,
  memberRow,
  openMembers,
  removeMember,
} from "@/helpers/collaboration.js";
import {
  cardDialog,
  cardTitle,
  closeCardDialog,
  notification,
  openCard,
} from "@/helpers/history.js";

test("a demoted member's board becomes read-only live", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Visible card");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await changeMemberRole(page, partner.user.email, "Viewer");
  await page.keyboard.press("Escape");

  await expect(
    partnerBrowser.page.locator("[data-composer-trigger]"),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(cardTitle(partnerBrowser.page, "Visible card")).toBeVisible();
  await expect(
    partnerBrowser.page.locator("[data-add-column-trigger]"),
  ).toHaveCount(0);
  await expect(
    partnerBrowser.page.getByRole("button", { name: "Column options" }),
  ).toHaveCount(0);

  await openCard(partnerBrowser.page, "Visible card");
  const title = cardDialog(partnerBrowser.page).getByRole("textbox", {
    name: "Title",
  });
  await expect(title).toHaveJSProperty("readOnly", true);
  await closeCardDialog(partnerBrowser.page);
  expect(await partner.role()).toBe("VIEWER");
});

test("a promoted member can manage the member list live", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await changeMemberRole(page, partner.user.email, "Admin");
  await page.keyboard.press("Escape");

  const dialog = await openMembers(partnerBrowser.page);
  await expect(dialog.getByTestId("board-members-invite")).toBeVisible({
    timeout: 15_000,
  });
  await expect(memberRow(partnerBrowser.page, board.email)).toBeVisible();
  await expect(
    memberRow(partnerBrowser.page, partner.user.email),
  ).toBeVisible();
  expect(await partner.role()).toBe("ADMIN");
});

test("the last admin cannot be demoted or removed", async ({ page, board }) => {
  await board.open(page);
  const dialog = await openMembers(page);
  const row = memberRow(page, board.email);

  await expect(row.getByTestId("role-trigger")).toBeDisabled();
  await expect(
    row.getByRole("button", { name: `Remove — ${board.email}` }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();
});

test("removing a member revokes access on the open board", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Shared card");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  await removeMember(page, partner.user.email);
  await page.keyboard.press("Escape");

  await expect(
    notification(
      partnerBrowser.page,
      "You no longer have access to this board",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(partnerBrowser.page).not.toHaveURL(
    new RegExp(`/board/${board.id}`),
  );
  expect(await partner.role()).toBeUndefined();
});
