import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
  uniqueToken,
} from "@/helpers/admin.js";
import { waitForMessage } from "@/helpers/mail.js";

/** Global communications (TASK-162.15 full): one-off mail and templates. */

test("S17: a one-off email reaches Mailpit", async ({ page, admin }) => {
  const to = `${uniqueToken("one-off")}@e2e.example`;
  const subject = uniqueToken("comms-subject");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-email-to").fill(to);
  await page.getByTestId("admin-email-subject").fill(subject);
  await page.getByTestId("admin-email-body").fill("Hello from the E2E suite");
  await page.getByTestId("admin-email-send").click();
  await expectToast(page, "Email sent");

  const message = await waitForMessage(admin, { to, subjectIncludes: subject });
  expect(message.text).toContain("Hello from the E2E suite");
  await expectAudit(admin, { action: "email.sent" });
});

test("S19: saving and resetting a mail template restores the default", async ({
  page,
  admin,
}) => {
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("comms"), { waitUntil: "domcontentloaded" });
  const subject = page.getByTestId("admin-template-subject-verification_code");
  const body = page.getByTestId("admin-template-body-verification_code");
  const original = await subject.inputValue();
  try {
    await subject.fill(`Custom ${uniqueToken("subject")} {{code}}`);
    await body.fill("<p>Custom body {{code}}</p>");
    await page.getByTestId("admin-template-save-verification_code").click();
    await expectToast(page, "Template saved");
    await expect(page.getByText("custom", { exact: true })).toBeVisible();

    await page.getByTestId("admin-template-reset-verification_code").click();
    await expectToast(page, "Template reset");
    await expect(page.getByText("custom", { exact: true })).toHaveCount(0);
    await expect(subject).toHaveValue(original);
    expect(await subject.inputValue()).toContain("{{code}}");

    await expectAudit(admin, { action: "email.template_changed" });
    await expectAudit(admin, { action: "email.template_reset" });
  } finally {
    await admin.delete("/api/v1/admin/email-templates/verification_code");
  }
});
