import { test, expect } from "@/fixtures/collaboration.js";
import {
  inviteMember,
  membersDialog,
  memberRow,
} from "@/helpers/collaboration.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 60_000 });

test("an admin sees and cancels a pending invitation", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  await board.open(page);
  await inviteMember(page, partner.user.email, "Viewer");
  const dialog = membersDialog(page);

  const row = dialog
    .getByTestId("board-pending-row")
    .filter({ hasText: partner.user.email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Viewer");
  // A pending row is not an accepted member yet.
  await expect(memberRow(page, partner.user.email)).toHaveCount(0);

  const removed = page.waitForResponse(
    (response) =>
      response.url().includes(`/boards/${board.id}/members/`) &&
      response.request().method() === "DELETE",
  );
  await row.getByTestId("board-pending-cancel").click();
  expect((await removed).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
  expect(await partner.invitations()).toEqual([]);

  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
});
