import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

/** Global traffic limit (TASK-162.15 full); restored in `finally`. */

test("S6: saving a rate limit updates the gauge and the API source", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("traffic"), { waitUntil: "domcontentloaded" });
  try {
    await page.getByTestId("admin-traffic-limit-input").fill("1234");
    await page.getByTestId("admin-traffic-save").click();
    await expect(page.getByTestId("admin-traffic-limit")).toHaveText("1234");

    const settings = await admin.get("/api/v1/admin/throttle-settings");
    expect(settings.ok()).toBeTruthy();
    const body = (await settings.json()) as { limit: number; source: string };
    expect(body.limit).toBe(1234);
    expect(body.source).toBe("db");
    await expectAudit(admin, { action: "throttle.settings_changed" });
  } finally {
    await admin.put("/api/v1/admin/throttle-settings", {
      data: { limit: 300 },
    });
  }
});
