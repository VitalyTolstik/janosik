import { test, expect, adminContext } from "@/fixtures/admin.js";
import {
  adminPath,
  createMasterViaAdmin,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/** Error states and concurrent admin sessions (audit extras ADM-X8/X9). */

test("ADM-X8: a failed list request shows the error state and Retry recovers", async ({
  page,
}) => {
  await loginAsMaster(page, ownerCredentials());
  let failing = true;
  await page.route("**/api/v1/admin/entities/users**", async (route) => {
    if (failing) {
      failing = false;
      await route.fulfill({ status: 500, body: "{}" });
    } else {
      await route.continue();
    }
  });
  await page.goto(adminPath("users"), { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Could not load the data")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-table-scroll")).toBeVisible();
});

test("ADM-X8: a failed board detail request recovers through Retry", async ({
  page,
  board,
}) => {
  await loginAsMaster(page, ownerCredentials());
  let failing = true;
  await page.route(`**/api/v1/admin/boards/${board.id}/meta`, async (route) => {
    if (failing) {
      failing = false;
      await route.fulfill({ status: 500, body: "{}" });
    } else {
      await route.continue();
    }
  });
  await page.goto(adminPath(`boards/${board.id}`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Could not load the data")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: board.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-board-detail-counters")).toBeVisible();
});

test("ADM-X9: logout in one admin tab does not sign out the other", async ({
  browser,
  admin,
  testIp,
}) => {
  // A fresh owner keeps the shared owner session (used by every parallel
  // test) out of the revoke below.
  const owner = await createMasterViaAdmin(admin, "OWNER");
  const first = await adminContext(browser, testIp);
  const second = await adminContext(browser, testIp);
  try {
    await loginAsMaster(first.page, owner);
    await loginAsMaster(second.page, owner);

    await first.page.getByTestId("admin-logout").click();
    await expect(first.page.getByTestId("admin-login-form")).toBeVisible();

    await second.page.reload({ waitUntil: "domcontentloaded" });
    await expect(second.page.getByTestId("admin-sidebar")).toBeVisible();

    const revoked = await admin.post(
      `/api/v1/admin/admins/${owner.id}/sessions/revoke`,
      { data: {} },
    );
    expect(revoked.ok(), await revoked.text()).toBeTruthy();

    await second.page.reload({ waitUntil: "domcontentloaded" });
    await expect(second.page.getByTestId("admin-login-form")).toBeVisible();
    await expectAudit(admin, {
      action: "admin.sessions_revoked",
      targetId: owner.id,
    });
  } finally {
    await first.context.close();
    await second.context.close();
  }
});
