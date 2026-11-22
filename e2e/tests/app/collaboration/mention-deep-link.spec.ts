import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test, type BoardFixture } from "@/fixtures/board.js";
import { appUrl } from "@/helpers/urls.js";

/**
 * TASK-177.12 UI review — a mention deep link must land the target comment
 * fully inside the dialog's scroll viewport at every review width, even when
 * the comment is on page 2 and a kind filter is active. The same browser pass
 * checks the focused mention row and the picker rows with real colour
 * contrast, which jsdom cannot measure.
 */

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function seedThread(
  board: BoardFixture,
  count = 55,
): Promise<{ cardId: string; targetId: string }> {
  const column = await board.column("Comments");
  const cardId = await board.card(column, "Mentioned thread");
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = index === 0;
    const response = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: {
        text: target
          ? `Target [@Owner](https://janosik.invalid/mention/${board.userId})`
          : `Comment ${index + 1}`,
        ...(target ? { kind: "blocker" } : { kind: "note" }),
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return { cardId, targetId: ids[0]! };
}

/** Fully within the dialog scroller with a 12 px comfortable margin. */
async function expectRowInsideScroller(row: ReturnType<Page["locator"]>) {
  await expect
    .poll(async () =>
      row.evaluate((element) => {
        let scroller = element.parentElement;
        while (scroller !== null) {
          const style = getComputedStyle(scroller);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            scroller.scrollHeight > scroller.clientHeight
          ) {
            break;
          }
          scroller = scroller.parentElement;
        }
        if (scroller === null) return false;
        const rowRect = element.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const margin = 12;
        return (
          rowRect.top >= scrollerRect.top + margin - 1 &&
          rowRect.bottom <= scrollerRect.bottom - margin + 1
        );
      }),
    )
    .toBe(true);
}

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

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px mention deep link`, () => {
    test.use({
      viewport,
      hasTouch: viewport.width === 390,
      isMobile: viewport.width === 390,
    });

    test("centers a page-2 target after resetting the active kind filter", async ({
      page,
      board,
    }) => {
      const { cardId, targetId } = await seedThread(board);
      await board.open(page);
      await page.goto(new URL(`board/${board.id}?card=${cardId}`, appUrl).href);
      const dialog = page.getByRole("dialog", { name: "Card details" });
      await expect(dialog.getByTestId("comment")).toHaveCount(50);

      await dialog.getByTestId("comment-filter-note").click();
      await expect(dialog.getByTestId("comment-filter-note")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // SPA navigation, so the active filter is still present when the
      // focus id arrives (a reload would reset it and hide the bug).
      await page.evaluate(
        ({ boardPath, cardId: targetCard, commentId }) => {
          const url = new URL(window.location.href);
          url.pathname = boardPath;
          url.searchParams.set("card", targetCard);
          url.searchParams.set("comment", commentId);
          window.history.pushState(null, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        },
        {
          boardPath: new URL(`board/${board.id}`, appUrl).pathname,
          cardId,
          commentId: targetId,
        },
      );

      const row = dialog.locator(`[data-comment-id="${targetId}"]`);
      await expect(row).toBeVisible();
      await expect(dialog.getByTestId("comment-filter-all")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(row).toBeFocused();
      await expectRowInsideScroller(row);

      // A live resize must not leave the focused target clipped.
      await page.setViewportSize({
        width: Math.max(360, viewport.width - 80),
        height: Math.max(640, viewport.height - 120),
      });
      await expect(row).toBeFocused();
      await expectRowInsideScroller(row);
    });

    test("keeps the focused mention row and picker rows at AA contrast", async ({
      page,
      board,
    }) => {
      const { cardId, targetId } = await seedThread(board, 1);
      await board.open(page);
      await page.goto(
        new URL(`board/${board.id}?card=${cardId}&comment=${targetId}`, appUrl)
          .href,
      );
      const dialog = page.getByRole("dialog", { name: "Card details" });
      await expect(
        dialog.locator(`[data-comment-id="${targetId}"]`),
      ).toBeVisible();

      expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);

      const editor = dialog
        .getByTestId("comment-input")
        .locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("@");
      // The picker is portalled to document.body, outside the dialog node.
      await expect(page.getByTestId("mention-picker")).toBeVisible();
      expect(
        await axeViolations(page, '[data-testid="mention-picker"]'),
      ).toEqual([]);
    });
  });
}
