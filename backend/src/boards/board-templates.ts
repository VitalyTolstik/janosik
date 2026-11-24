import { randomUUID } from "node:crypto";

import {
  boardTemplatePlan,
  type BoardStarterLocale,
  type BoardTemplateId,
} from "@janosik/shared";

import type { CreateCommandDto } from "@/commands/dto/create-command.dto";

/**
 * TASK-177.16 follow-up: a curated first-run template as ordinary board
 * commands, so every column, label, card, description, due date and
 * checklist item appears in the command log, undo and SSE exactly like
 * user-created content.
 *
 * The legacy `starter` command generator stays untouched next door; this is
 * the catalog path only.
 */
export function boardTemplateCommands(
  boardId: string,
  templateId: BoardTemplateId,
  locale: BoardStarterLocale,
  now = Date.now(),
  templateDate?: string,
): CreateCommandDto[] {
  const plan = boardTemplatePlan(
    templateId,
    locale,
    randomUUID,
    now,
    templateDate,
  );
  const command = (action: Record<string, unknown>): CreateCommandDto => ({
    commandId: randomUUID(),
    action: { boardId, at: now, ...action },
  });

  const commands: CreateCommandDto[] = [
    ...plan.columns.map((column) =>
      command({
        type: "ADD_COLUMN",
        newColumnId: column.id,
        title: column.title,
      }),
    ),
    ...plan.labels.map((label) =>
      command({
        type: "ADD_LABEL",
        label,
      }),
    ),
  ];

  for (const card of plan.cards) {
    commands.push(
      command({
        type: "ADD_CARD",
        newCardId: card.id,
        columnId: card.columnId,
        title: card.title,
        ...(card.labelIds.length > 0 ? { labelIds: card.labelIds } : {}),
      }),
    );
    if (card.description) {
      commands.push(
        command({
          type: "UPDATE_CARD",
          cardId: card.id,
          description: card.description,
        }),
      );
    }
    if (typeof card.dueDate === "number") {
      commands.push(
        command({
          type: "SET_CARD_DUE_DATE",
          cardId: card.id,
          dueDate: card.dueDate,
        }),
      );
    }
    for (const checklist of card.checklists) {
      commands.push(
        command({
          type: "ADD_CHECKLIST",
          cardId: card.id,
          newChecklistId: checklist.id,
          title: checklist.title,
        }),
      );
      for (const item of checklist.items) {
        commands.push(
          command({
            type: "ADD_CHECKLIST_ITEM",
            cardId: card.id,
            checklistId: checklist.id,
            newItemId: item.id,
            text: item.text,
          }),
        );
      }
    }
  }

  return commands;
}
