import type { Board as BoardRow, Prisma } from "@prisma/client";
import type { BoardAggregate } from "@janosik/shared";
import * as aggregateModule from "./board-aggregate";
import { BoardAggregateCacheService } from "./board-aggregate-cache";
import { BoardAggregateLoader } from "./board-aggregate-loader";

const BOUNDS = { entries: 8, bytes: 8 * 1024 * 1024 };

function aggregate(cardTitle = "One"): BoardAggregate {
  return {
    id: "board-1",
    title: "Board",
    columns: [
      { id: "col-1", title: "Todo", cardIds: ["card-1"], createdAt: 1 },
    ],
    cards: {
      "card-1": {
        id: "card-1",
        title: cardTitle,
        labelIds: [],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function boardRow(revision: bigint): BoardRow {
  return {
    id: "board-1",
    aggregateRevision: revision,
    deletedAt: null,
  } as unknown as BoardRow;
}

function dbDouble(): Prisma.TransactionClient {
  return {
    board: { findFirst: jest.fn(), findUnique: jest.fn() },
  } as unknown as Prisma.TransactionClient;
}

describe("BoardAggregateLoader", () => {
  const loadSpy = jest.spyOn(aggregateModule, "loadBoardAggregateWithRevision");

  afterEach(() => loadSpy.mockReset());
  afterAll(() => loadSpy.mockRestore());

  it("does not store a miss when cacheOnMiss is false", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const db = dbDouble();
    const board = boardRow(5n);
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });

    await expect(
      loader.load(db, "board-1", { board, cacheOnMiss: false }),
    ).resolves.toEqual(aggregate());
    expect(loadSpy).toHaveBeenCalledWith(db, "board-1", { board });
    expect(cache.revisionOf("board-1")).toBeNull();
    // A miss inside a write transaction must not even run the consistency
    // check — the caller caches explicitly after commit instead.
    expect(db.board.findUnique).not.toHaveBeenCalled();
  });

  it("stores only when the revision did not move during the load", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const db = dbDouble();
    const board = boardRow(5n);
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });

    (db.board.findUnique as jest.Mock).mockResolvedValueOnce({
      aggregateRevision: 6n,
    });
    await loader.load(db, "board-1", { board });
    expect(cache.revisionOf("board-1")).toBeNull();

    (db.board.findUnique as jest.Mock).mockResolvedValueOnce({
      aggregateRevision: 5n,
    });
    await loader.load(db, "board-1", { board });
    expect(cache.revisionOf("board-1")).toBe(5n);
  });

  it("serves a hit without calling the primitive and returns a clone", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const source = aggregate();
    cache.set("board-1", 7n, source);
    source.cards["card-1"]!.title = "Mutated after set";

    const loaded = await loader.loadWithRevision(dbDouble(), "board-1", {
      revision: 7n,
    });
    expect(loaded?.revision).toBe(7n);
    expect(loaded?.board.cards["card-1"]!.title).toBe("One");
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("remembers a post-commit aggregate the command path hands over", () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    loader.remember("board-1", 9n, aggregate("Committed"));

    expect(cache.get("board-1", 9n)?.cards["card-1"]?.title).toBe("Committed");
  });
});
