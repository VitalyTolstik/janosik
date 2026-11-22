import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/account.js";
import { openAccount } from "@/helpers/account.js";

/**
 * The email-change code hint sits in a flex row next to an icon. The new
 * address must wrap inside the dialog rather than escape both edges.
 */
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

test("a long new address wraps in the email-change hint", async ({
  page,
  account,
}) => {
  const email = `change-${randomUUID()}@${"d".repeat(63)}.example`;
  await account.open(page);
  const dialog = await openAccount(page);
  await dialog.getByTestId("account-email-change").click();

  const change = page.getByTestId("email-change-dialog");
  await change.getByTestId("email-change-new").fill(email);
  await change.getByTestId("email-change-password").fill(account.user.password);
  await change.getByTestId("email-change-send").click();

  const hint = change.getByTestId("email-change-code-hint");
  await expect(change.getByTestId("email-change-code")).toBeVisible();
  await expect(hint).toContainText(email);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const metrics = await hint.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.documentWidth).toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );
    expect(metrics.clientWidth).toBeLessThan(metrics.viewportWidth);
  }
});
