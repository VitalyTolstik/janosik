import { test, expect } from "@/fixtures/collaboration.js";
import {
  changeMemberRole,
  expectPresence,
  expectStillAlive,
  markAlive,
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
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

test("a demoted member's board becomes read-only live", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "Visible card");
  await board.command({
    type: "SET_COLUMN_ACCENT",
    columnId: todo,
    accent: { type: "color", value: "brand" },
  });
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);
  await markAlive(partnerBrowser.page);

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
  // The accent is decoration and stays visible; its editor and the
  // board-wide shape control disappear for a VIEWER.
  await expect(
    partnerBrowser.page.getByTestId("column-style-trigger"),
  ).toHaveCount(0);
  await expect(
    partnerBrowser.page.getByTestId("column-style-menu"),
  ).toHaveCount(0);
  await expect(
    partnerBrowser.page.locator('section[data-column-accent="brand"]'),
  ).toBeVisible();

  await openCard(partnerBrowser.page, "Visible card");
  const title = cardDialog(partnerBrowser.page).getByRole("textbox", {
    name: "Title",
  });
  await expect(title).toHaveJSProperty("readOnly", true);
  await closeCardDialog(partnerBrowser.page);
  await expect.poll(() => partner.role()).toBe("VIEWER");
  await expectStillAlive(partnerBrowser.page);
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
  await markAlive(partnerBrowser.page);

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
  await expect.poll(() => partner.role()).toBe("ADMIN");
  await expectStillAlive(partnerBrowser.page);
});

test("the last admin cannot be demoted or removed", async ({
  page,
  board,
  partner,
}) => {
  await board.open(page);
  const dialog = await openMembers(page);
  const row = memberRow(page, board.email);

  await expect(row.getByTestId("role-trigger")).toBeDisabled();
  await expect(
    row.getByRole("button", { name: `Remove — ${board.email}` }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();

  // Bypassing the disabled controls must not loosen the server guard.
  const demote = await board.api.patch(
    `/api/v1/boards/${board.id}/members/${board.userId}`,
    { data: { role: "MEMBER" } },
  );
  expect(demote.status()).toBe(409);
  const remove = await board.api.delete(
    `/api/v1/boards/${board.id}/members/${board.userId}`,
  );
  expect(remove.status()).toBe(409);

  // A second ADMIN makes the owner's row manageable again.
  await partner.invite("ADMIN");
  await partner.accept();
  await page.keyboard.press("Escape");
  const reopened = await openMembers(page);
  await expect(reopened).toBeVisible();
  await expect(
    memberRow(page, board.email).getByTestId("role-trigger"),
  ).toBeEnabled();
  await expect(
    memberRow(page, board.email).getByRole("button", {
      name: `Remove — ${board.email}`,
    }),
  ).toBeEnabled();
  await expect(memberRow(page, partner.user.email)).toBeVisible();
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

  // A direct URL after the live removal must be refused too.
  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
});
