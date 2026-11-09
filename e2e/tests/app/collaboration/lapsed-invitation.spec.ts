import { test, expect } from "@/fixtures/collaboration.js";

test.describe.configure({ timeout: 60_000 });

test("a lapsed invitation disappears from the bell and cannot be accepted", async ({
  partner,
  partnerBrowser,
}) => {
  await partner.invite("VIEWER", new Date(Date.now() + 3_000).toISOString());
  const pending = await partner.invitations();
  expect(pending).toHaveLength(1);

  await partnerBrowser.page.waitForTimeout(4_000);
  await partnerBrowser.page.reload();
  await expect(
    partnerBrowser.page.getByTestId("notifications-bell"),
  ).toBeVisible();
  await expect(
    partnerBrowser.page.getByTestId("notifications-badge"),
  ).toHaveCount(0);

  const accepted = await partner.api.post(
    `/api/v1/invitations/${pending[0].id}/accept`,
  );
  expect(accepted.status()).toBe(409);
  expect(await partner.invitations()).toEqual([]);
  expect(await partner.role()).toBeUndefined();
});
