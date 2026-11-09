import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";
import { cardDialog, cardOrder, openCard } from "@/helpers/history.js";

test("duplicates the card content below the original", async ({
  page,
  board,
}) => {
  const column = await board.column("Work");
  const cardId = await board.card(column, "Original");
  const targetId = await board.card(column, "Target");
  const labelId = await board.label("Bug");
  const checklistId = randomUUID();
  const itemId = randomUUID();
  await board.command({
    type: "UPDATE_CARD",
    cardId,
    description: "Everything must come along",
  });
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId,
    on: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId,
    priority: "high",
  });
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate: Date.UTC(2027, 0, 15),
  });
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId,
    assigneeId: board.userId,
  });
  await board.command({
    type: "SET_CARD_COVER",
    cardId,
    cover: { type: "color", value: "blue" },
  });
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: "Steps",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: itemId,
    text: "Do the thing",
  });
  await board.command({
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId,
    checklistId,
    itemId,
    done: true,
  });
  await board.command({
    type: "ADD_CARD_LINK",
    cardId,
    linkId: randomUUID(),
    targetCardId: targetId,
    linkType: "relates_to",
  });

  await board.open(page);
  await openCard(page, "Original");
  let dialog = cardDialog(page);
  await dialog.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate card" }).click();
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Copy of Original" }),
  ).toBeVisible();
  // Duplicating closes the dialog so the copy is visible on the board.
  await expect(dialog).toBeHidden();
  expect(await cardOrder(page, "Work")).toEqual([
    "Original",
    "Copy of Original",
    "Target",
  ]);

  await openCard(page, "Copy of Original");
  dialog = cardDialog(page);
  const description = dialog
    .locator("section")
    .filter({ has: page.getByTestId("card-description-toggle") })
    .locator('[contenteditable="true"]');
  await expect(description).toContainText("Everything must come along");
  await expect(dialog.getByText("Bug", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByTestId("priority-trigger")).toContainText("High");
  await expect(dialog.getByTestId("due-date-trigger")).not.toContainText(
    "Set due date",
  );
  await expect(dialog.getByTestId("card-assignee-trigger")).not.toContainText(
    "Unassigned",
  );
  await dialog.getByTestId("cover-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
  await dialog.getByTestId("cover-trigger").click();
  const item = dialog.locator("li").filter({ hasText: "Do the thing" }).first();
  await expect(item.getByRole("button", { pressed: true })).toBeVisible();
  await expect(dialog.getByTestId("card-link-row")).toHaveCount(0);
});
