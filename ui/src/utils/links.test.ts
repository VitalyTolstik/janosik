import { describe, expect, it } from "vitest";
import type { Board, Card } from "@janosik/shared";

import {
  cardLinkIndex,
  isPairLinked,
  suggestLinkTargets,
  wouldCreateCycle,
} from "./links";

function card(id: string, title: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    title,
    labelIds: [],
    createdAt: 100,
    updatedAt: 200,
    ...extra,
  };
}

interface Fixture {
  cards: Board["cards"];
}

function fixture(): Fixture {
  const cards: Board["cards"] = {
    "c-1": card("c-1", "Zebra", {
      links: [
        { id: "lk-1", type: "blocks", targetCardId: "c-2" },
        // Dangling: the target is gone. Skipped everywhere below.
        { id: "lk-2", type: "relates_to", targetCardId: "c-x" },
      ],
    }),
    "c-2": card("c-2", "Alpha"),
    "c-3": card("c-3", "Mango", { archivedAt: 400 }),
    "c-4": card("c-4", "Melon"),
  };
  return { cards };
}

describe("cardLinkIndex", () => {
  it("counts both sides and skips dangling targets", () => {
    const { cards } = fixture();
    const index = cardLinkIndex(cards);
    // c-1: one live outgoing row (lk-1); the dangling one is invisible.
    expect(index.factsOf("c-1")).toMatchObject({ degree: 1, blocked: false });
    // c-2: the incoming "blocks" from a live card lights the badge.
    expect(index.factsOf("c-2")).toMatchObject({ degree: 1, blocked: true });
    // Untouched card: the shared empty object.
    expect(index.factsOf("c-4")).toEqual({
      outgoing: [],
      incoming: [],
      degree: 0,
      blocked: false,
    });
  });

  it("does not count an archived blocker as blocked", () => {
    const { cards } = fixture();
    cards["c-3"] = card("c-3", "Mango", {
      archivedAt: 400,
      links: [{ id: "lk-3", type: "blocks", targetCardId: "c-4" }],
    });
    expect(cardLinkIndex(cards).factsOf("c-4").blocked).toBe(false);
    expect(cardLinkIndex(cards).factsOf("c-4").degree).toBe(1);
  });

  it("caches per cards snapshot and rebuilds on a new one", () => {
    const { cards } = fixture();
    const first = cardLinkIndex(cards);
    expect(cardLinkIndex(cards)).toBe(first);
    const next = { ...cards };
    expect(cardLinkIndex(next)).not.toBe(first);
  });
});

describe("wouldCreateCycle", () => {
  it("sees a two-card circle and a three-card chain", () => {
    const { cards } = fixture(); // c-1 blocks c-2
    expect(wouldCreateCycle(cards, "c-2", "c-1")).toBe(true);
    expect(wouldCreateCycle(cards, "c-1", "c-2")).toBe(false);
    cards["c-2"] = card("c-2", "Alpha", {
      links: [{ id: "lk-4", type: "blocks", targetCardId: "c-4" }],
    });
    // c-1 → c-2 → c-4; adding c-4 blocks c-1 closes the circle.
    expect(wouldCreateCycle(cards, "c-4", "c-1")).toBe(true);
    // Adding c-4 blocks c-2 is a direct two-card circle.
    expect(wouldCreateCycle(cards, "c-4", "c-2")).toBe(true);
    // Adding c-1 blocks c-4 points down the chain — no circle.
    expect(wouldCreateCycle(cards, "c-1", "c-4")).toBe(false);
  });
});

describe("isPairLinked", () => {
  it("matches either direction; a dangling row still occupies its pair", () => {
    const { cards } = fixture();
    expect(isPairLinked(cards, "c-1", "c-2")).toBe(true);
    expect(isPairLinked(cards, "c-2", "c-1")).toBe(true);
    // lk-2 points at the gone c-x — the reducer counts the pair as taken
    // (it never scrubs rows), so the UI must agree.
    expect(isPairLinked(cards, "c-1", "c-x")).toBe(true);
    expect(isPairLinked(cards, "c-1", "c-4")).toBe(false);
  });
});

describe("suggestLinkTargets", () => {
  it("excludes self, archived and linked cards; ranks prefix matches first", () => {
    const { cards } = fixture();
    // From c-4: "Alpha" matches as a prefix (ranked first), "Zebra" ends
    // in "a"; "Mango" matches "a" but is archived.
    expect(suggestLinkTargets(cards, "c-4", "a").map((c) => c.id)).toEqual([
      "c-2",
      "c-1",
    ]);
    // From c-1: "Melon" is the only live match for "m" ("Mango" is
    // archived; c-2 is already linked to c-1 but would not match anyway).
    expect(suggestLinkTargets(cards, "c-1", "m").map((c) => c.id)).toEqual([
      "c-4",
    ]);
    // Already-linked pairs are not offered again.
    expect(suggestLinkTargets(cards, "c-1", "alp")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(suggestLinkTargets(fixture().cards, "c-1", "  ")).toEqual([]);
  });
});
