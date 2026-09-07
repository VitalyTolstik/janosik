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
});
