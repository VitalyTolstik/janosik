import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Locator, Page } from "@playwright/test";

import { test, expect, loginMasterApi } from "@/fixtures/admin.js";
import { cardDialog, openCard } from "@/helpers/history.js";
import { appUrl } from "@/helpers/urls.js";

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
    const snapshot = dialog.getByTestId("comment-history-snapshot-1");
    await expect(snapshot).toBeVisible();
    const snapshotAfter = dialog.getByTestId(
      "comment-history-snapshot-after-1",
    );
    await expect(snapshotAfter).toContainText("x".repeat(600));
    expect(await snapshotAfter.textContent()).toBe(longAfter);

    // The expanded scroll region is itself keyboard reachable and axe-clean.
    await expectAxeClean(page, "history snapshot at 390");
    await snapshot.focus();
    const scrollBefore = await snapshot.evaluate(
      (element) => element.scrollTop,
    );
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => snapshot.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(scrollBefore);

    // Escape closes only the history overlay, not the card dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cardDialog(page)).toBeVisible();
    await expect(trigger).toBeFocused();

    // The card History view at the same width: the long multi-line edit is
    // escaped, wrapped and paged inside the viewport.
    await cardDialog(page).getByTestId("activity-tab-history").click();
    const historyEntry = cardDialog(page)
      .getByTestId("history-entry")
      .filter({ hasText: "Edited a comment" })
      .first();
    await expect(historyEntry).toBeVisible();
    const diff = historyEntry.getByTestId("history-diff");
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("Line two");
    expect(
      await historyEntry.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await cardDialog(page).evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("renders the revision list in Russian", async ({ page, board }) => {
    const column = await board.column("История");
    const cardId = await board.card(column, "Русская история");
    const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: "Первый текст" },
    });
    const commentId = ((await created.json()) as { id: string }).id;
    expect(
      (
        await board.api.patch(`/api/v1/comments/${commentId}`, {
          data: { text: "Второй текст" },
        })
      ).ok(),
    ).toBeTruthy();

    await board.open(page);
    await page.goto(new URL(`board/${board.id}?lng=ru`, appUrl).href);
    await page
      .getByTestId("card-title")
      .filter({ hasText: "Русская история" })
      .click();
    const card = page.getByRole("dialog", { name: "Детали карточки" });
    await expect(card).toBeVisible();
    const row = card.locator(
      `[data-testid="comment"][data-comment-id="${commentId}"]`,
    );
    await expect(row.getByTestId("comment-edited")).toContainText("изменён");
    await row.getByTestId("comment-edited").click();
    const dialog = commentHistory(page);
    await expect(
      page.getByRole("dialog", { name: "История правок" }),
    ).toBeVisible();
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(1);
    await expect(dialog).toContainText("Правка 1");
    await expect(dialog).toContainText("Редактор");
    await expect(dialog).toContainText("Было");
    await expect(dialog).toContainText("Стало");
    // A complete chain carries no release/cutover banner.
    await expect(dialog.getByTestId("comment-history-banner")).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("live comment history in a second tab", () => {
  test("refreshes the row, History and open revisions on edit; delete clears them", async ({
    page,
    board,
    operator,
    testIp,
    playwright,
  }) => {
    const column = await board.column("Live");
    const cardId = await board.card(column, "Live history");
    const created = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
      data: { text: "Live first" },
    });
    expect(created.status()).toBe(201);
    const commentId = ((await created.json()) as { id: string }).id;
    expect(
      (
        await board.api.patch(`/api/v1/comments/${commentId}`, {
          data: { text: "Live second" },
        })
      ).ok(),
    ).toBeTruthy();

    await board.open(page);
    await openCard(page, "Live history");
    const row = cardDialog(page).locator(
      `[data-testid="comment"][data-comment-id="${commentId}"]`,
    );
    await row.getByTestId("comment-edited").click();
    const dialog = commentHistory(page);
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(1);

    // A second tab on the same account: its edit reaches the open row and
    // marks the open revision list stale instead of silently shifting it.
    const second = await page.context().newPage();
    await second.goto(page.url());
    await expect(
      second.getByRole("button", { name: "Switch board" }),
    ).toBeVisible();
    expect(
      (
        await board.api.patch(`/api/v1/comments/${commentId}`, {
          data: { text: "Live third from the other tab" },
        })
      ).ok(),
    ).toBeTruthy();
    await expect(row).toContainText("Live third from the other tab");
    await expect(dialog.getByTestId("comment-history-stale")).toBeVisible();
    await dialog.getByTestId("comment-history-refresh").click();
    await expect(dialog.getByTestId("comment-history-revision")).toHaveCount(2);

    // Author delete cleans the row and closes the open list.
    expect(
      (await board.api.delete(`/api/v1/comments/${commentId}`)).ok(),
    ).toBeTruthy();
    await expect(dialog).toBeHidden();
    await expect(row).toBeHidden();
    await second.close();

    // A master delete is published without attribution; the open list still
    // closes and the row disappears for an ordinary member tab.
    const secondComment = await board.api.post(
      `/api/v1/cards/${cardId}/comments`,
      { data: { text: "Master will remove" } },
    );
    const secondId = ((await secondComment.json()) as { id: string }).id;
    expect(
      (
        await board.api.patch(`/api/v1/comments/${secondId}`, {
          data: { text: "Master will remove, edited" },
        })
      ).ok(),
    ).toBeTruthy();
    const secondRow = cardDialog(page).locator(
      `[data-testid="comment"][data-comment-id="${secondId}"]`,
    );
    await secondRow.getByTestId("comment-edited").click();
    await expect(dialog).toBeVisible();
    const master = await loginMasterApi(playwright, operator, testIp);
    try {
      expect(
        (await master.delete(`/api/v1/admin/comments/${secondId}`)).ok(),
      ).toBeTruthy();
    } finally {
      await master.dispose();
    }
    await expect(dialog).toBeHidden();
    await expect(secondRow).toBeHidden();
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
