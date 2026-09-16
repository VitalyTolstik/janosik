import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCardList } from "@/hooks/use-card-list";
import type { Card, Column } from "@janosik/shared";

/**
 * Identity is the whole point (TASK-21.4.1): `memo` on a column only holds
 * while the card list it receives keeps its reference.
 */

function card(id: string, title = id): Card {
  return { id, title, labelIds: [], createdAt: 1, updatedAt: 1 };
}

const column: Column = {
  id: "col-1",
  title: "To do",
  cardIds: ["c-1", "c-2"],
  createdAt: 1,
};

describe("useCardList", () => {
  it("resolves ids in order and skips unknown ones", () => {
    const cards = { "c-1": card("c-1"), "c-2": card("c-2") };
    const { result } = renderHook(() => useCardList(cards));

    expect(result.current(column, ["c-2", "c-1"])).toEqual([
      cards["c-2"],
      cards["c-1"],
    ]);
    expect(result.current(column, ["c-1", "gone"])).toEqual([cards["c-1"]]);
  });

  it("keeps the array when the cards map is replaced but its cards are not", () => {
    const c1 = card("c-1");
    const c2 = card("c-2");
    const { result, rerender } = renderHook(
      ({ cards }: { cards: Record<string, Card> }) => useCardList(cards),
      { initialProps: { cards: { "c-1": c1, "c-2": c2 } } },
    );
    const first = result.current(column, column.cardIds);

    // What an edit to a card in *another* column looks like from here: a
    // brand-new map holding the very same card objects.
    rerender({ cards: { "c-1": c1, "c-2": c2 } });

    expect(result.current(column, column.cardIds)).toBe(first);
  });

  it("hands out a new array when one of its own cards changes", () => {
    const c1 = card("c-1");
    const c2 = card("c-2");
    const { result, rerender } = renderHook(
      ({ cards }: { cards: Record<string, Card> }) => useCardList(cards),
      { initialProps: { cards: { "c-1": c1, "c-2": c2 } } },
    );
    const first = result.current(column, column.cardIds);

    const edited = { ...c1, title: "Renamed" };
    rerender({ cards: { "c-1": edited, "c-2": c2 } });
    const second = result.current(column, column.cardIds);

    expect(second).not.toBe(first);
    expect(second[0]).toBe(edited);
  });

  it("hands out a new array when the order changes", () => {
    const cards = { "c-1": card("c-1"), "c-2": card("c-2") };
    const { result } = renderHook(() => useCardList(cards));
    const first = result.current(column, ["c-1", "c-2"]);

    expect(result.current(column, ["c-2", "c-1"])).not.toBe(first);
  });
});
