import type { Locator, Page } from "@playwright/test";

import { test, expect, type BoardFixture } from "@/fixtures/board.js";
import { expectNoPageOverflow } from "@/helpers/touch.js";
import {
  openBoardSettings,
  saveWorkflow,
  showWorkflowMatrix,
} from "@/helpers/workflow.js";

/** Nine columns make the rail wider than every tested viewport. */
async function seedManyColumns(
  board: BoardFixture,
): Promise<{ ids: string[]; last: string }> {
  const ids: string[] = [];
  for (const title of [
    "Ideas",
    "Backlog",
    "Ready",
    "Doing",
    "Review",
    "QA",
    "Blocked",
    "Ship",
    "Done",
  ]) {
    ids.push(await board.column(title));
  }
  const last = ids[ids.length - 1]!;
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: ids[0]!,
      doneColumnIds: [last],
      transitions: ids.slice(0, -1).map((toColumnId, index) => ({
        id: `many-${index}`,
        fromColumnId: last,
        toColumnId,
      })),
    },
  });
  return { ids, last };
}

async function expectTabsDoNotOverlap(rail: Locator): Promise<void> {
  const tabs = rail.getByRole("tab");
  expect(await tabs.count()).toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const boxes = await tabs.evaluateAll((items) =>
          items.map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        );
        return boxes.every(
          (box, index) =>
            index === 0 || box.left >= boxes[index - 1]!.right - 0.5,
        );
      },
      { message: "rail tabs must not overlap" },
    )
    .toBe(true);
}

async function expectTabInsideRail(rail: Locator, tab: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const railBox = await rail.boundingBox();
        const tabBox = await tab.boundingBox();
        if (!railBox || !tabBox) return false;
        return (
          tabBox.x >= railBox.x - 1 &&
          tabBox.x + tabBox.width <= railBox.x + railBox.width + 1
        );
      },
      { message: "the tab must stay inside the rail viewport" },
    )
    .toBe(true);
}

/** Swipe across the rail through Chrome's touch transport. */
async function swipeRail(
  page: Page,
  rail: Locator,
  deltaX: number,
): Promise<void> {
  const box = await rail.boundingBox();
  if (!box) throw new Error("swipeRail: the rail is not visible");
  const startX = box.x + box.width * 0.8;
  const y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: startX + (deltaX * step) / 8,
            y,
            id: 1,
            radiusX: 1,
            radiusY: 1,
            force: 1,
          },
        ],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
  await page.waitForTimeout(150);
}

/**
 * Direction 01 «Рельс доски»: columns are the primary navigation, a rule is
 * configured from the list + inspector, and the full matrix stays one tab
 * away. These tests cover the new rail path and the 390 px layout.
 */
test("the rail opens a column, allows a rule and saves it", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const review = await board.column("Review");
  const done = await board.column("Done");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        { id: "doing-backlog", fromColumnId: doing, toColumnId: backlog },
        { id: "doing-review", fromColumnId: doing, toColumnId: review },
        { id: "review-done", fromColumnId: review, toColumnId: done },
      ],
    },
  });
  await board.open(page);

  const dialog = await openBoardSettings(page);
  await expect(dialog.getByTestId(`workflow-rail-${doing}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByText("Allowed from “Doing”")).toBeVisible();
  await expect(dialog.getByTestId("workflow-rules-count")).toHaveText("2 of 3");
  await expect(dialog.getByTestId("workflow-inspector-title")).toContainText(
    "Doing",
  );
  await expect(dialog.getByTestId("workflow-inspector-title")).toContainText(
    "Review",
  );

  await dialog.getByTestId(`workflow-allow-${done}`).click();
  await expect(dialog.getByTestId("workflow-inspector-title")).toContainText(
    "Done",
  );
  await saveWorkflow(page);
  await expect(page.getByTestId("board-settings-trigger")).toBeFocused();

  const reopened = await openBoardSettings(page);
  await expect(
    reopened.getByTestId(`workflow-row-switch-${done}`),
  ).toHaveAttribute("aria-checked", "true");
  await showWorkflowMatrix(page);
  await expect(
    reopened.getByTestId(`workflow-cell-${doing}-${done}`),
  ).toHaveAttribute("aria-pressed", "true");
});

test("wide screens fit the transition matrix next to its inspector", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1465, height: 1243 });
  for (const name of ["Backlog", "In progress", "Blocked", "Review", "Done"]) {
    await board.column(name);
  }
  await board.open(page);
  const dialog = await openBoardSettings(page);
  await showWorkflowMatrix(page);
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(1300);
  await expect(dialog.getByTestId("workflow-inspector")).toBeVisible();
  expect(
    await dialog.getByTestId("workflow-matrix-grid").evaluate((grid) => {
      const container = grid.parentElement;
      return (
        container !== null && container.scrollWidth <= container.clientWidth
      );
    }),
  ).toBe(true);
});

test("Escape on a dirty draft asks before closing", async ({ page, board }) => {
  await board.column("Backlog");
  const doing = await board.column("Doing");
  await board.open(page);

  const dialog = await openBoardSettings(page);
  await dialog.getByTestId(`workflow-allow-${doing}`).click();
  await expect(dialog.getByTestId("workflow-dirty")).toHaveText(
    "Unsaved changes",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByText("Discard workflow changes?")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("board-settings-trigger")).toBeFocused();
});

test("reduced motion removes rail and inspector transitions", async ({
  page,
  board,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await board.column("Backlog");
  await board.column("Doing");
  await board.open(page);

  const dialog = await openBoardSettings(page);
  const rail = dialog
    .getByTestId("workflow-rail")
    .locator('[role="tab"]')
    .first();
  const inspector = dialog.getByTestId("workflow-inspector");
  await expect(rail).toBeVisible();
  expect(
    await rail.evaluate(
      (element) => getComputedStyle(element).transitionProperty,
    ),
  ).toBe("none");
  expect(
    await inspector.evaluate(
      (element) => getComputedStyle(element).transitionProperty,
    ),
  ).toBe("none");
});

test("many columns stay reachable on desktop and mobile screens", async ({
  page,
  board,
}, testInfo) => {
  const { last } = await seedManyColumns(board);
  await board.open(page);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 800 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const dialog = await openBoardSettings(page);
    const rail = dialog.getByTestId("workflow-rail");
    const lastTab = dialog.getByTestId(`workflow-rail-${last}`);
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("tab")).toHaveCount(9);
    await expect(lastTab).toHaveAttribute("aria-selected", "true");

    // The rail is the horizontal scroller; the shell must not clip it and
    // the page must not gain a horizontal scrollbar.
    expect(
      await rail.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    await expectNoPageOverflow(page, `workflow rail ${viewport.width}`);
    await expectTabInsideRail(rail, lastTab);
    await expectTabsDoNotOverlap(rail);

    if (viewport.width === 390) {
      // A real touch swipe over the rail moves it and does not scroll the page.
      await rail.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await swipeRail(page, rail, -260);
      expect(
        await rail.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
    }

    // End from the first tab selects the last one and brings it into view.
    await rail.getByRole("tab").first().focus();
    await page.keyboard.press("End");
    await expect(lastTab).toBeFocused();
    await expect(lastTab).toHaveAttribute("aria-selected", "true");
    await expectTabInsideRail(rail, lastTab);
    await expectTabsDoNotOverlap(rail);

    await dialog.screenshot({
      path: testInfo.outputPath(`rail-${viewport.width}.png`),
      scale: "css",
    });
    await dialog.getByTestId("workflow-close").click();
    await expect(dialog).toBeHidden();
  }
});

test("the mobile dialog is full-screen, snap-scrolls the rail and keeps the page width", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const review = await board.column("Review");
  const done = await board.column("Done");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        { id: "doing-review", fromColumnId: doing, toColumnId: review },
        { id: "review-done", fromColumnId: review, toColumnId: done },
      ],
    },
  });
  await board.open(page);

  const dialog = await openBoardSettings(page);
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(388);

  const rail = dialog.getByTestId("workflow-rail");
  await expect(rail).toBeVisible();
  expect(
    await rail.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);

  await expect(dialog.getByTestId("workflow-inspector-toggle")).toBeVisible();
  await dialog.getByTestId("workflow-inspector-toggle").click();
  await expect(dialog.getByTestId("workflow-role-ADMIN")).toBeHidden();
  await dialog.getByTestId(`workflow-row-main-${review}`).click();
  await expect(dialog.getByTestId("workflow-role-ADMIN")).toBeVisible();

  const noPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noPageOverflow).toBe(true);
});
