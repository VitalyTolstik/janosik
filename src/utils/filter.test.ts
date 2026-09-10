import { describe, expect, it } from "vitest";

import type { Card } from "@/types/kanban";
import {
  activeFacetCount,
  createdDayRange,
  createdFromMs,
  EMPTY_FILTER,
  filterCardIds,
  isFilterActive,
  matchesCardFilter,
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
