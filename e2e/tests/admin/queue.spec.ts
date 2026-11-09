import { test, expect, adminContext } from "@/fixtures/admin.js";
import {
  adminPath,
  createMasterViaAdmin,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/** Queue dashboard (ADM-X13): the owner-only Bull Board surface. */

test("ADM-X13: the owner opens the queue dashboard and the operator cannot", async ({
  browser,
  page,
  admin,
  testIp,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("admin-ops-open-queues").click();
  const popup = await popupPromise;
  try {
    await expect(popup).toHaveURL(/\/api\/v1\/admin\/queues/);
    await expect(popup.locator("body")).toContainText(/Bull|Queue/i);
  } finally {
    await popup.close();
  }
  await expectAudit(admin, { action: "queue.ticket_issued" });

  const operator = await createMasterViaAdmin(admin);
  const operatorSide = await adminContext(browser, testIp);
  try {
    await loginAsMaster(operatorSide.page, operator);
    await operatorSide.page.goto(adminPath("ops"), {
      waitUntil: "domcontentloaded",
    });
    await expect(
      operatorSide.page.getByTestId("admin-ops-open-queues"),
    ).toBeDisabled();
  } finally {
    await operatorSide.context.close();
  }
});
