import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import { columnSection } from "@/helpers/history.js";
import { openMoveMenu } from "@/helpers/workflow.js";

type Condition =
  | "requireAssignee"
  | "requireDueDate"
  | "requireDescription"
  | "requireChecklistsDone";

const conditions: Array<{
  condition: Condition;
  reason: string;
}> = [
  { condition: "requireAssignee", reason: "Needs an assignee" },
  { condition: "requireDueDate", reason: "Needs a due date" },
  { condition: "requireDescription", reason: "Needs a description" },
  {
    condition: "requireChecklistsDone",
    reason: "All checklist items are done",
  },
];

for (const { condition, reason } of conditions) {
  test(`the ${condition} condition gates the move in the card menu`, async ({
    page,
    board,
  }) => {
    const backlog = await board.column("Backlog");
    const doing = await board.column("Doing");
    const cardId = await board.card(backlog, "Condition task");
    await board.command({
      type: "SET_BOARD_WORKFLOW",
      workflow: {
        schemaVersion: 1,
        enabled: true,
        initialColumnId: backlog,
        doneColumnIds: [doing],
        transitions: [
          {
            id: "backlog-doing",
            fromColumnId: backlog,
            toColumnId: doing,
            conditions: [condition],
          },
        ],
      },
    });
    let checklistId: string | undefined;
    let itemId: string | undefined;
    if (condition === "requireChecklistsDone") {
      checklistId = randomUUID();
      itemId = randomUUID();
      await board.command({
        type: "ADD_CHECKLIST",
        cardId,
        newChecklistId: checklistId,
        title: "DoD",
      });
      await board.command({
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: itemId,
        text: "Verify",
      });
    }
    await board.open(page);

    const blocked = await openMoveMenu(page, "Condition task");
    await expect(blocked.getByTestId(`ctx-move-${doing}`)).toBeDisabled();
    await expect(blocked.getByTestId(`ctx-move-reason-${doing}`)).toContainText(
      reason,
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Satisfy the condition through the same command log the UI uses, then
    // reload so the card face and the menu read one consistent snapshot.
    if (condition === "requireAssignee") {
      await board.command({
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId: board.userId,
      });
    } else if (condition === "requireDueDate") {
      await board.command({
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate: Date.now() + 86_400_000,
      });
    } else if (condition === "requireDescription") {
      await board.command({
        type: "UPDATE_CARD",
        cardId,
        description: "Ready for the next column",
      });
    } else {
      await board.command({
        type: "SET_CHECKLIST_ITEM_DONE",
        cardId,
        checklistId: checklistId!,
        itemId: itemId!,
        done: true,
      });
    }
    await page.reload();
    await expect(
      columnSection(page, "Backlog").getByTestId("card-title"),
    ).toHaveText("Condition task");

    const allowed = await openMoveMenu(page, "Condition task");
    await expect(allowed.getByTestId(`ctx-move-${doing}`)).toBeEnabled();
    await allowed.getByTestId(`ctx-move-${doing}`).click();
    await expect(
      columnSection(page, "Doing").getByTestId("card-title"),
    ).toHaveText("Condition task");
  });
}
