import { describe, expect, it } from "vitest";

import type { Board, Card, Label } from "@/types/kanban";
import {
  activeFacetCount,
  createdDayRange,
  createdFromMs,
  descriptionSnippet,
  EMPTY_FILTER,
  filterCardIds,
  isFilterActive,
  matchesCardFilter,
  searchBoards,
  splitHighlight,
  type CardFilter,
} from "@/utils/filter";

const NOW = new Date("2025-06-15T12:00:00").getTime();

function card(
  id: string,
  title: string,
  labelIds: string[],
  createdAt = NOW,
): Card {
  return {
    id,
    title,
    labelIds,
    createdAt,
    updatedAt: NOW,
  };
}

describe("isFilterActive", () => {
  it("is false for the empty filter", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it("is true when any facet is set", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, query: "  buy  " })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, labelIds: ["a"] })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, noLabel: true })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, created: "7d" })).toBe(true);
  });

  it("is true when an exact day is set", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, createdOn: "2025-06-15" })).toBe(
      true,
    );
  });

  it("is true when the due facet is set", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, due: "overdue" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, due: "none" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, due: "any" })).toBe(false);
  });
});

describe("activeFacetCount", () => {
  it("counts each independent facet", () => {
    expect(activeFacetCount(EMPTY_FILTER)).toBe(0);
    expect(activeFacetCount({ ...EMPTY_FILTER, query: "x" })).toBe(1);
    // The whole label picker counts as one facet.
    expect(
      activeFacetCount({
        ...EMPTY_FILTER,
        labelIds: ["a", "b"],
        noLabel: true,
      }),
    ).toBe(1);
    expect(
      activeFacetCount({
        ...EMPTY_FILTER,
        query: "x",
        labelIds: ["a"],
        created: "7d",
        createdOn: "2025-06-15",
        due: "soon",
      }),
    ).toBe(5);
  });
});

describe("createdFromMs", () => {
  it("returns null for any", () => {
    expect(createdFromMs("any", NOW)).toBeNull();
  });

  it("returns local midnight for today", () => {
    const midnight = new Date(NOW).setHours(0, 0, 0, 0);
    expect(createdFromMs("today", NOW)).toBe(midnight);
  });

  it("returns rolling windows", () => {
    expect(createdFromMs("7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(createdFromMs("30d", NOW)).toBe(NOW - 30 * 86_400_000);
  });
});

describe("createdDayRange", () => {
  it("returns the local-day range for a valid date", () => {
    expect(createdDayRange("2025-06-15")).toEqual([
      new Date(2025, 5, 15).getTime(),
      new Date(2025, 5, 15).getTime() + 86_400_000,
    ]);
  });

  it("returns null for an invalid date", () => {
    expect(createdDayRange("2025-13-40")).toBeNull();
    expect(createdDayRange("tomorrow")).toBeNull();
    expect(createdDayRange("2025-6-1")).toBeNull();
  });
});

describe("matchesCardFilter", () => {
  const c = card("c1", "Buy milk", ["a"]);

  it("matches an empty filter", () => {
    expect(matchesCardFilter(c, EMPTY_FILTER, NOW)).toBe(true);
  });

  it("matches a case-insensitive query substring", () => {
    expect(matchesCardFilter(c, { ...EMPTY_FILTER, query: "MILK" }, NOW)).toBe(
      true,
    );
    expect(matchesCardFilter(c, { ...EMPTY_FILTER, query: "bread" }, NOW)).toBe(
      false,
    );
  });

  it("uses any-match semantics for labels", () => {
    const labeled = card("c2", "T", ["a", "b"]);
    const filter = { ...EMPTY_FILTER, labelIds: ["b", "z"] };
    expect(matchesCardFilter(labeled, filter, NOW)).toBe(true);
    expect(
      matchesCardFilter(labeled, { ...EMPTY_FILTER, labelIds: ["z"] }, NOW),
    ).toBe(false);
  });

  it("uses all-match semantics when labelMatch is all", () => {
    const both = card("c5", "T", ["a", "b"]);
    const one = card("c6", "T", ["a"]);
    const filter = {
      ...EMPTY_FILTER,
      labelIds: ["a", "b"],
      labelMatch: "all" as const,
    };
    expect(matchesCardFilter(both, filter, NOW)).toBe(true);
    expect(matchesCardFilter(one, filter, NOW)).toBe(false);
    // A single selected label behaves the same in both modes.
    expect(
      matchesCardFilter(
        one,
        { ...EMPTY_FILTER, labelIds: ["a"], labelMatch: "all" },
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps noLabel OR-ed with all-match labels", () => {
    const unlabeled = card("c7", "T", []);
    const one = card("c8", "T", ["a"]);
    const filter = {
      ...EMPTY_FILTER,
      labelIds: ["a", "b"],
      labelMatch: "all" as const,
      noLabel: true,
    };
    expect(matchesCardFilter(unlabeled, filter, NOW)).toBe(true);
    // noLabel is OR-ed with the label match: a card with only "a" neither
    // has all of a+b nor lacks labels, so it is excluded in ALL mode.
    expect(matchesCardFilter(one, filter, NOW)).toBe(false);
    const both = card("c10", "T", ["a", "b"]);
    expect(matchesCardFilter(both, filter, NOW)).toBe(true);
    const labeledOther = card("c9", "T", ["z"]);
    expect(matchesCardFilter(labeledOther, filter, NOW)).toBe(false);
  });

  it("handles noLabel combined with selected labels", () => {
    const unlabeled = card("c3", "T", []);
    // OR: no label OR any selected label.
    expect(
      matchesCardFilter(unlabeled, { ...EMPTY_FILTER, noLabel: true }, NOW),
    ).toBe(true);
    const labeled = card("c4", "T", ["a"]);
    expect(
      matchesCardFilter(
        labeled,
        { ...EMPTY_FILTER, noLabel: true, labelIds: ["a"] },
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesCardFilter(
        labeled,
        { ...EMPTY_FILTER, noLabel: true, labelIds: ["z"] },
        NOW,
      ),
    ).toBe(false);
  });

  it("filters by creation window", () => {
    const old = card("c5", "T", [], NOW - 10 * 86_400_000);
    expect(
      matchesCardFilter(old, { ...EMPTY_FILTER, created: "7d" }, NOW),
    ).toBe(false);
    expect(
      matchesCardFilter(old, { ...EMPTY_FILTER, created: "30d" }, NOW),
    ).toBe(true);
  });

  it("filters by an exact creation day", () => {
    const onDay = card("c7", "T", [], new Date(2025, 5, 15, 10, 0).getTime());
    const nextDay = card("c8", "T", [], new Date(2025, 5, 16, 0, 0).getTime());
    const filter = { ...EMPTY_FILTER, createdOn: "2025-06-15" };
    expect(matchesCardFilter(onDay, filter, NOW)).toBe(true);
    expect(matchesCardFilter(nextDay, filter, NOW)).toBe(false);
  });

  it("an exact day overrides the relative window", () => {
    const today = card("c9", "T", [], NOW);
    const filter: CardFilter = {
      ...EMPTY_FILTER,
      created: "today",
      createdOn: "2020-01-01",
    };
    expect(matchesCardFilter(today, filter, NOW)).toBe(false);
  });

  it("an invalid exact day matches nothing but does not crash", () => {
    const c = card("c10", "T", []);
    expect(
      matchesCardFilter(c, { ...EMPTY_FILTER, createdOn: "nope" }, NOW),
    ).toBe(false);
  });

  describe("due facet", () => {
    const HOUR = 86_400_000 / 24;
    const overdue = { ...card("d1", "T", []), dueDate: NOW - HOUR };
    const soon = { ...card("d2", "T", []), dueDate: NOW + 23 * HOUR };
    const atEdge = { ...card("d3", "T", []), dueDate: NOW + 24 * HOUR };
    const later = { ...card("d4", "T", []), dueDate: NOW + 5 * 86_400_000 };
    const noDue = card("d5", "T", []);

    it("overdue matches only past deadlines", () => {
      const filter = { ...EMPTY_FILTER, due: "overdue" } as CardFilter;
      expect(matchesCardFilter(overdue, filter, NOW)).toBe(true);
      expect(matchesCardFilter(soon, filter, NOW)).toBe(false);
      expect(matchesCardFilter(later, filter, NOW)).toBe(false);
      expect(matchesCardFilter(noDue, filter, NOW)).toBe(false);
    });

    it("soon matches deadlines within the next 24 hours (inclusive)", () => {
      const filter = { ...EMPTY_FILTER, due: "soon" } as CardFilter;
      expect(matchesCardFilter(soon, filter, NOW)).toBe(true);
      expect(matchesCardFilter(atEdge, filter, NOW)).toBe(true);
      expect(matchesCardFilter(overdue, filter, NOW)).toBe(false);
      expect(matchesCardFilter(later, filter, NOW)).toBe(false);
      expect(matchesCardFilter(noDue, filter, NOW)).toBe(false);
    });

    it("none matches only cards without a deadline", () => {
      const filter = { ...EMPTY_FILTER, due: "none" } as CardFilter;
      expect(matchesCardFilter(noDue, filter, NOW)).toBe(true);
      expect(matchesCardFilter(overdue, filter, NOW)).toBe(false);
      expect(matchesCardFilter(later, filter, NOW)).toBe(false);
    });

    it("any does not restrict the board", () => {
      const filter = { ...EMPTY_FILTER, due: "any" } as CardFilter;
      expect(matchesCardFilter(overdue, filter, NOW)).toBe(true);
      expect(matchesCardFilter(noDue, filter, NOW)).toBe(true);
    });

    it("combines with the query facet (AND)", () => {
      const named = { ...card("d6", "Pay rent", []), dueDate: NOW - HOUR };
      expect(
        matchesCardFilter(
          named,
          { ...EMPTY_FILTER, due: "overdue", query: "rent" },
          NOW,
        ),
      ).toBe(true);
      expect(
        matchesCardFilter(
          named,
          { ...EMPTY_FILTER, due: "overdue", query: "milk" },
          NOW,
        ),
      ).toBe(false);
    });
  });

  it("combines facets with AND", () => {
    const c = card("c6", "Buy milk", ["a"], NOW - 3 * 86_400_000);
    expect(
      matchesCardFilter(
        c,
        { ...EMPTY_FILTER, query: "milk", labelIds: ["a"], created: "30d" },
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesCardFilter(
        c,
        { ...EMPTY_FILTER, query: "bread", labelIds: ["a"], created: "30d" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("filterCardIds", () => {
  const cards: Record<string, Card> = {
    c1: card("c1", "Buy milk", ["a"]),
    c2: card("c2", "Ship feature", ["a", "b"]),
    c3: card("c3", "Refactor", ["b"]),
    c4: card("c4", "Old task", ["b"], NOW - 20 * 86_400_000),
  };

  it("preserves column order and drops missing cards", () => {
    const columns = { col1: ["c3", "c1", "nope", "c2"], col2: ["c4"] };
    const result = filterCardIds(columns, cards, {
      ...EMPTY_FILTER,
      query: "buy",
    });
    expect(result).toEqual({ col1: ["c1"], col2: [] });
  });

  it("applies label any-match per column", () => {
    const columns = { col1: ["c1", "c3", "c2"], col2: ["c4"] };
    const result = filterCardIds(columns, cards, {
      ...EMPTY_FILTER,
      labelIds: ["a"],
    });
    expect(result).toEqual({ col1: ["c1", "c2"], col2: [] });
  });

  it("applies an exact creation day per column", () => {
    const onDay = card(
      "c5",
      "Day task",
      ["a"],
      new Date(2025, 5, 15, 8, 0).getTime(),
    );
    const offDay = card(
      "c6",
      "Off task",
      ["a"],
      new Date(2025, 5, 20, 8, 0).getTime(),
    );
    const columns = { col1: ["c6", "c5"] };
    const result = filterCardIds(
      columns,
      { c5: onDay, c6: offDay },
      { ...EMPTY_FILTER, createdOn: "2025-06-15" },
    );
    expect(result).toEqual({ col1: ["c5"] });
  });

  it("applies the due facet per column", () => {
    const overdue = { ...card("c7", "Late task", ["a"]), dueDate: NOW - 1 };
    const future = {
      ...card("c8", "Future task", ["a"]),
      dueDate: NOW + 5 * 86_400_000,
    };
    const columns = { col1: ["c7", "c8"] };
    const result = filterCardIds(
      columns,
      { c7: overdue, c8: future },
      { ...EMPTY_FILTER, due: "overdue" },
      NOW,
    );
    expect(result).toEqual({ col1: ["c7"] });
  });
});

describe("query semantics (title + description + label names)", () => {
  const labels: Label[] = [
    { id: "a", name: "Design", color: "red" },
    { id: "b", name: "Backend", color: "blue" },
  ];
  const c = card("c1", "Buy milk", ["a"]);
  const withDesc = {
    ...card("c2", "Tidy up", []),
    description: "Under the sofa",
  };

  it("matches the card description", () => {
    expect(
      matchesCardFilter(
        withDesc,
        { ...EMPTY_FILTER, query: "sofa" },
        NOW,
        labels,
      ),
    ).toBe(true);
    expect(
      matchesCardFilter(c, { ...EMPTY_FILTER, query: "sofa" }, NOW, labels),
    ).toBe(false);
  });

  it("matches label names, not just ids", () => {
    expect(
      matchesCardFilter(c, { ...EMPTY_FILTER, query: "design" }, NOW, labels),
    ).toBe(true);
    expect(
      matchesCardFilter(c, { ...EMPTY_FILTER, query: "backend" }, NOW, labels),
    ).toBe(false);
  });
});

describe("searchBoards", () => {
  const labels: Label[] = [{ id: "a", name: "Design", color: "red" }];
  const activeBoard: Board = {
    id: "b1",
    title: "Marketing",
    columns: [
      { id: "col1", title: "To do", cardIds: ["c1", "c2"], createdAt: NOW },
      { id: "col2", title: "Doing", cardIds: ["c3"], createdAt: NOW },
    ],
    cards: {
      c1: card("c1", "Landing redesign", ["a"]),
      c2: { ...card("c2", "Newsletter", []), description: "Q3 plan notes" },
      c3: card("c3", "Old card", []),
    },
    labels,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const archivedBoard: Board = {
    ...activeBoard,
    id: "b2",
    title: "Old Marketing board",
    archivedAt: NOW,
    columns: [{ id: "col1", title: "To do", cardIds: ["c4"], createdAt: NOW }],
    cards: { c4: card("c4", "Marketing retrospective", []) },
  };
  const boards = [archivedBoard, activeBoard];

  it("finds cards by title and reports the board and column", () => {
    const hits = searchBoards(boards, "retro");
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit.kind).toBe("card");
    if (hit.kind !== "card") return;
    expect(hit.card.id).toBe("c4");
    expect(hit.boardId).toBe("b2");
    expect(hit.columnTitle).toBe("To do");
    expect(hit.matchIn).toBe("title");
    expect(hit.boardArchived).toBe(true);
  });

  it("matches descriptions and labels with the right matchIn", () => {
    const hits = searchBoards([activeBoard], "q3 plan");
    expect(hits).toHaveLength(1);
    if (hits[0].kind !== "card") return;
    expect(hits[0].matchIn).toBe("description");

    const byLabel = searchBoards([activeBoard], "design");
    expect(
      byLabel.map((h) => (h.kind === "card" ? h.card.id : h.boardId)),
    ).toContain("c1");
  });

  it("finds archived cards even though they are off every column", () => {
    const board: Board = {
      ...activeBoard,
      columns: [
        { id: "col1", title: "To do", cardIds: ["c1", "c2"], createdAt: NOW },
        // c3 was archived — it is gone from its column's cardIds.
        { id: "col2", title: "Doing", cardIds: [], createdAt: NOW },
      ],
      cards: {
        ...activeBoard.cards,
        c3: { ...card("c3", "Old card", []), archivedAt: NOW },
      },
    };
    const hits = searchBoards([board], "old card");
    expect(hits).toHaveLength(1);
    if (hits[0].kind !== "card") return;
    expect(hits[0].cardArchived).toBe(true);
    expect(hits[0].boardArchived).toBe(false);
    expect(hits[0].columnTitle).toBeUndefined();
  });

  it("ranks active boards before archived ones", () => {
    const hits = searchBoards(boards, "marketing");
    // Board-title hits: active "Marketing" before archived "Old Marketing board".
    const boardHits = hits
      .filter((h) => h.kind === "board")
      .map((h) => (h.kind === "board" ? h.boardId : ""));
    expect(boardHits).toEqual(["b1", "b2"]);
  });

  it("appends board-title matches after card hits and finds board titles", () => {
    const hits = searchBoards([activeBoard], "newsletter");
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("card");

    const boardHits = searchBoards(boards, "old marketing board");
    expect(
      boardHits.some((h) => h.kind === "board" && h.boardId === "b2"),
    ).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(searchBoards(boards, "  ")).toEqual([]);
  });
});

describe("splitHighlight", () => {
  it("splits text around case-insensitive matches", () => {
    expect(splitHighlight("Buy Milk now", "milk")).toEqual([
      "Buy ",
      { match: true, text: "Milk" },
      " now",
    ]);
  });

  it("handles no-match and empty query", () => {
    expect(splitHighlight("abc", "zzz")).toEqual(["abc"]);
    expect(splitHighlight("abc", "  ")).toEqual(["abc"]);
  });

  it("supports multiple matches", () => {
    expect(splitHighlight("aaa", "a")).toEqual([
      { match: true, text: "a" },
      { match: true, text: "a" },
      { match: true, text: "a" },
    ]);
  });
});

describe("descriptionSnippet", () => {
  const text =
    "This is a long description about the Q3 marketing plan for the team";

  it("returns null when there is no match", () => {
    expect(descriptionSnippet(text, "zzz")).toBeNull();
  });

  it("centers the snippet around the first match", () => {
    const snippet = descriptionSnippet(text, "Q3", 15);
    expect(snippet).not.toBeNull();
    const joined = snippet!
      .map((s) => (typeof s === "string" ? s : s.text))
      .join("");
    expect(joined.startsWith("…")).toBe(true);
    expect(joined).toContain("Q3");
    expect(joined.length).toBeLessThan(text.length);
  });

  it("keeps the exact matched casing", () => {
    const snippet = descriptionSnippet(text, "MARKETING", 15);
    const match = snippet!.find((s) => typeof s !== "string") as {
      match: true;
      text: string;
    };
    expect(match.text).toBe("marketing");
  });
});
