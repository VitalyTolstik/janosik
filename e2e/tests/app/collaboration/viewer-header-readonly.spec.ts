import { test, expect } from "@/fixtures/collaboration.js";
import {
  addCard,
  changeMemberRole,
  expectPresence,
  memberRow,
  openMembers,
} from "@/helpers/collaboration.js";
import {
  cardTitle,
  pressUndo,
  redoButton,
  undoButton,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

test("a VIEWER loses header, member and share management and undo", async ({
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
  await expectPresence(partnerBrowser.page, 2);

  // Give the partner a local history step before the demotion; a VIEWER must
  // not keep a stack the server would refuse anyway.
  await addCard(partnerBrowser.page, "Todo", "Partner edit");
  await expect(undoButton(partnerBrowser.page)).toBeEnabled();

  await changeMemberRole(page, partner.user.email, "Viewer");
  await page.keyboard.press("Escape");
  await expect.poll(() => partner.role(), { timeout: 15_000 }).toBe("VIEWER");
  await expect(
    partnerBrowser.page.locator("[data-composer-trigger]"),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(undoButton(partnerBrowser.page)).toHaveCount(0);
  await expect(redoButton(partnerBrowser.page)).toHaveCount(0);

  await pressUndo(partnerBrowser.page);
  await expect(cardTitle(partnerBrowser.page, "Partner edit")).toBeVisible();

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
  await partnerBrowser.page.keyboard.press("Escape");

  await partnerBrowser.page.reload();
  await expect(
    partnerBrowser.page.getByRole("button", { name: "Switch board" }),
  ).toBeVisible();
  await expect.poll(() => partner.role(), { timeout: 15_000 }).toBe("VIEWER");
  await expect(partnerBrowser.page.getByTestId("share-trigger")).toHaveCount(0);
  await expect(undoButton(partnerBrowser.page)).toHaveCount(0);
  await expect(redoButton(partnerBrowser.page)).toHaveCount(0);
  await expect(cardTitle(partnerBrowser.page, "Partner edit")).toBeVisible();
});
