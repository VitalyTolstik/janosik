import { describe, expect, it } from "vitest";
import type { Board, Card, Epic } from "@janosik/shared";

import {
  anchoredScrollTop,
  computeRange,
  rowOffsets,
} from "@/hooks/use-card-window";
import { buildBacklogRows, collectBacklogEpics } from "@/utils/backlog-rows";

const collapsed = { expanded: new Set<string>(), completedOpen: false };

function epic(
  id: string,
  position: number,
  status: Epic["status"] = "active",
): Epic {
  return {
    id,
    title: id,
    position,
    status,
    color: "rose",
    createdAt: 1,
    updatedAt: 1,
  };
}

function card(id: string, epicId?: string, labelIds: string[] = []): Card {
  return { id, title: id, labelIds, epicId, createdAt: 1, updatedAt: 1 };
}

const board: Board = {
  id: "board",
  title: "Board",
  labels: [],
  createdAt: 1,
  updatedAt: 1,
  columns: [
    {
      id: "first",
      title: "Ideas",
      cardIds: ["active-child", "finished-child", "ordinary", "unknown"],
      createdAt: 1,
    },
    { id: "done", title: "Shipped", cardIds: ["done-child"], createdAt: 1 },
    { id: "second", title: "Doing", cardIds: ["doing-child"], createdAt: 1 },
  ],
  workflow: {
    schemaVersion: 1,
    enabled: true,
    initialColumnId: "first",
    doneColumnIds: ["done"],
    transitions: [],
  },
  cards: {
    "active-child": card("active-child", "active", ["first-label"]),
    "finished-child": card("finished-child", "complete"),
    ordinary: card("ordinary"),
    unknown: card("unknown", "deleted"),
    "done-child": card("done-child", "active", ["first-label", "second-label"]),
    "doing-child": card("doing-child", "active"),
  },
  epics: [
    epic("active", 2),
    epic("complete", 3, "completed"),
    epic("empty", 1),
  ],
};

describe("Backlog rows", () => {
  it("groups by epic position and keeps completed and dangling children visible", () => {
    const epics = collectBacklogEpics(board);
    const model = buildBacklogRows(
      epics,
      board.cards,
      board.columns[0].cardIds,
      collapsed,
      false,
      undefined,
      false,
    );
    expect(model.rows.map(({ key }) => key)).toEqual([
      "epic:empty",
      "epic:active",
      "other",
      "card:finished-child",
      "card:ordinary",
      "card:unknown",
      "completed",
      "footer",
    ]);
    expect(model.hiddenCount).toBe(1);
    expect(model.cardIds).toEqual(["finished-child", "ordinary", "unknown"]);
    expect(epics.get("active")).toMatchObject({
      code: "EP-3",
      done: 1,
      elsewhereDone: 1,
      elsewhereOpen: 1,
      childIds: ["active-child", "done-child", "doing-child"],
      labelIds: ["first-label", "second-label"],
    });
    expect(epics.get("complete")?.chip.completed).toBe(true);
    expect(rowOffsets(model.rows)).toEqual([
      0, 120, 240, 276, 396, 516, 636, 684, 732,
    ]);
  });

  it("force-expands matches in any column and preserves a match's real placement", () => {
    const epics = collectBacklogEpics(board);
    const matched = new Set(["done-child", "finished-child"]);
    const model = buildBacklogRows(
      epics,
      board.cards,
      ["finished-child"],
      collapsed,
      true,
      matched,
      true,
    );
    expect(model.rows.map(({ key }) => key)).toEqual([
      "epic:active",
      "epic-footer:active",
      "other",
      "card:finished-child",
    ]);
    expect(model.rows[0]).toMatchObject({ expanded: true });
    expect(rowOffsets(model.rows)).toEqual([0, 100, 148, 184, 240]);
  });

  it("keeps the first/last rows reachable and anchors mixed rows through changes", () => {
    const epics = collectBacklogEpics(board);
    const ids = board.columns[0].cardIds;
    const before = buildBacklogRows(
      epics,
      board.cards,
      ids,
      collapsed,
      false,
      undefined,
      false,
    ).rows;
    const after = buildBacklogRows(
      epics,
      board.cards,
      ids,
      {
        expanded: new Set(["active"]),
        completedOpen: true,
      },
      false,
      undefined,
      false,
    ).rows;
    const beforeOffsets = rowOffsets(before);
    const afterOffsets = rowOffsets(after);
    expect(
      anchoredScrollTop(before, beforeOffsets, after, afterOffsets, 300),
    ).toBe(512);
    expect(
      anchoredScrollTop(after, afterOffsets, before, beforeOffsets, 260),
    ).toBe(124);
    const rows = Array.from({ length: 1_100 }, (_, index) => ({
      key: String(index),
      height: index % 2 ? 36 : 120,
    }));
    const offsets = rowOffsets(rows);
    expect(computeRange(rows.length, 0, 720, 120, offsets)).toMatchObject({
      start: 0,
    });
    const last = computeRange(rows.length, 999_999, 720, 120, offsets);
    expect(last.end).toBe(rows.length);
    expect(last.end - last.start).toBeGreaterThan(5);
    expect(last.end - last.start).toBeLessThan(24);
    expect(computeRange(0, 999_999, 720, 120, [0])).toEqual({
      start: 0,
      end: 0,
    });
  });
});
