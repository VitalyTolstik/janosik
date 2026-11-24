import type { Board as BoardRow, Prisma } from "@prisma/client";
import type { BoardAggregate } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";
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

  it("loads a miss without filling the cache", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const db = dbDouble();
    const board = boardRow(5n);
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });

    await expect(loader.load(db, "board-1", { board })).resolves.toEqual(
      aggregate(),
    );
    expect(loadSpy).toHaveBeenCalledWith(db, "board-1", { board });
    expect(cache.revisionOf("board-1")).toBeNull();
    // No revision re-read / second connection on the read path at all.
    expect(db.board.findUnique).not.toHaveBeenCalled();
  });

  it("does not fill on a hint-only miss or a no-hint miss", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const db = dbDouble();
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });

    await loader.load(db, "board-1", { revision: 5n });
    expect(cache.revisionOf("board-1")).toBeNull();

    (db.board.findFirst as jest.Mock).mockResolvedValue(boardRow(5n));
    await loader.load(db, "board-1");
    expect(cache.revisionOf("board-1")).toBeNull();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it("fills a miss only when the caller declares a snapshot", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const loader = new BoardAggregateLoader(cache);
    const db = dbDouble();
    const board = boardRow(5n);
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });

    await loader.load(db, "board-1", { board, snapshot: true });
    expect(cache.revisionOf("board-1")).toBe(5n);

    cache.clear();
    await loader.load(db, "board-1", { board });
    expect(cache.revisionOf("board-1")).toBeNull();
  });

  it("loadFresh reads in a RepeatableRead transaction and warms the cache", async () => {
    const cache = new BoardAggregateCacheService(BOUNDS);
    const db = dbDouble();
    (db.board.findFirst as jest.Mock).mockResolvedValue(boardRow(5n));
    loadSpy.mockResolvedValue({ board: aggregate(), revision: 5n });
    const prisma = {
      $transaction: jest.fn(
        async (fn: (client: unknown) => Promise<unknown>, _options: unknown) =>
          fn(db),
      ),
    } as unknown as PrismaService;
    const loader = new BoardAggregateLoader(cache, prisma);

    await expect(loader.loadFresh("board-1")).resolves.toEqual(aggregate());
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "RepeatableRead" }),
    );
    expect(cache.revisionOf("board-1")).toBe(5n);

    loadSpy.mockClear();
    const hit = await loader.loadWithRevision(dbDouble(), "board-1", {
      revision: 5n,
    });
    expect(hit?.board).toEqual(aggregate());
    expect(loadSpy).not.toHaveBeenCalled();
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
