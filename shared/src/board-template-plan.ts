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

/**
 * A `YYYY-MM-DD` calendar date. `utc` is for the server's safe default; the
 * UI passes the user's local creation date explicitly.
 */
export function templateDateString(date: Date, utc = false): string {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isValidTemplateDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1970 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** UTC offsets are bounded by the real-world maximum (UTC+14 … UTC−12). */
export function isValidTemplateUtcOffsetMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= -840 && value <= 840;
}

/**
 * Days are counted from the creator's local calendar date at 12:00 in the
 * supplied UTC offset, so the preview (browser) and creation (API) cannot
 * disagree because the two processes run in different timezones or on
 * different sides of DST. The default offset `0` keeps old clients on the
 * original 12:00 UTC anchor.
 */
export function templateDueDate(
  templateDate: string,
  dueInDays: number,
  utcOffsetMinutes = 0,
): number {
  if (!isValidTemplateDate(templateDate)) {
    throw new Error(`Invalid template date: ${templateDate}`);
  }
  if (!isValidTemplateUtcOffsetMinutes(utcOffsetMinutes)) {
    throw new Error(`Invalid template UTC offset: ${utcOffsetMinutes}`);
  }
  const [year, month, day] = templateDate.split("-").map(Number);
  return (
    Date.UTC(year, month - 1, day + dueInDays, 12, 0, 0, 0) -
    utcOffsetMinutes * 60_000
  );
}

/**
 * Build one template with caller-generated ids.
 *
 * `now` is captured once (the dialog freezes it when it opens) so switching
 * templates in the picker cannot move a due date between previews. When
 * `templateDate` is omitted, the server falls back to its UTC calendar date;
 * the UI always sends the user's explicit local date.
 */
export function boardTemplatePlan(
  templateId: BoardTemplateId,
  locale: BoardStarterLocale,
  newId: () => string,
  now = Date.now(),
  templateDate = templateDateString(new Date(now), true),
  templateUtcOffsetMinutes = 0,
): BoardTemplatePlan {
  const template = boardTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown board template: ${templateId}`);
  }
  if (!isValidTemplateDate(templateDate)) {
    throw new Error(`Invalid template date: ${templateDate}`);
  }
  if (!isValidTemplateUtcOffsetMinutes(templateUtcOffsetMinutes)) {
    throw new Error(`Invalid template UTC offset: ${templateUtcOffsetMinutes}`);
  }
  return buildPlan(
    template,
    locale,
    newId,
    templateDate,
    templateUtcOffsetMinutes,
  );
}

function buildPlan(
  template: BoardTemplate,
  locale: BoardStarterLocale,
  newId: () => string,
  templateDate: string,
  templateUtcOffsetMinutes: number,
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
          ? {
              dueDate: templateDueDate(
                templateDate,
                card.dueInDays,
                templateUtcOffsetMinutes,
              ),
            }
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
