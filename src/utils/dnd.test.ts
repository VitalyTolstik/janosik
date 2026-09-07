import { describe, expect, it } from "vitest";

import { applyCardOver } from "@/utils/dnd";

/**
 * Tests for the pure cross-column card-drag hover logic.
 *
 * Same-column hovers deliberately return null: within a column the sortable
 * strategy animates the gap and the FINAL position is decided on drop via
 * arrayMove into the over card's slot (see DndBoard.handleDragEnd).
 *
 * The key invariant: a card id must never appear twice in the draft map —
 * inserting the active card without removing it from its source column would
 * render duplicate (gray, transformed) cards down the column.
 *
 * The optional `insertAfter` flag mirrors the drag pointer: when true the
 * active card lands AFTER the hovered card (important at the very end of a
 * column — dropping below the last card must make the card LAST, not
 * second-to-last).
 */

const base: Record<string, string[]> = {
  backlog: ["a", "b", "c"],
  progress: ["d", "e"],
  done: [],
};

describe("applyCardOver", () => {
  it("is a no-op for same-column hovers (the sortable strategy's job)", () => {
    expect(applyCardOver(base, "a", "b", true)).toBeNull();
    expect(applyCardOver(base, "b", "c", false)).toBeNull();
  });

  it("moves a card across columns over another card (before it)", () => {
    expect(applyCardOver(base, "a", "e", false)).toEqual({
      backlog: ["b", "c"],
      progress: ["d", "a", "e"],
      done: [],
    });
  });

  it("appends to an empty column when hovering its body", () => {
    expect(applyCardOver(base, "a", "done")).toEqual({
      backlog: ["b", "c"],
      progress: ["d", "e"],
      done: ["a"],
    });
  });

  it("moves to the end when hovering the target column body", () => {
    expect(applyCardOver(base, "a", "progress")).toEqual({
      backlog: ["b", "c"],
      progress: ["d", "e", "a"],
      done: [],
    });
  });

  it("never duplicates the active card when moving across columns", () => {
    // Regression: inserting the active card into a column without removing
    // it from its source first rendered duplicate (gray) cards down the
    // column. The invariant must hold for every cross-column hover.
    const result = applyCardOver(base, "a", "e", true);
    expect(result).not.toBeNull();
    // Exactly one occurrence of the active card across the whole map.
    const occurrences = Object.values(result!)
      .flat()
      .filter((id) => id === "a");
    expect(occurrences).toHaveLength(1);
    // And no column itself contains a duplicate id.
    for (const ids of Object.values(result!)) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("is a no-op when hovering the card over itself", () => {
    expect(applyCardOver(base, "a", "a")).toBeNull();
  });

  it("is a no-op when the active card already sits right before the over card", () => {
    // Cross-column but the order wouldn't change.
    const staged = {
      backlog: ["b", "c"],
      progress: ["d", "a", "e"],
      done: [],
    };
    expect(applyCardOver(staged, "a", "e", false)).toBeNull();
  });

  it("ignores unknown active cards", () => {
    expect(applyCardOver(base, "ghost", "b")).toBeNull();
  });

  it("lands last in the target column when dropped below its last card", () => {
    // The reported bug: cross-column drop at the very end placed the card
    // BEFORE the last card (second-to-last) because the old code always
    // inserted before the hovered card, ignoring the pointer.
    expect(applyCardOver(base, "a", "e", true)).toEqual({
      backlog: ["b", "c"],
      progress: ["d", "e", "a"],
      done: [],
    });
    // Still exactly one occurrence of the active card.
    const occurrences = Object.values(applyCardOver(base, "a", "e", true)!)
      .flat()
      .filter((id) => id === "a");
    expect(occurrences).toHaveLength(1);
  });
});
