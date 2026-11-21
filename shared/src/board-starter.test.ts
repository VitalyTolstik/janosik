import { describe, expect, it } from "vitest";

import {
  BOARD_STARTER_COPY,
  BOARD_STARTER_LOCALES,
  boardStarterPlan,
} from "./board-starter";

describe("boardStarterPlan", () => {
  it.each(BOARD_STARTER_LOCALES)(
    "builds a three-column plan with a welcome card and checklist (%s)",
    (locale) => {
      let sequence = 0;
      const plan = boardStarterPlan(locale, () => `id-${++sequence}`);
      const copy = BOARD_STARTER_COPY[locale];

      expect(plan.columns.map((column) => column.title)).toEqual([
        copy.todo,
        copy.inProgress,
        copy.done,
      ]);
      expect(plan.card).toMatchObject({
        columnId: plan.columns[0]!.id,
        title: copy.cardTitle,
      });
      expect(plan.checklist.title).toBe(copy.checklistTitle);
      expect(plan.checklist.items.map((item) => item.text)).toEqual(copy.items);
    },
  );

  it("returns unique ids for every plan object", () => {
    let sequence = 0;
    const plan = boardStarterPlan("en", () => `id-${++sequence}`);
    const ids = [
      ...plan.columns.map((column) => column.id),
      plan.card.id,
      plan.checklist.id,
      ...plan.checklist.items.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
