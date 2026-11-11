import { test, expect } from "@/fixtures/board.js";
import {
  openBoardSettings,
  saveWorkflow,
  showWorkflowMatrix,
} from "@/helpers/workflow.js";

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
