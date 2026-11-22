import { randomUUID } from "node:crypto";
import { test, expect, password } from "../../../fixtures/auth.js";
import { appUrl } from "../../../helpers/urls.js";

/**
 * The verification subtitle is a flex item in a centered column. A long
 * unbroken address must still wrap inside the card instead of widening the
 * line box past both viewport edges.
 */
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

test("a long verification address wraps inside the card", async ({ page }) => {
  const email = `verify-${randomUUID()}@${"d".repeat(63)}.example`;
  await page.goto(appUrl);
  await page.getByTestId("login-toggle").click();
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();

  const subtitle = page.getByTestId("email-verify-subtitle");
  await expect(page.getByTestId("email-verify-code")).toBeVisible();
  await expect(subtitle).toContainText(email);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const metrics = await subtitle.evaluate((element) => {
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
