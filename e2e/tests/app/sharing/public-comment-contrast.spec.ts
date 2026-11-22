import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { test, expect, publicUrl } from "../../../fixtures/sharing.js";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

async function axeViolations(page: Page, selector: string) {
  await page.evaluate(axeSource as unknown as () => void);
  return page.evaluate(
    async ({ targetSelector }) => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Element,
              options: unknown,
            ) => Promise<{ violations: Array<{ id: string }> }>;
          };
        }
      ).axe;
      const target = document.querySelector(targetSelector);
      if (target === null)
        throw new Error(`axe target missing: ${targetSelector}`);
      const results = await axe.run(target, {
        rules: { "color-contrast": { enabled: true } },
      });
      return results.violations.map((violation) => violation.id);
    },
    { targetSelector: selector },
  );
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("public comment avatars pass dark 390 px contrast", async ({
  page,
  browser,
  sharing,
}) => {
  const profile = await sharing.api.patch("/api/v1/users/me", {
    data: { avatarColor: "primary" },
  });
  expect(profile.status(), await profile.text()).toBe(200);
  const comment = await sharing.api.post(
    `/api/v1/cards/${sharing.cardId}/comments`,
    { data: { text: "A shared comment" } },
  );
  expect(comment.status(), await comment.text()).toBe(201);
  const share = await sharing.createShare("live", { includeComments: true });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem("janosik-theme", "dark");
    });
    const visitor = await context.newPage();
    await visitor.goto(publicUrl(share.token));
    await expect(visitor.locator("html")).toHaveClass(/dark/);
    await visitor
      .getByTestId("card-title")
      .filter({ hasText: "Original card" })
      .click();
    await expect(visitor.getByTestId("public-comments")).toContainText(
      "A shared comment",
    );
    await expect(visitor.getByTestId("public-avatar").first()).toHaveClass(
      /(?:^|\s)bg-primary(?:\s|$)/,
    );
    expect(
      await axeViolations(visitor, '[data-testid="public-comments"]'),
    ).toEqual([]);
  } finally {
    await context.close();
  }
});
