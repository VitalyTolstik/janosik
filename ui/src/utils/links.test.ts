import { describe, expect, it } from "vitest";
import type { Board, Card } from "@janosik/shared";

import {
  cardLinkIndex,
  isPairLinked,
  linkSignature,
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
    // c-1: one live outgoing row (lk-1); the dangling one does not count.
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

  it("keeps a dangling row in outgoing so the dialog can remove it", () => {
    const { cards } = fixture();
    const facts = cardLinkIndex(cards).factsOf("c-1");
    // Both rows are stored on the card — the dangling one included, because
    // it occupies the card's row cap and must stay removable.
    expect(facts.outgoing.map((link) => link.id)).toEqual(["lk-1", "lk-2"]);
    // … but only the live one is a relation the board can show.
    expect(facts.degree).toBe(1);
    // The dangling row raises nobody's incoming side.
    expect(cardLinkIndex(cards).factsOf("c-x").incoming).toEqual([]);
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

describe("linkSignature", () => {
  it("reuses the snapshot signature and invalidates on a new snapshot", () => {
    const { cards } = fixture();
    const first = linkSignature(cards);
    expect(linkSignature(cards)).toBe(first);

    // A restore rebuilds the cards map: the new object must not keep the
    // old signature (TASK-156).
    const restored = { ...cards };
    restored["c-1"] = card("c-1", "Zebra", {
      links: [{ id: "lk-9", type: "duplicates", targetCardId: "c-4" }],
    });
    expect(linkSignature(restored)).not.toBe(first);
    expect(linkSignature(restored)).toContain("lk-9:duplicates:c-4");
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

  it("excludes a pair linked from the other end too", () => {
    // c-2 holds no rows of its own; the link lives on c-1. Asking from c-2
    // must still hide c-1 — the neighbour set is direction-agnostic.
    const { cards } = fixture();
    expect(suggestLinkTargets(cards, "c-2", "zeb")).toEqual([]);
  });

  it("stays linear in board size on a broad query", () => {
    // Guards the rewrite: the old implementation re-scanned the whole board
    // once per candidate, which is O(N²) on a query that matches many
    // titles (measured at 65 ms for 1 000 cards, 621 ms for 3 000). Counting
    // card reads makes the growth rate observable without timing anything.
    const readsFor = (size: number): number => {
      const cards: Board["cards"] = {};
      for (let i = 0; i < size; i += 1) {
        cards[`p-${i}`] = card(`p-${i}`, `Task ${i}`);
      }
      cards["p-0"].links = [{ id: "x", type: "blocks", targetCardId: "p-1" }];
      let reads = 0;
      const counted = new Proxy(cards, {
        get(target, key: string) {
          reads += 1;
          return target[key];
        },
      }) as Board["cards"];
      expect(suggestLinkTargets(counted, "p-0", "Task", 8)).toHaveLength(8);
      return reads;
    };

    const small = readsFor(100);
    const large = readsFor(200);
    // Two fixed passes over the board (neighbour set + match loop), so
    // doubling the cards doubles the reads. The quadratic version
    // quadrupled them.
    expect(large).toBeLessThanOrEqual(small * 2.5);
    expect(large).toBeLessThanOrEqual(200 * 4);
  });
});
