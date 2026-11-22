import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Locator, Page } from "@playwright/test";

import { test, expect } from "@/fixtures/board.js";
import { cardDialog, openCard } from "@/helpers/history.js";

/**
 * TASK-185.4 card-facing edit history. The backend writer is covered by
 * 185.1; these checks open the real revisions overlay at the two narrow
 * widths, verify the cursor paging and full snapshot, run axe in light/dark,
 * and make sure Escape closes only the history layer and returns focus to the
 * “Edited” trigger.
 */

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

type AxeViolation = {
  id: string;
  nodes: Array<{ target: Array<string | string[]> }>;
};

function commentHistory(page: Page): Locator {
  return page.getByTestId("comment-history-dialog");
}

async function expectAxeClean(page: Page, label: string): Promise<void> {
  await page.evaluate(axeSource as unknown as () => void);
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Element,
            options: unknown,
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }
    ).axe;
    const target = document.querySelector(
      '[data-testid="comment-history-dialog"]',
    );
    if (!target) throw new Error("comment history dialog is not open");
    const results = await axe.run(target, {
      rules: { "color-contrast": { enabled: true } },
    });
    return results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );
  });
  expect(violations, label).toEqual([]);
}

test.describe("comment edit history at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("opens, fits, shows the full snapshot and closes with focus return", async ({
    page,
    board,
  }) => {
    const column = await board.column("History");
    const cardId = await board.card(column, "Narrow history");
    const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: "First draft" },
    });
    expect(created.status()).toBe(201);
    const commentId = ((await created.json()) as { id: string }).id;

    const longAfter = `Line one\nLine two ${"x".repeat(600)}`;
    const firstEdit = await board.api.patch(`/api/v1/comments/${commentId}`, {
      data: { text: longAfter },
    });
    expect(firstEdit.ok()).toBeTruthy();
    const secondEdit = await board.api.patch(`/api/v1/comments/${commentId}`, {
      data: { text: "Final wording" },
    });
    expect(secondEdit.ok()).toBeTruthy();

    await board.open(page);
    await openCard(page, "Narrow history");
    const row = cardDialog(page).locator(
      `[data-testid="comment"][data-comment-id="${commentId}"]`,
    );
    const trigger = row.getByTestId("comment-edited");
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(
      triggerBox?.width ?? 0,
      "edited trigger width",
    ).toBeGreaterThanOrEqual(44);
    expect(
      triggerBox?.height ?? 0,
      "edited trigger height",
    ).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const dialog = commentHistory(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(2);
    await expectAxeClean(page, "history dialog light at 390");

    // Both the dialog and the page stay inside the 390 px viewport.
    const box = await dialog.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(391);
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow, "history dialog horizontal overflow").toBeLessThanOrEqual(
      1,
    );
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(pageOverflow, "page horizontal overflow").toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      localStorage.setItem("janosik-theme", "dark");
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    });
    await expectAxeClean(page, "history dialog dark at 390");
    await page.evaluate(() => {
      localStorage.setItem("janosik-theme", "light");
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    });

    // A truncated diff still reaches the complete saved version.
    await dialog.getByTestId("comment-history-snapshot-toggle-1").click();
    await expect(
      dialog.getByTestId("comment-history-snapshot-1"),
    ).toBeVisible();
    const snapshotAfter = dialog.getByTestId(
      "comment-history-snapshot-after-1",
    );
    await expect(snapshotAfter).toContainText("x".repeat(600));
    expect(await snapshotAfter.textContent()).toBe(longAfter);

    // Escape closes only the history overlay, not the card dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cardDialog(page)).toBeVisible();
    await expect(trigger).toBeFocused();
  });
});

test.describe("comment edit history at 768 px", () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test("pages older revisions with the cursor and reaches the end", async ({
    page,
    board,
  }) => {
    const column = await board.column("History");
    const cardId = await board.card(column, "Paged history");
    const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: "Revision 1" },
    });
    expect(created.status()).toBe(201);
    const commentId = ((await created.json()) as { id: string }).id;

    // 22 further edits produce 22 revisions: one full 20-row page and one
    // older page. The last text proves the newest revision sorts first.
    for (let number = 2; number <= 23; number += 1) {
      const edited = await board.api.patch(`/api/v1/comments/${commentId}`, {
        data: { text: `Revision ${number}` },
      });
      expect(edited.status()).toBe(200);
    }

    await board.open(page);
    await openCard(page, "Paged history");
    const row = cardDialog(page).locator(
      `[data-testid="comment"][data-comment-id="${commentId}"]`,
    );
    await row.getByTestId("comment-edited").click();

    const dialog = commentHistory(page);
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(
      20,
    );
    await expectAxeClean(page, "history dialog at 768");
    const newest = dialog.getByTestId("comment-history-revision").first();
    await expect(newest).toHaveAttribute("data-revision-number", "22");
    await expect(newest).toContainText("Revision 23");
    const toggle = dialog.getByTestId("comment-history-snapshot-toggle-22");
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const closeBox = await dialog.getByTestId("dialog-close").boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Keyboard paging: the last page replaces the button, so focus must land
    // on the end marker instead of falling back to the document body.
    const older = dialog.getByTestId("comment-history-show-older");
    await older.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(
      22,
    );
    await expect(dialog.getByTestId("comment-history-show-older")).toHaveCount(
      0,
    );
    const end = dialog.getByTestId("comment-history-end");
    await expect(end).toBeVisible();
    await expect(end).toBeFocused();

    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId("comment-edited")).toBeFocused();
  });
});
