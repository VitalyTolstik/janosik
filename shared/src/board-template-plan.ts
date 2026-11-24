import {
  boardTemplateById,
  boardTemplateLabelColor,
  type BoardTemplate,
  type BoardTemplateId,
} from "./board-templates";
import type { BoardStarterLocale } from "./board-starter";
import type { Label } from "./types/kanban";

/**
 * A template rendered into concrete ids and dates.
 *
 * The backend turns this plan into ordinary command-log entries; the offline
 * store turns the same plan into reducer state. Keeping both paths on one
 * plan is what makes an example identical online and offline.
 */
export interface BoardTemplatePlanChecklist {
  id: string;
  title: string;
  items: Array<{ id: string; text: string; done: false }>;
}

export interface BoardTemplatePlanCard {
  id: string;
  columnId: string;
  title: string;
  labelIds: string[];
  description?: string;
  dueDate?: number;
  checklists: BoardTemplatePlanChecklist[];
}

export interface BoardTemplatePlan {
  templateId: BoardTemplateId;
  columns: Array<{ id: string; title: string; cardIds: string[] }>;
  labels: Label[];
  cards: BoardTemplatePlanCard[];
}

/** Days are counted from local noon so a DST change cannot shift a due date. */
export function templateDueDate(now: number, dueInDays: number): number {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dueInDays);
  return date.getTime();
}

/**
 * Build one template with caller-generated ids.
 *
 * `now` is captured once (the dialog freezes it when it opens) so switching
 * templates in the picker cannot move a due date between previews.
 */
export function boardTemplatePlan(
  templateId: BoardTemplateId,
  locale: BoardStarterLocale,
  newId: () => string,
  now = Date.now(),
): BoardTemplatePlan {
  const template = boardTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown board template: ${templateId}`);
  }
  return buildPlan(template, locale, newId, now);
}

function buildPlan(
  template: BoardTemplate,
  locale: BoardStarterLocale,
  newId: () => string,
  now: number,
): BoardTemplatePlan {
  const copy = template.copy[locale] ?? template.copy.en;
  const labelEntries = Object.entries(copy.labels);
  const labelIdByKey = new Map<string, string>();
  const labels: Label[] = labelEntries.map(([key, name]) => {
    const id = newId();
    labelIdByKey.set(key, id);
    return {
      id,
      name,
      color: boardTemplateLabelColor(template, key),
    };
  });

  const columns = copy.columns.map((column) => ({
    id: newId(),
    title: column.title,
    cardIds: [] as string[],
  }));

  const cards: BoardTemplatePlanCard[] = [];
  copy.columns.forEach((column, columnIndex) => {
    const planColumn = columns[columnIndex]!;
    for (const card of column.cards) {
      const id = newId();
      planColumn.cardIds.push(id);
      cards.push({
        id,
        columnId: planColumn.id,
        title: card.title,
        labelIds: card.labels
          .map((key) => labelIdByKey.get(key))
          .filter((value): value is string => value !== undefined),
        ...(card.desc ? { description: card.desc } : {}),
        ...(typeof card.dueInDays === "number"
          ? { dueDate: templateDueDate(now, card.dueInDays) }
          : {}),
        checklists: card.checklist
          ? [
              {
                id: newId(),
                title: card.checklist.title,
                items: card.checklist.items.map((text) => ({
                  id: newId(),
                  text,
                  done: false as const,
                })),
              },
            ]
          : [],
      });
    }
  });

  return { templateId: template.id, columns, labels, cards };
}

/**
 * How many command-log entries this plan becomes on the server. Used by the
 * catalog test so a future template cannot silently approach the batch cap.
 */
export function boardTemplateCommandCount(plan: BoardTemplatePlan): number {
  let count = plan.columns.length + plan.labels.length + plan.cards.length;
  for (const card of plan.cards) {
    if (card.description) count += 1;
    if (typeof card.dueDate === "number") count += 1;
    count += card.checklists.length;
    for (const checklist of card.checklists) {
      count += checklist.items.length;
    }
  }
  return count;
}
