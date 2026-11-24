import type { BoardAggregate } from "@janosik/shared";
import {
  BOARD_AGGREGATE_CACHE_ENTRY_OVERHEAD_BYTES,
  BoardAggregateCacheService,
} from "./board-aggregate-cache";

/** A small but structurally complete aggregate (cards/columns/labels). */
function aggregate(id = "board-1", cardTitle = "One"): BoardAggregate {
  return {
    id,
    title: `Board ${id}`,
    columns: [
      { id: `${id}-col`, title: "Todo", cardIds: [`${id}-card`], createdAt: 1 },
    ],
    cards: {
      [`${id}-card`]: {
        id: `${id}-card`,
        title: cardTitle,
        labelIds: [],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    labels: [{ id: `${id}-label`, name: "Bug", color: "red" }],
    createdAt: 1,
    updatedAt: 2,
  };
}

const BOUNDS = { entries: 32, bytes: 32 * 1024 * 1024 };

describe("BoardAggregateCacheService", () => {
  it("serves an entry only at its exact revision", () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    cache.set("board-1", 7n, aggregate());

    expect(cache.get("board-1", 7n)).toEqual(aggregate());
    expect(cache.get("board-1", 8n)).toBeNull();
    expect(cache.get("board-2", 7n)).toBeNull();
    expect(cache.stats).toMatchObject({ hits: 1, misses: 2 });
  });

  it("ignores a stale set so a newer entry is never overwritten", () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    cache.set("board-1", 8n, aggregate("board-1", "New"));
    cache.set("board-1", 7n, aggregate("board-1", "Old"));

    expect(cache.revisionOf("board-1")).toBe(8n);
    expect(cache.get("board-1", 8n)?.cards["board-1-card"]?.title).toBe("New");
    expect(cache.stats.staleSets).toBe(1);
  });

  it("treats an equal-revision set as a no-op", () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    cache.set("board-1", 3n, aggregate("board-1", "First"));
    cache.set("board-1", 3n, aggregate("board-1", "Second"));

    expect(cache.get("board-1", 3n)?.cards["board-1-card"]?.title).toBe(
      "First",
    );
    expect(cache.stats).toMatchObject({ entries: 1, staleSets: 0 });
  });

  it("evicts the least recently used entry at the entry cap", () => {
    const cache = new BoardAggregateCacheService({ ...BOUNDS, entries: 2 });
    cache.set("a", 1n, aggregate("a"));
    cache.set("b", 1n, aggregate("b"));
    // Touch `a` so `b` becomes the oldest.
    expect(cache.get("a", 1n)).not.toBeNull();
    cache.set("c", 1n, aggregate("c"));

    expect(cache.get("b", 1n)).toBeNull();
    expect(cache.get("a", 1n)).not.toBeNull();
    expect(cache.get("c", 1n)).not.toBeNull();
    expect(cache.stats).toMatchObject({ entries: 2, evictions: 1 });
  });

  it("evicts by approximate bytes", () => {
    const probe = new BoardAggregateCacheService(BOUNDS);
    probe.set("a", 1n, aggregate("a"));
    probe.set("b", 1n, aggregate("b"));
    const both = probe.stats.bytes;
    // Not even both entries fit: the second insert evicts the first.
    const cache = new BoardAggregateCacheService({
      entries: 10,
      bytes: both - 1,
    });
    cache.set("a", 1n, aggregate("a"));
    cache.set("b", 1n, aggregate("b"));

    expect(cache.get("a", 1n)).toBeNull();
    expect(cache.get("b", 1n)).not.toBeNull();
    expect(cache.stats).toMatchObject({ entries: 1, evictions: 1 });
    expect(cache.stats.bytes).toBeLessThanOrEqual(both - 1);
  });

  it("refuses a single entry larger than the whole byte budget", () => {
    const one = aggregate("a");
    const bytes =
      Buffer.byteLength(JSON.stringify(one), "utf8") +
      BOARD_AGGREGATE_CACHE_ENTRY_OVERHEAD_BYTES;
    const cache = new BoardAggregateCacheService({
      entries: 10,
      bytes: bytes - 1,
    });

    cache.set("a", 1n, one);
    expect(cache.get("a", 1n)).toBeNull();
    expect(cache.stats).toMatchObject({
      entries: 0,
      oversizeSkips: 1,
      evictions: 0,
    });
  });

  it("is a pure no-op when either bound is 0", () => {
    for (const bounds of [
      { entries: 0, bytes: 1024 },
      { entries: 32, bytes: 0 },
    ]) {
      const cache = new BoardAggregateCacheService(bounds);
      expect(cache.enabled).toBe(false);
      cache.set("board-1", 1n, aggregate());
      expect(cache.get("board-1", 1n)).toBeNull();
      expect(cache.stats).toMatchObject({
        entries: 0,
        bytes: 0,
        hits: 0,
        misses: 1,
      });
    }
  });

  it("deep-clones on both store and get so callers cannot poison the cache", () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const source = aggregate();
    cache.set("board-1", 1n, source);
    source.cards["board-1-card"]!.title = "Mutated after set";
    source.columns[0]!.title = "Mutated column";

    const first = cache.get("board-1", 1n)!;
    first.cards["board-1-card"]!.title = "Mutated hit";
    first.labels.push({ id: "extra", name: "Extra", color: "blue" });

    const second = cache.get("board-1", 1n)!;
    expect(second.cards["board-1-card"]!.title).toBe("One");
    expect(second.columns[0]!.title).toBe("Todo");
    expect(second.labels).toHaveLength(1);
  });

  it("counts hits, misses, evictions and stale sets", () => {
    const cache = new BoardAggregateCacheService({ ...BOUNDS, entries: 1 });
    expect(cache.get("a", 1n)).toBeNull();
    cache.set("a", 1n, aggregate("a"));
    expect(cache.get("a", 1n)).not.toBeNull();
    expect(cache.get("a", 2n)).toBeNull();
    cache.set("b", 1n, aggregate("b"));
    cache.set("b", 0n, aggregate("b"));

    expect(cache.stats).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 2,
      evictions: 1,
      staleSets: 1,
    });
    expect(cache.stats.bytes).toBeGreaterThan(0);
  });

  it("rejects a negative or non-integer bound", () => {
    expect(
      () => new BoardAggregateCacheService({ entries: -1, bytes: 1024 }),
    ).toThrow(/entries/);
    expect(
      () => new BoardAggregateCacheService({ entries: 1, bytes: Number.NaN }),
    ).toThrow(/bytes/);
    expect(
      () => new BoardAggregateCacheService({ entries: 1.5, bytes: 1024 }),
    ).toThrow(/entries/);
  });
});
