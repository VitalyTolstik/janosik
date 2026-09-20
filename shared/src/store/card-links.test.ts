import { describe, expect, it } from "vitest";
import type { Board, Card, CardLink } from "../types/kanban";
import {
  blocksReaches,
  hasLinkedPair,
  isCardLinkType,
  linkPairKey,
  linkedNeighbourIds,
  wouldCloseBlocksCycle,
} from "./card-links";

/**
 * The card-link rules (TASK-46) used to exist in three copies — reducer, UI
 * picker, server guard — and drifted apart. They live here now, so this is
 * the one place the rules are pinned down.
 */

function card(id: string, links?: CardLink[]): Card {
  return {
    id,
    title: id,
    labelIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...(links ? { links } : {}),
  };
}

/** `a -blocks-> b -blocks-> c`, plus an unrelated `relates_to` and a dangler. */
function chain(): Board["cards"] {
  return {
    a: card("a", [
      { id: "l1", type: "blocks", targetCardId: "b" },
      { id: "l4", type: "relates_to", targetCardId: "d" },
    ]),
    b: card("b", [{ id: "l2", type: "blocks", targetCardId: "c" }]),
    c: card("c", [{ id: "l3", type: "blocks", targetCardId: "gone" }]),
    d: card("d"),
  };
}

describe("isCardLinkType", () => {
  it("accepts the known types and nothing else", () => {
    expect(isCardLinkType("blocks")).toBe(true);
    expect(isCardLinkType("relates_to")).toBe(true);
    expect(isCardLinkType("duplicates")).toBe(true);
    for (const bad of ["Blocks", "", "relates", null, undefined, 7, {}]) {
      expect(isCardLinkType(bad)).toBe(false);
    }
  });
});

describe("linkPairKey", () => {
  it("is order-independent", () => {
    expect(linkPairKey("x", "y")).toBe(linkPairKey("y", "x"));
    expect(linkPairKey("x", "y")).not.toBe(linkPairKey("x", "z"));
  });
});

describe("hasLinkedPair", () => {
  it("matches either direction and any type", () => {
    const cards = chain();
    expect(hasLinkedPair(cards, "a", "b")).toBe(true);
    // The row lives on `a`; asking from `b` finds it just the same.
    expect(hasLinkedPair(cards, "b", "a")).toBe(true);
    // `relates_to` occupies the pair exactly like `blocks`.
    expect(hasLinkedPair(cards, "d", "a")).toBe(true);
    expect(hasLinkedPair(cards, "a", "c")).toBe(false);
  });

  it("counts a dangling row: the pair stays occupied", () => {
    // `c` links to a card that no longer exists. The row is still there,
    // so re-linking that pair must stay refused until it is removed.
    expect(hasLinkedPair(chain(), "c", "gone")).toBe(true);
  });
});

describe("blocksReaches", () => {
  it("follows blocks edges transitively", () => {
    const cards = chain();
    expect(blocksReaches(cards, "a", "c")).toBe(true);
    expect(blocksReaches(cards, "a", "a")).toBe(true);
    expect(blocksReaches(cards, "c", "a")).toBe(false);
  });

  it("ignores non-blocks edges", () => {
    // a -relates_to-> d is not a dependency, so d is not reachable.
    expect(blocksReaches(chain(), "a", "d")).toBe(false);
  });

  it("terminates on a cycle instead of spinning", () => {
    const cards: Board["cards"] = {
      x: card("x", [{ id: "1", type: "blocks", targetCardId: "y" }]),
      y: card("y", [{ id: "2", type: "blocks", targetCardId: "x" }]),
    };
    expect(blocksReaches(cards, "x", "y")).toBe(true);
    expect(blocksReaches(cards, "y", "x")).toBe(true);
    // A node outside the cycle is simply unreachable — and the walk ends.
    expect(blocksReaches(cards, "x", "z")).toBe(false);
  });

  it("steps over a dangling edge", () => {
    expect(blocksReaches(chain(), "c", "gone")).toBe(true);
    expect(blocksReaches(chain(), "b", "gone")).toBe(true);
  });
});

describe("wouldCloseBlocksCycle", () => {
  it("refuses an edge that closes the chain, allows the forward one", () => {
    const cards = chain();
    // c -blocks-> a would close a -> b -> c -> a.
    expect(wouldCloseBlocksCycle(cards, "c", "a", "blocks")).toBe(true);
    // a -blocks-> c only shortcuts the existing direction.
    expect(wouldCloseBlocksCycle(cards, "a", "c", "blocks")).toBe(false);
  });

  it("never fires for a non-blocks type", () => {
    const cards = chain();
    expect(wouldCloseBlocksCycle(cards, "c", "a", "relates_to")).toBe(false);
    expect(wouldCloseBlocksCycle(cards, "c", "a", "duplicates")).toBe(false);
  });
});

describe("linkedNeighbourIds", () => {
  it("collects both directions in one pass", () => {
    const cards = chain();
    expect(linkedNeighbourIds(cards, "a")).toEqual(new Set(["b", "d"]));
    // `b` is reached from `a`'s row and holds one of its own.
    expect(linkedNeighbourIds(cards, "b")).toEqual(new Set(["a", "c"]));
    expect(linkedNeighbourIds(cards, "d")).toEqual(new Set(["a"]));
  });

  it("agrees with hasLinkedPair for every pair", () => {
    const cards = chain();
    const ids = [...Object.keys(cards), "gone"];
    for (const from of ids) {
      const neighbours = linkedNeighbourIds(cards, from);
      for (const to of ids) {
        if (from === to) continue;
        expect(neighbours.has(to)).toBe(hasLinkedPair(cards, from, to));
      }
    }
  });
});
