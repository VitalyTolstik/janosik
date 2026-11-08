import { test, expect } from "@/fixtures/collaboration.js";
import { expectPresence } from "@/helpers/collaboration.js";
import { notification } from "@/helpers/history.js";
import { appUrl } from "@/helpers/urls.js";

test.describe.configure({ timeout: 90_000 });

test("a VIEWER whose deadline passes loses the open board without a reload", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  test.slow();
  await board.column("Todo");
  const expiresAt = new Date(Date.now() + 15_000).toISOString();
  await partner.invite("VIEWER", expiresAt);
  await partner.accept();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expectPresence(partnerBrowser.page, 2, 25_000);

  await expect(
    notification(
      partnerBrowser.page,
      "You no longer have access to this board",
    ),
  ).toBeVisible({ timeout: 45_000 });
  await expect(partnerBrowser.page).not.toHaveURL(
    new RegExp(`/board/${board.id}`),
  );
  await expect.poll(() => partner.role(), { timeout: 15_000 }).toBeUndefined();
  await expectPresence(page, 1, 15_000);

  await partnerBrowser.page.goto(new URL(`board/${board.id}`, appUrl).href);
  await expect(
    partnerBrowser.page.getByRole("heading", { name: "Board not found" }),
  ).toBeVisible();
});
