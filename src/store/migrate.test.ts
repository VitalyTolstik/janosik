import { describe, expect, it } from "vitest";

import { normalizeBoards } from "@/store/migrate";
import type { Board } from "@/types/kanban";

/**
 * Migration tests: boards saved by old app versions (cards with a single
 * `labelId: string | null`) are normalized to the current `labelIds: string[]`
 * shape; already-current boards pass through untouched.
 */

const card = (extra: Record<string, unknown>) => ({
  id: "c1",
  title: "Card",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

describe("normalizeBoards", () => {
  it("converts a legacy single labelId into labelIds array", () => {
    const legacy = card({ labelId: "label-a" });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(
      (next.cards["c1"] as unknown as { labelIds: string[] }).labelIds,
    ).toEqual(["label-a"]);
  });

  it("maps null labelId to an empty array", () => {
    const legacy = card({ labelId: null });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(
      (next.cards["c1"] as unknown as { labelIds: string[] }).labelIds,
    ).toEqual([]);
  });

  it("leaves already-normalized boards untouched (same reference)", () => {
    const current = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: card({ labelIds: ["x"] }) },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([current]);
    expect(next).toBe(current);
  });

  it("keeps well-formed checklists as-is", () => {
    const checklists = [
      {
        id: "cl-1",
        title: "Steps",
        items: [{ id: "i1", text: "Do it", done: true }],
      },
    ];
    const current = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: card({ labelIds: [], checklists }) },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([current]);
    expect(next).toBe(current);
    expect(next.cards["c1"].checklists).toEqual(checklists);
  });

  it("keeps a valid dueDate and drops garbage", () => {
    const due = 1700000000000;
    const legacy = card({ labelIds: [], dueDate: due });
    const dirty = card({ labelIds: [], dueDate: "next tuesday" });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy, c2: dirty },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(next.cards["c1"].dueDate).toBe(due);
    expect(next.cards["c2"].dueDate).toBeUndefined();
  });

  it("leaves boards without a dueDate untouched (same reference)", () => {
    const current = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: card({ labelIds: [] }) },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([current]);
    expect(next).toBe(current);
  });

  it("keeps a valid cover and drops malformed ones", () => {
    const cover = { type: "gradient", value: "sunset" };
    const valid = card({ labelIds: [], cover });
    const badShape = card({ labelIds: [], cover: "blue" });
    const badValue = card({ labelIds: [], cover: { type: "color", value: "chartreuse" } });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: valid, c2: badShape, c3: badValue },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(next.cards["c1"].cover).toEqual(cover);
    expect(next.cards["c2"].cover).toBeUndefined();
    expect(next.cards["c3"].cover).toBeUndefined();
  });

  it("leaves boards without a cover untouched (same reference)", () => {
    const current = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: card({ labelIds: [] }) },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([current]);
    expect(next).toBe(current);
  });

  it("drops a malformed checklists field (not an array)", () => {
    const legacy = card({ labelIds: ["x"], checklists: "garbage" });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(next.cards["c1"].checklists).toBeUndefined();
  });

  it("filters malformed checklist entries and items", () => {
    const legacy = card({
      labelIds: ["x"],
      checklists: [
        {
          id: "cl-1",
          title: "Steps",
          items: [{ id: "i1", text: "Keep", done: false }, "garbage", null],
        },
        "garbage",
        { id: "cl-2", title: "Empty", items: [] },
        { title: "no id", items: [] },
      ],
    });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(next.cards["c1"].checklists).toEqual([
      { id: "cl-1", title: "Steps", items: [{ id: "i1", text: "Keep", done: false }] },
      // Empty checklists are valid user data — only malformed entries drop.
      { id: "cl-2", title: "Empty", items: [] },
    ]);
  });
});

describe("normalizeBoards — activity (TASK-12)", () => {
  const validEvent = {
    id: "ev-1",
    type: "created",
    at: 1000,
    actorId: null,
  };

  it("keeps well-formed activity as-is (board untouched)", () => {
    const current = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: card({ labelIds: [], activity: [validEvent] }) },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([current]);
    expect(next).toBe(current);
    expect(next.cards["c1"].activity).toEqual([validEvent]);
  });

  it("drops malformed activity events and empty/garbage lists", () => {
    const legacy = card({
      labelIds: [],
      activity: [
        validEvent,
        { type: "created", at: 1, actorId: null }, // no id
        { id: "e", type: "time-travel", at: 1, actorId: null }, // unknown type
        { id: "e", type: "created", at: "yesterday", actorId: null }, // bad at
        "garbage",
        null,
      ],
    });
    const board = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: legacy },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;

    const [next] = normalizeBoards([board]);
    expect(next.cards["c1"].activity).toEqual([validEvent]);

    const empty = card({ labelIds: [], activity: ["garbage"] });
    const board2 = {
      id: "b",
      title: "B",
      columns: [],
      cards: { c1: empty },
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;
    const [next2] = normalizeBoards([board2]);
    expect(next2.cards["c1"].activity).toBeUndefined();
  });
});

describe("normalizeBoards — length limits (TASK-20)", () => {
  async function limits() {
    return import("@/types/kanban").then((m) => m.LIMITS);
  }

  function oversizedBoard(l: typeof import("@/types/kanban").LIMITS) {
    return {
      id: "b",
      title: "B".repeat(l.boardTitle + 5),
      columns: [
        { id: "col", title: "C".repeat(l.columnTitle + 5), cardIds: ["c1"], createdAt: 1 },
      ],
      labels: [{ id: "lb", name: "L".repeat(l.labelName + 5), color: "red" }],
      cards: {
        c1: card({
          labelIds: [],
          title: "T".repeat(l.cardTitle + 5),
          description: "D".repeat(l.description + 5),
          checklists: [
            {
              id: "cl",
              title: "K".repeat(l.checklistTitle + 5),
              items: [{ id: "i1", text: "I".repeat(l.checklistItem + 5), done: false }],
            },
          ],
        }),
      },
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;
  }

  it("clamps every free-text field of an oversized import", async () => {
    const LIMITS = await limits();
    const [next] = normalizeBoards([oversizedBoard(LIMITS)]);
    expect(next.title).toHaveLength(LIMITS.boardTitle);
    expect(next.columns[0].title).toHaveLength(LIMITS.columnTitle);
    expect(next.labels[0].name).toHaveLength(LIMITS.labelName);
    const card = next.cards["c1"];
    expect(card.title).toHaveLength(LIMITS.cardTitle);
    expect(card.description).toHaveLength(LIMITS.description);
    expect(card.checklists![0].title).toHaveLength(LIMITS.checklistTitle);
    expect(card.checklists![0].items[0].text).toHaveLength(LIMITS.checklistItem);
  });

  it("passes already-limited boards through untouched", async () => {
    const LIMITS = await limits();
    const board = oversizedBoard(LIMITS);
    const [once] = normalizeBoards([board]);
    const [twice] = normalizeBoards([once]);
    expect(twice).toBe(once);
  });
});

describe("normalizeBoards — wipLimit (TASK-13)", () => {
  const boardWithColumn = (wipLimit: unknown) => ({
    id: "b",
    title: "B",
    columns: [
      { id: "col", title: "C", cardIds: [], createdAt: 1, wipLimit },
    ],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  }) as unknown as Board;

  it("keeps an in-range limit and clamps out-of-range ones", async () => {
    const { LIMITS } = await import("@/types/kanban");

    const ok = normalizeBoards([boardWithColumn(7)])[0];
    expect(ok.columns[0].wipLimit).toBe(7);

    const high = normalizeBoards([boardWithColumn(LIMITS.wipLimitMax + 1)])[0];
    expect(high.columns[0].wipLimit).toBe(LIMITS.wipLimitMax);

    const zero = normalizeBoards([boardWithColumn(0)])[0];
    expect(zero.columns[0].wipLimit).toBe(1);
  });

  it("drops garbage and keeps the omit-when-unset invariant", () => {
    const garbage = normalizeBoards([boardWithColumn("many")])[0];
    expect(garbage.columns[0].wipLimit).toBeUndefined();
    expect("wipLimit" in garbage.columns[0]).toBe(false);

    const unset = normalizeBoards([boardWithColumn(undefined)])[0];
    expect(unset.columns[0].wipLimit).toBeUndefined();
  });

  it("lets already-current boards pass through untouched", () => {
    const board = {
      id: "b",
      title: "B",
      columns: [
        { id: "col", title: "C", cardIds: [], createdAt: 1, wipLimit: 5 },
      ],
      cards: {},
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Board;
    expect(normalizeBoards([board])[0]).toBe(board);
  });
});
