import { describe, expect, it } from "vitest";

import {
  BOARD_TEMPLATE_IDS,
  BOARD_TEMPLATES,
  boardTemplateById,
  boardTemplateCommandCount,
  boardTemplateCounts,
  boardTemplateLabelColor,
  boardTemplatePlan,
  templateDateString,
  templateDueDate,
  isValidTemplateDate,
  isValidTemplateUtcOffsetMinutes,
  isBoardCreateTemplate,
  isBoardTemplateId,
} from "./index";
import { COMMAND_BATCH_MAX } from "./api";

const FIXED_NOW = new Date(2026, 10, 24, 12, 0, 0).getTime();

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

describe("board templates catalog", () => {
  it("publishes six unique, non-empty templates", () => {
    expect(BOARD_TEMPLATE_IDS).toHaveLength(6);
    expect(BOARD_TEMPLATES).toHaveLength(6);
    expect(new Set(BOARD_TEMPLATES.map((template) => template.id)).size).toBe(
      6,
    );
    for (const template of BOARD_TEMPLATES) {
      expect(template.copy.en.columns.length).toBeGreaterThan(0);
      expect(template.copy.ru.columns.length).toBe(
        template.copy.en.columns.length,
      );
      const counts = boardTemplateCounts(template);
      expect(counts.cards).toBeGreaterThan(0);
      expect(counts.labels).toBeGreaterThan(0);
      expect(counts.columns).toBeLessThanOrEqual(6);
      expect(counts.cards).toBeLessThanOrEqual(10);
    }
  });

  it("keeps EN and RU structurally identical", () => {
    for (const template of BOARD_TEMPLATES) {
      const en = template.copy.en;
      const ru = template.copy.ru;
      expect(ru.name.length).toBeGreaterThan(0);
      expect(ru.short.length).toBeGreaterThan(0);
      expect(ru.long.length).toBeGreaterThan(0);
      expect(ru.tags).toHaveLength(en.tags.length);
      expect(Object.keys(ru.labels)).toEqual(Object.keys(en.labels));
      expect(ru.columns.map((column) => column.cards.length)).toEqual(
        en.columns.map((column) => column.cards.length),
      );
      for (let column = 0; column < en.columns.length; column += 1) {
        const enCards = en.columns[column]!.cards;
        const ruCards = ru.columns[column]!.cards;
        for (let card = 0; card < enCards.length; card += 1) {
          expect(ruCards[card]!.labels).toEqual(enCards[card]!.labels);
          expect(ruCards[card]!.dueInDays).toBe(enCards[card]!.dueInDays);
          expect(Boolean(ruCards[card]!.checklist)).toBe(
            Boolean(enCards[card]!.checklist),
          );
          expect(ruCards[card]!.checklist?.items.length ?? 0).toBe(
            enCards[card]!.checklist?.items.length ?? 0,
          );
        }
      }
    }
  });

  it("labels every card with a known label and a stable palette colour", () => {
    for (const template of BOARD_TEMPLATES) {
      for (const locale of ["en", "ru"] as const) {
        const copy = template.copy[locale];
        const keys = new Set(Object.keys(copy.labels));
        for (const column of copy.columns) {
          for (const card of column.cards) {
            for (const label of card.labels) {
              expect(keys.has(label)).toBe(true);
              expect(boardTemplateLabelColor(template, label)).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it("builds a plan within the 100-command batch and the 80-command guard", () => {
    for (const id of BOARD_TEMPLATE_IDS) {
      const plan = boardTemplatePlan(id, "en", ids(), FIXED_NOW, "2026-11-24");
      expect(plan.columns).toHaveLength(
        boardTemplateById(id)!.copy.en.columns.length,
      );
      expect(plan.labels).toHaveLength(
        Object.keys(boardTemplateById(id)!.copy.en.labels).length,
      );
      expect(boardTemplateCommandCount(plan)).toBeLessThanOrEqual(80);
      expect(boardTemplateCommandCount(plan)).toBeLessThanOrEqual(
        COMMAND_BATCH_MAX,
      );
    }
  });

  it("uses unique ids and links labels, cards and checklists", () => {
    for (const id of BOARD_TEMPLATE_IDS) {
      const plan = boardTemplatePlan(id, "ru", ids(), FIXED_NOW, "2026-11-24");
      const allIds = [
        ...plan.columns.map((column) => column.id),
        ...plan.labels.map((label) => label.id),
        ...plan.cards.map((card) => card.id),
        ...plan.cards.flatMap((card) =>
          card.checklists.flatMap((checklist) => [
            checklist.id,
            ...checklist.items.map((item) => item.id),
          ]),
        ),
      ];
      expect(new Set(allIds).size).toBe(allIds.length);
      const columnIds = new Set(plan.columns.map((column) => column.id));
      const labelIds = new Set(plan.labels.map((label) => label.id));
      for (const card of plan.cards) {
        expect(columnIds.has(card.columnId)).toBe(true);
        for (const labelId of card.labelIds) {
          expect(labelIds.has(labelId)).toBe(true);
        }
      }
      for (const column of plan.columns) {
        expect(column.cardIds).toHaveLength(
          boardTemplateById(id)!.copy.ru.columns.find(
            (candidate) => candidate.title === column.title,
          )!.cards.length,
        );
      }
    }
  });

  it("recognises catalog and legacy template selections", () => {
    expect(isBoardTemplateId("sprint")).toBe(true);
    expect(isBoardTemplateId("starter")).toBe(false);
    expect(isBoardCreateTemplate("starter")).toBe(true);
    expect(isBoardCreateTemplate("bug-tracker")).toBe(true);
    expect(isBoardCreateTemplate("unknown")).toBe(false);
    expect(isBoardCreateTemplate(null)).toBe(false);
  });

  it("anchors due dates to an explicit calendar date, not process TZ", () => {
    expect(isValidTemplateDate("2026-11-24")).toBe(true);
    expect(isValidTemplateDate("2026-02-31")).toBe(false);
    expect(isValidTemplateDate("24-11-2026")).toBe(false);
    expect(templateDateString(new Date(2026, 10, 24, 23, 59), false)).toBe(
      "2026-11-24",
    );
    expect(templateDueDate("2026-11-24", 2)).toBe(
      Date.UTC(2026, 10, 26, 12, 0, 0, 0),
    );
    // UTC+14 local noon on Nov 26 is Nov 25 22:00 UTC.
    expect(templateDueDate("2026-11-24", 2, 840)).toBe(
      Date.UTC(2026, 10, 25, 22, 0, 0, 0),
    );
    // UTC−8 local noon on Nov 26 is Nov 26 20:00 UTC.
    expect(templateDueDate("2026-11-24", 2, -480)).toBe(
      Date.UTC(2026, 10, 26, 20, 0, 0, 0),
    );
    expect(isValidTemplateUtcOffsetMinutes(840)).toBe(true);
    expect(isValidTemplateUtcOffsetMinutes(-720)).toBe(true);
    expect(isValidTemplateUtcOffsetMinutes(841)).toBe(false);
    expect(isValidTemplateUtcOffsetMinutes(1.5)).toBe(false);
    expect(() => templateDueDate("2026-11-24", 2, 841)).toThrow(
      /Invalid template UTC offset/,
    );

    const dueDates = () =>
      boardTemplatePlan(
        "product-launch",
        "en",
        ids(),
        FIXED_NOW,
        "2026-11-24",
        840,
      ).cards.map((card) => card.dueDate);
    const baseline = dueDates();
    expect(baseline).toContain(Date.UTC(2026, 10, 25, 22, 0, 0, 0));
    const previousTz = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      expect(dueDates()).toEqual(baseline);
      process.env.TZ = "America/Los_Angeles";
      expect(dueDates()).toEqual(baseline);
    } finally {
      process.env.TZ = previousTz;
    }
  });
});
