import { randomUUID } from "node:crypto";

import { boardStarterPlan, type BoardStarterLocale } from "@janosik/shared";

import type { CreateCommandDto } from "@/commands/dto/create-command.dto";

/**
 * TASK-177.16: first-run example as ordinary board commands, so the starter
 * columns, card and checklist appear in the command log, undo and SSE exactly
 * like user-created content.
 */
export function boardStarterCommands(
  boardId: string,
  locale: BoardStarterLocale,
  now = Date.now(),
): CreateCommandDto[] {
  const plan = boardStarterPlan(locale, randomUUID);
  const action = (payload: Record<string, unknown>) => ({
    boardId,
    at: now,
    ...payload,
  });
  return [
    ...plan.columns.map((column) => ({
      commandId: randomUUID(),
      action: action({
        type: "ADD_COLUMN",
        newColumnId: column.id,
        title: column.title,
      }),
    })),
    {
      commandId: randomUUID(),
      action: action({
        type: "ADD_CARD",
        newCardId: plan.card.id,
        columnId: plan.card.columnId,
        title: plan.card.title,
      }),
    },
    {
      commandId: randomUUID(),
      action: action({
        type: "ADD_CHECKLIST",
        cardId: plan.card.id,
        newChecklistId: plan.checklist.id,
        title: plan.checklist.title,
      }),
    },
    ...plan.checklist.items.map((item) => ({
      commandId: randomUUID(),
      action: action({
        type: "ADD_CHECKLIST_ITEM",
        cardId: plan.card.id,
        checklistId: plan.checklist.id,
        newItemId: item.id,
        text: item.text,
      }),
    })),
  ];
}
