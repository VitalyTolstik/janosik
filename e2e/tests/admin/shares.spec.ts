import { test, expect } from "@/fixtures/admin.js";
import { appUrl } from "@/helpers/urls.js";
import {
  adminPath,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";
import { createShare } from "@/helpers/admin-content.js";

async function searchShares(
  page: import("@playwright/test").Page,
  value: string,
): Promise<void> {
  const settled = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname.includes("/admin/shares") &&
      url.searchParams.get("search") === value
    );
  });
  await page.getByRole("textbox", { name: "Search" }).fill(value);
  await settled;
}

/** Public shares (TASK-162.15 full): inspect, open, revoke, board-gone. */

test("S23: shares open, copy and revoke, and snapshots survive board deletion", async ({
  page,
  browser,
  admin,
  board,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const live = await createShare(board.api, board.id, "live");
  const snapshot = await createShare(board.api, board.id, "snapshot");

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("shares"), { waitUntil: "domcontentloaded" });
  await searchShares(page, board.title);

  const row = page
    .getByTestId("admin-shares-table")
    .getByRole("row")
    .filter({ hasText: `/s/${live.token}` });
  await expect(row).toContainText("Live");
  await expect(row).toContainText(/\d+/);

  await page.getByTestId(`admin-share-copy-${live.id}`).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(`/s/${live.token}`);

  const popupPromise = page.waitForEvent("popup");
  await row.getByRole("link", { name: "Open", exact: true }).click();
  const popup = await popupPromise;
  try {
    await popup.waitForLoadState("domcontentloaded");
    await expect(
      popup.getByRole("heading", { name: board.title, exact: true }),
    ).toBeVisible();
  } finally {
    await popup.close();
  }

  await page.getByTestId(`admin-share-revoke-${live.id}`).click();
  await expect(row).toContainText("revoked");
  await expectAudit(admin, { action: "share.revoked", targetId: live.id });

  const publicContext = await browser.newContext({ locale: "en-US" });
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(new URL(`s/${live.token}`, appUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      publicPage.getByText("This link slipped off the board", {
        exact: true,
      }),
    ).toBeVisible();

    const deleted = await admin.delete(`/api/v1/admin/boards/${board.id}`);
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
    await page.reload({ waitUntil: "domcontentloaded" });
    await searchShares(page, board.title);
    const gone = page
      .getByTestId("admin-shares-table")
      .getByRole("row")
      .filter({ hasText: `/s/${snapshot.token}` });
    await expect(gone).toContainText("board gone");

    await publicPage.goto(new URL(`s/${snapshot.token}`, appUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      publicPage.getByRole("heading", { name: board.title, exact: true }),
    ).toBeVisible();
  } finally {
    await publicContext.close();
  }
});
