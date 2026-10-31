import type { BoardAggregate, PublicBoardMemberDto } from "@janosik/shared";
import { ShareAggregateCache } from "./share-aggregate-cache";

const board = { id: "b1" } as unknown as BoardAggregate;
const members: PublicBoardMemberDto[] = [];
const build = async () => ({ seq: 5, board, members });

describe("ShareAggregateCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves a cached aggregate while the seq is unchanged", async () => {
    const cache = new ShareAggregateCache(2000);
    await cache.load("b1", build);
    expect(cache.get("b1", 5)?.board).toBe(board);
  });

  it("misses when the seq moved (a command committed)", async () => {
    const cache = new ShareAggregateCache(2000);
    await cache.load("b1", build);
    expect(cache.get("b1", 6)).toBeUndefined();
  });

  it("expires after the window (the roster can change without a seq bump)", async () => {
    const cache = new ShareAggregateCache(2000);
    await cache.load("b1", build);
    jest.advanceTimersByTime(2000);
    expect(cache.get("b1", 5)).toBeUndefined();
  });

  it("single-flights concurrent rebuilds for one board", async () => {
    jest.useRealTimers();
    const cache = new ShareAggregateCache(2000);
    let calls = 0;
    const counting = () => {
      calls += 1;
      return Promise.resolve({ seq: 1, board, members });
    };
    const [a, b] = await Promise.all([
      cache.load("b1", counting),
      cache.load("b1", counting),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("is disabled at ttl <= 0 (never stores)", async () => {
    jest.useRealTimers();
    const cache = new ShareAggregateCache(0);
    await cache.load("b1", build);
    expect(cache.enabled).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.get("b1", 5)).toBeUndefined();
  });
});
