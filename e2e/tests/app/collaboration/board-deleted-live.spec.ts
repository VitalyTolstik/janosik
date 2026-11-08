import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence } from "@/helpers/collaboration.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 90_000 });

test("an owner deleting the board closes a member's open view", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  test.slow();
  await board.column("Todo");
  await partner.invite("MEMBER");
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2);

  const deleted = await board.api.delete(`/api/v1/boards/${board.id}`);
  expect(deleted.ok()).toBeTruthy();

  await expect(
    partnerBrowser.page
      .getByRole("status")
      .filter({ hasText: /The board has been deleted|no longer have access/ }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(partnerBrowser.page).not.toHaveURL(
    new RegExp(`/board/${board.id}`),
  );

  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
});
