import { test, expect } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";
import { openMoveMenu } from "@/helpers/workflow.js";

test("the card menu enables allowed targets and explains forbidden ones", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Menu task");
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

  const menu = await openMoveMenu(page, "Menu task");
  await expect(menu.getByTestId(`ctx-move-${doing}`)).toBeEnabled();
  await expect(menu.getByTestId(`ctx-move-${done}`)).toBeDisabled();
  await expect(menu.getByTestId(`ctx-move-reason-${done}`)).toContainText(
    "Backlog → Done",
  );

  await menu.getByTestId(`ctx-move-${doing}`).click();
  await expect(
    columnSection(page, "Doing").getByTestId("card-title"),
  ).toHaveText("Menu task");
});

test("the read-only workflow rules are visible to a board member", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Rules task");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        {
          id: "backlog-doing",
          fromColumnId: backlog,
          toColumnId: doing,
          allowedRoles: ["ADMIN"],
          conditions: ["requireAssignee"],
        },
      ],
    },
  });
  await board.open(page);

  await page.getByTestId("card-title").first().click({ button: "right" });
  await page.getByTestId("ctx-workflow-rules").click();
  const dialog = page.getByTestId("workflow-rules-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("workflow-rule-backlog-doing")).toContainText(
    "ADMIN",
  );
  await expect(dialog.getByTestId("workflow-rule-backlog-doing")).toContainText(
    "Needs an assignee",
  );
});
