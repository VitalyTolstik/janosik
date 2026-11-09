import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  confirmAction,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/** Global demo runner (TASK-162.15 full); always stopped in `finally`. */

test("S7: the demo starts, exposes its live view and cleans up on stop", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("demo"), { waitUntil: "domcontentloaded" });
  let boardId = "";
  try {
    await page.getByTestId("admin-demo-agents-input").fill("2");
    await page.getByTestId("admin-demo-cards-input").fill("2");
    await page.getByTestId("admin-demo-start").click();
    await expect(page.getByTestId("admin-demo-status")).toHaveText("Running");
    boardId = (await page.getByTestId("admin-demo-board").textContent()) ?? "";
    expect(boardId).toMatch(/[a-z0-9]/i);
    await expect(page.getByTestId("admin-demo-agents")).not.toHaveText("0");
    await expect(page.getByTestId("admin-demo-cards")).not.toHaveText("0");
    await expect(page.getByTestId("admin-demo-live-view")).toBeVisible();

    await page.getByTestId("admin-demo-stop").click();
    await confirmAction(page);
    await expect(page.getByTestId("admin-demo-status")).toHaveText("Idle");
    await expectAudit(admin, { action: "demo.started" });
    await expectAudit(admin, { action: "demo.stopped" });

    const board = await admin.get(`/api/v1/admin/boards/${boardId}/meta`);
    expect(board.status()).toBe(404);
  } finally {
    if (boardId !== "") {
      await admin.post("/api/v1/admin/demo/stop", { data: {} });
    }
  }
});
