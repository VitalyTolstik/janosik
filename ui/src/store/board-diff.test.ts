import { describe, expect, it } from "vitest";

import type { Board, Card, Label } from "@janosik/shared";
import { changedEntityIds } from "@/store/board-diff";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c-1",
    title: "Hello",
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
    cards: { "c-1": card() },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("changedEntityIds", () => {
  it("reports nothing for equal boards written with different key order", () => {
    const local = board();
    const server = {
      updatedAt: 1,
      createdAt: 1,
      labels: [],
      cards: {
        "c-1": {
          updatedAt: 1,
          createdAt: 1,
          labelIds: [],
          title: "Hello",
          id: "c-1",
        },
      },
      columns: [{ createdAt: 1, cardIds: ["c-1"], title: "Todo", id: "col-1" }],
      title: "Board",
      id: "b-1",
    } as Board;
    expect(changedEntityIds(local, server)).toEqual([]);
  });

  it("reports a card whose text changed", () => {
    const server = board();
    server.cards["c-1"] = card({ title: "Changed", updatedAt: 2 });
    expect(changedEntityIds(board(), server)).toEqual(["c-1"]);
  });

  it("ignores the client-only activity feed the aggregate never carries", () => {
    // The local card gains `activity` on every edit; the server aggregate
    // derives it from the command log and omits the field entirely. Diffing
    // it used to mark the card foreign on each focus refetch and kill the
    // user's own undo steps (live bug, 2026-09-17).
    const local = board({
      cards: {
        "c-1": card({
          activity: [{ id: "a-1", type: "renamed", at: 2, actorId: null }],
        }),
      },
    });
    const server = board();
    expect(changedEntityIds(local, server)).toEqual([]);
  });

  it("still reports a real card change next to a differing activity feed", () => {
    const local = board({
      cards: {
        "c-1": card({
          title: "Changed",
          updatedAt: 2,
          activity: [{ id: "a-1", type: "renamed", at: 2, actorId: null }],
        }),
      },
    });
    expect(changedEntityIds(local, board())).toEqual(["c-1"]);
  });

  it("reports a column whose order changed", () => {
    const server = board();
    server.columns = [
      { id: "col-1", title: "Todo", cardIds: [], createdAt: 1 },
    ];
    expect(changedEntityIds(board(), server)).toEqual(["col-1"]);
  });

  it("reports cards the server added", () => {
    const server = board({
      cards: { "c-1": card(), "c-2": card({ id: "c-2" }) },
    });
    expect(changedEntityIds(board(), server)).toEqual(["c-2"]);
  });

  it("reports a label-only card change with an equal updatedAt (TASK-156)", () => {
    const server = board();
    server.cards["c-1"] = card({ labelIds: ["l-1"] });
    expect(changedEntityIds(board(), server)).toEqual(["c-1"]);
  });

  it("reports a label whose color changed", () => {
    const label: Label = { id: "l-1", name: "Bug", color: "red" };
    const local = board({ labels: [label] });
    const server = board({ labels: [{ ...label, color: "blue" }] });
    expect(changedEntityIds(local, server)).toEqual(["l-1"]);
  });

  it("reports the board itself when the title changed", () => {
    const server = board({ title: "Renamed" });
    expect(changedEntityIds(board(), server)).toEqual(["b-1"]);
  });
});
