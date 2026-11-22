import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../../fixtures/board.js";

/**
 * TASK-177.4 visual review: a 500-character unbroken task-spec item (a
 * sha256, a URL) and the claim pill must wrap inside the card dialog instead
 * of creating horizontal scroll. Checked at phone, tablet and both desktop
 * widths used by the review.
 */

const LONG_ITEM = "sha256:" + "a".repeat(493);

async function expectNoOwnOverflow(locator: Locator) {
  const metrics = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${await locator.getAttribute("data-testid")} overflows horizontally`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectNoPageOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px task spec layout`, () => {
    test.use({ viewport });

    test("wraps a 500-character item and the claim pill without horizontal scroll", async ({
      page,
      board,
    }) => {
      const todo = await board.column("Todo");
      const cardId = await board.card(todo, "Wrapping contract card");
      await board.command({
        type: "SET_CARD_TASK_SPEC",
        cardId,
        acceptanceCriteria: [LONG_ITEM],
        definitionOfDone: [LONG_ITEM],
      });
      await board.command({
        type: "CLAIM_CARD",
        cardId,
        claimedBy: board.userId,
        leaseUntil: Date.now() + 900_000,
      });

      await board.open(page);
      await page
        .getByTestId("card-title")
        .filter({ hasText: "Wrapping contract card" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Card details" });

      const done = dialog.getByTestId("card-task-spec-done");
      await expect(done).toContainText(LONG_ITEM);
      await expectNoOwnOverflow(done);
      await expectNoOwnOverflow(
        dialog.getByTestId("card-task-spec-acceptance"),
      );
      await expectNoOwnOverflow(dialog.getByTestId("card-claim"));
      await expectNoPageOverflow(page);

      const itemOverflow = await done
        .locator("li")
        .evaluateAll((items) =>
          items.some((item) => item.scrollWidth > item.clientWidth + 1),
        );
      expect(itemOverflow).toBe(false);
    });
  });
}
