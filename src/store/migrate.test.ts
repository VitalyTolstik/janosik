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
