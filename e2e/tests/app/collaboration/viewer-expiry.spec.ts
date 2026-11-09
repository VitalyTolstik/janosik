import { test, expect } from "@/fixtures/collaboration.js";
import { memberRow, openMembers } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 60_000 });

function patchCount(page: import("@playwright/test").Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/members/")) {
      count += 1;
    }
  });
  return () => count;
}

test("an admin sets and clears a VIEWER access deadline", async ({
  page,
  board,
  partner,
}) => {
  await partner.invite("VIEWER");
  await partner.accept();
  await board.open(page);
  const dialog = await openMembers(page);
  const row = memberRow(page, partner.user.email);
  const trigger = row.getByTestId("expiry-trigger");
  await expect(trigger).toContainText("no expiry");
  await expect(row).toContainText("no expiry");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.toLocaleDateString("en-US");
  await trigger.click();
  const picker = page.getByTestId("expiry-calendar");
  await expect(picker).toBeVisible();
  if (tomorrow.getMonth() !== new Date().getMonth()) {
    await picker.getByRole("button", { name: /next month/i }).click();
  }
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/members/") &&
      (response.request().postDataJSON() as { expiresAt?: string })
        .expiresAt !== undefined,
  );
  await page
    .locator(`[data-slot="calendar"] button[data-day="${day}"]`)
    .click();
  const patch = await saved;
  expect(patch.ok()).toBeTruthy();
  const body = patch.request().postDataJSON() as { expiresAt: string };
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  await page.keyboard.press("Escape");

  await expect(trigger).not.toContainText("no expiry");
  await expect(row).toContainText("until");
  await expect(dialog).toBeVisible();

  // Reopening the dialog reads the deadline back from the server.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const reopened = await openMembers(page);
  const reopenedRow = memberRow(page, partner.user.email);
  await expect(reopenedRow.getByTestId("expiry-trigger")).not.toContainText(
    "no expiry",
  );
  await expect(reopenedRow).toContainText("until");

  await reopenedRow.getByTestId("expiry-trigger").click();
  await expect(page.getByTestId("expiry-calendar")).toBeVisible();
  const cleared = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/members/") &&
      (response.request().postDataJSON() as { expiresAt?: string | null })
        .expiresAt === null,
  );
  await page.getByTestId("expiry-clear").click();
  const clearedResponse = await cleared;
  expect(clearedResponse.ok()).toBeTruthy();
  await expect(reopenedRow).toContainText("no expiry");
  await page.keyboard.press("Escape");

  const patches = patchCount(page);
  // Cancelling the calendar is not a write.
  await reopenedRow.getByTestId("expiry-trigger").click();
  await expect(page.getByTestId("expiry-calendar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reopened).toBeVisible();
  await page.waitForTimeout(300);
  expect(patches()).toBe(0);
});
