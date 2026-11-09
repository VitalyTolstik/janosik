import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import {
  allowTransition,
  openBoardSettings,
  saveWorkflow,
} from "@/helpers/workflow.js";
import { columnSection, cardTitle } from "@/helpers/history.js";

/**
 * Board ADMIN's workflow editor: enable control, build the matrix, add a
 * condition, save, and see the same rules after a reload.
 */
test("configure transitions, save them and keep them after reload", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Workflow task");
  await board.open(page);

  const dialog = await openBoardSettings(page);
  await expect(dialog.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await dialog.getByTestId("workflow-enabled").click();
  await expect(dialog.getByTestId("workflow-error")).toBeVisible();

  await dialog.getByTestId(`workflow-cell-${backlog}-${doing}`).click();
  await dialog.getByTestId(`workflow-cell-${doing}-${done}`).click();
  // The second click selects the edge added by the first one.
  await dialog.getByTestId("workflow-condition-requireChecklistsDone").click();
  await dialog.getByTestId("workflow-reverse").click();
  await saveWorkflow(page);

  await page.reload();
  const reopened = await openBoardSettings(page);
  await expect(reopened.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    reopened.getByTestId(`workflow-cell-${backlog}-${doing}`),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    reopened.getByTestId(`workflow-cell-${doing}-${done}`),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    reopened.getByTestId(`workflow-cell-${done}-${doing}`),
  ).toHaveAttribute("aria-pressed", "true");
});

test("disabling control keeps the matrix but allows every move", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Free move");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        { id: "backlog-doing", fromColumnId: backlog, toColumnId: doing },
      ],
    },
  });
  await board.open(page);

  const dialog = await openBoardSettings(page);
  await dialog.getByTestId("workflow-enabled").click();
  await saveWorkflow(page);

  await expect(
    columnSection(page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Free move");
  await page.reload();
  const reopened = await openBoardSettings(page);
  await expect(reopened.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await allowTransition(page, backlog, doing);
  await expect(
    reopened.getByTestId(`workflow-cell-${backlog}-${doing}`),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a legacy board without a workflow allows any drag", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const done = await board.column("Done");
  await board.card(backlog, "Legacy task");
  await board.open(page);

  // No workflow is configured: the editor opens with control off and no
  // transitions, and the card moves Freely.
  const dialog = await openBoardSettings(page);
  await expect(dialog.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(dialog.getByTestId("workflow-dirty")).toHaveText(
    "All changes saved",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const source = await cardTitle(page, "Legacy task").boundingBox();
  const target = await columnSection(page, "Done")
    .getByTestId("column-card-scroll")
    .boundingBox();
  if (!source || !target) throw new Error("Card or target is not visible");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 10,
    source.y + source.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(target.x + target.width / 2, target.y + 40, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(
    columnSection(page, "Done").getByTestId("card-title"),
  ).toHaveText("Legacy task");
});

test("a board with one column cannot enable control", async ({
  page,
  board,
}) => {
  await board.column(`Solo ${randomUUID().slice(0, 8)}`);
  await board.open(page);
  const dialog = await openBoardSettings(page);
  await dialog.getByTestId("workflow-enabled").click();
  await expect(dialog.getByTestId("workflow-error")).toContainText(
    "at least two columns",
  );
  await expect(dialog.getByTestId("workflow-save")).toBeDisabled();
});
