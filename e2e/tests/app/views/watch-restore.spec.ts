import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/board.js";

type Snapshot = {
  columns: { id: string; title: string; cardIds: string[] }[];
  cards: Record<
    string,
    {
      id: string;
      title: string;
      checklists?: {
        id: string;
        title: string;
        items: { id: string; text: string }[];
      }[];
    }
  >;
  labels: { id: string; name: string; color: string }[];
};

for (const kind of [
  "card",
  "column",
  "column cards",
  "label",
  "checklist",
  "item",
] as const) {
  test(`watch shows the restore ${kind} command`, async ({ page, board }) => {
    const column = await board.column("Todo");
    const card = await board.card(column, "Task");
    const label = randomUUID();
    const checklist = randomUUID();
    const item = randomUUID();
    if (kind === "label")
      await board.command({
        type: "ADD_LABEL",
        label: { id: label, name: "Bug", color: "red" },
      });
    if (kind === "checklist" || kind === "item")
      await board.command({
        type: "ADD_CHECKLIST",
        cardId: card,
        newChecklistId: checklist,
        title: "Steps",
      });
    if (kind === "item")
      await board.command({
        type: "ADD_CHECKLIST_ITEM",
        cardId: card,
        checklistId: checklist,
        newItemId: item,
        text: "Review",
      });
    const response = await board.api.get(`/api/v1/boards/${board.id}`);
    expect(response.ok()).toBeTruthy();
    const snapshot = (await response.json()) as Snapshot;
    const savedCard = snapshot.cards[card]!;
    const savedChecklist = savedCard.checklists?.[0];
    let removal: Record<string, unknown>;
    let restore: Record<string, unknown>;
    let message: string;
    switch (kind) {
      case "card":
        removal = { type: "DELETE_CARD", cardId: card };
        restore = { type: "RESTORE_CARD", card: savedCard, columnId: column };
        message = "Restored the card";
        break;
      case "column":
        removal = { type: "DELETE_COLUMN", columnId: column };
        restore = {
          type: "RESTORE_COLUMN",
          column: snapshot.columns[0],
          cards: [savedCard],
          index: 0,
        };
        message = "Restored a column";
        break;
      case "column cards":
        removal = { type: "ARCHIVE_COLUMN_CARDS", columnId: column };
        restore = {
          type: "RESTORE_COLUMN_CARDS",
          columnId: column,
          cardIds: [card],
          cards: [savedCard],
        };
        message = "Restored a column's cards";
        break;
      case "label":
        removal = { type: "DELETE_LABEL", labelId: label };
        restore = {
          type: "RESTORE_LABEL",
          label: snapshot.labels.find((value) => value.id === label),
          index: 0,
        };
        message = "Restored a label";
        break;
      case "checklist":
        removal = {
          type: "DELETE_CHECKLIST",
          cardId: card,
          checklistId: checklist,
        };
        restore = {
          type: "RESTORE_CHECKLIST",
          cardId: card,
          checklist: savedChecklist,
          index: 0,
        };
        message = "Restored a checklist";
        break;
      case "item":
        removal = {
          type: "DELETE_CHECKLIST_ITEM",
          cardId: card,
          checklistId: checklist,
          itemId: item,
        };
        restore = {
          type: "RESTORE_CHECKLIST_ITEM",
          cardId: card,
          checklistId: checklist,
          item: savedChecklist?.items[0],
          index: 0,
        };
        message = "Restored a checklist item";
        break;
    }
    await board.command(removal);
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();
    await expect(page.getByTestId("watch-feed")).toBeVisible();
    await board.command(restore);
    await expect(
      page.getByTestId("watch-entry").filter({ hasText: message }),
    ).toBeVisible({ timeout: 15000 });
  });
}
