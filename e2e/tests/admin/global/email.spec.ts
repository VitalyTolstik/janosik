import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
  uniqueToken,
} from "@/helpers/admin.js";
import { waitForMessage } from "@/helpers/mail.js";

/**
 * Global email transport (TASK-162.15 full). Serial: test delivery runs while
 * the SMTP_* env bootstrap is still active; saving the sandbox preset is the
 * last test in its own disposable stack because it overrides env forever.
 */
test.describe.configure({ mode: "serial" });

test("S3: test delivery reaches Mailpit and records the probe", async ({
  page,
  admin,
}) => {
  const to = `${uniqueToken("probe")}@e2e.example`;
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("email"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-email-test-to").fill(to);
  await page.getByTestId("admin-email-test-send").click();
  await expect(page.getByTestId("admin-email-test-ok")).toBeVisible();
  // The env bootstrap has no settings row to annotate, so LastProbe only
  // appears after a DB-saved transport; the delivered letter is the proof.
  await expect(page.getByTestId("admin-email-status")).toContainText(
    "env bootstrap",
  );

  const message = await waitForMessage(admin, { to });
  expect(message.subject).toMatch(/Janosik/i);
  await expectAudit(admin, { action: "email.test_sent" });
});

test("ADM-X3: a saved but disabled transport reports delivery off", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("email"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-email-preset-mailpit").click();
  const enabled = page.getByTestId("admin-email-enabled");
  if (await enabled.isChecked()) await enabled.click();
  await page.getByTestId("admin-email-save").click();
  await expect(page.getByTestId("admin-email-status")).toContainText(
    "Delivery is off",
  );
  await expectAudit(admin, { action: "email.settings_changed" });
});

test("S2: saving the sandbox preset makes it the active transport", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("email"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-email-preset-mailpit").click();
  const enabled = page.getByTestId("admin-email-enabled");
  if (!(await enabled.isChecked())) await enabled.click();
  await page.getByTestId("admin-email-save").click();
  await expect(page.getByTestId("admin-email-status")).toContainText("Mailpit");
  await expect(page.getByTestId("admin-email-status")).toContainText(
    "localhost",
  );
  await expectAudit(admin, { action: "email.settings_changed" });
});
