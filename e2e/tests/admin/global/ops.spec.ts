import { test, expect } from "@/fixtures/admin.js";
import { siteUrl } from "@/helpers/urls.js";
import {
  adminPath,
  confirmAction,
  createUserViaAdmin,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";
import { ageDeletedCard } from "@/helpers/disposable-database.js";

/** Global operations (TASK-162.15 full + ADM-X5); every toggle is restored. */

async function userToken(
  playwright: typeof import("playwright-core"),
  email: string,
  password: string,
): Promise<string> {
  const client = await playwright.request.newContext({ baseURL: siteUrl });
  try {
    const response = await client.post("/api/v1/auth/login", {
      data: { email, password },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return ((await response.json()) as { accessToken: string }).accessToken;
  } finally {
    await client.dispose();
  }
}

async function flags(admin: import("@playwright/test").APIRequestContext) {
  const response = await admin.get("/api/v1/admin/flags");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ key: string; enabled: boolean }>;
}

test("S8: registration_open toggles and survives reload", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
  const toggle = page.getByRole("switch", { name: "Open registration" });
  try {
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expectToast(page, "Saved");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("switch", { name: "Open registration" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      (await flags(admin)).find((flag) => flag.key === "registration_open")
        ?.enabled,
    ).toBe(false);
  } finally {
    await admin.patch("/api/v1/admin/flags/registration_open", {
      data: { enabled: true },
    });
  }
  await expectAudit(admin, { action: "flag.changed" });
});

test("S9: maintenance mode blocks users but keeps the panel alive", async ({
  page,
  admin,
  playwright,
}) => {
  const password = "e2e-maintenance-123";
  const user = await createUserViaAdmin(admin, { verified: true, password });
  const token = await userToken(playwright, user.email, password);
  const api = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
    const toggle = page.getByRole("switch", { name: "Maintenance mode" });
    await toggle.click();
    await expectToast(page, "Maintenance mode on");
    expect((await api.get("/api/v1/boards")).status()).toBe(503);

    await page.goto(adminPath(), { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Master panel", exact: true }),
    ).toBeVisible();

    await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
    await page.getByRole("switch", { name: "Maintenance mode" }).click();
    await expectToast(page, "Maintenance mode off");
    expect((await api.get("/api/v1/boards")).status()).toBe(200);
    await expectAudit(admin, { action: "ops.settings_changed" });
  } finally {
    await admin.put("/api/v1/admin/ops", {
      data: { maintenanceMode: false },
    });
    await api.dispose();
  }
});

test("S10: a per-user rate limit returns 429 until it is cleared", async ({
  page,
  admin,
  playwright,
}) => {
  const password = "e2e-ratelimit-123";
  const user = await createUserViaAdmin(admin, { verified: true, password });
  const token = await userToken(playwright, user.email, password);
  const api = await playwright.request.newContext({
    baseURL: siteUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    await loginAsMaster(page, ownerCredentials());
    await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
    await page.getByTestId("admin-ops-peruser").fill("2");
    await page.getByTestId("admin-ops-rate-limit-save").click();
    await expectToast(page, "Saved");
    // The interceptor caches the setting for up to five seconds.
    await page.waitForTimeout(5_500);

    expect((await api.get("/api/v1/boards")).status()).toBe(200);
    expect((await api.get("/api/v1/boards")).status()).toBe(200);
    expect((await api.get("/api/v1/boards")).status()).toBe(429);
  } finally {
    await admin.put("/api/v1/admin/ops", { data: { perUserRateLimit: null } });
  }
  await page.waitForTimeout(5_500);
  expect((await api.get("/api/v1/boards")).status()).toBe(200);
  await api.dispose();
});

test("S11: retention purge removes an aged soft-deleted card", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column("Retention column");
  const cardId = await board.card(columnId, "Retention card");
  const deleted = await admin.delete(`/api/v1/admin/cards/${cardId}`);
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
  await ageDeletedCard(cardId, 10);

  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
  try {
    await page.getByTestId("admin-ops-retention").fill("1");
    await page.getByTestId("admin-ops-retention-save").click();
    await expectToast(page, "Saved");
    await page.reload({ waitUntil: "domcontentloaded" });
    const text = await page
      .getByText(/cards · .*comments · .*attachments · .*columns/)
      .textContent();
    const cards = Number(text?.match(/(\d+) cards/)?.[1] ?? "0");
    expect(cards).toBeGreaterThan(0);

    await page.getByTestId("admin-ops-purge").click();
    await confirmAction(page);
    await expectToast(page, "Purged");
    await page.reload({ waitUntil: "domcontentloaded" });
    const after = await page
      .getByText(/cards · .*comments · .*attachments · .*columns/)
      .textContent();
    expect(Number(after?.match(/(\d+) cards/)?.[1] ?? "0")).toBe(0);
    await expectAudit(admin, { action: "retention.changed" });
  } finally {
    await admin.put("/api/v1/admin/ops", { data: { retentionDays: 30 } });
  }
});

test("S12: run sweeps and persist the schedule interval", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
  try {
    await page.getByTestId("admin-ops-run-sweeps").click();
    await expect(
      page.getByRole("status").filter({ hasText: /queued|Removed/ }),
    ).toBeVisible();

    await page.getByTestId("admin-ops-maintenance-interval").fill("5");
    await page.getByTestId("admin-ops-schedule-save").click();
    await expectToast(page, "Saved");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByTestId("admin-ops-maintenance-interval"),
    ).toHaveValue("5");
    await expectAudit(admin, { action: "maintenance.run" });
    await expectAudit(admin, { action: "ops.settings_changed" });
  } finally {
    await admin.put("/api/v1/admin/ops", {
      data: { maintenanceIntervalMinutes: 0 },
    });
  }
});

test("ADM-X5: all four flags toggle and the maintenance message persists", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("ops"), { waitUntil: "domcontentloaded" });
  const names = [
    "Open registration",
    "Public board shares",
    "Video compression",
    "Realtime updates",
  ];
  try {
    for (const name of names) {
      const toggle = page.getByRole("switch", { name });
      const before = await toggle.getAttribute("aria-checked");
      await toggle.click();
      await expect(toggle).toHaveAttribute(
        "aria-checked",
        before === "true" ? "false" : "true",
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");
    }

    const message = `Maintenance ${Date.now()}`;
    await page.getByTestId("admin-ops-message").fill(message);
    await page.getByTestId("admin-ops-save").click();
    await expectToast(page, "Saved");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-ops-message")).toHaveValue(message);
    expect((await flags(admin)).map((flag) => flag.key)).toEqual(
      expect.arrayContaining([
        "registration_open",
        "public_shares",
        "video_transcode",
        "realtime_sse",
      ]),
    );
  } finally {
    await admin.put("/api/v1/admin/ops", {
      data: { maintenanceMessage: null },
    });
  }
});
