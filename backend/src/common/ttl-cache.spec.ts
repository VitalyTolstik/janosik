import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves a value within the window and expires it after", () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    jest.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(1);
    jest.advanceTimersByTime(1);
    expect(cache.get("a")).toBeUndefined();
  });

  it("is disabled at ttl <= 0", () => {
    const cache = new TtlCache<string, number>(0);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.enabled).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("supports delete and clear", () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry past the bound", () => {
    const cache = new TtlCache<string, number>(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    // A hit makes `a` newer than `b`;
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
    expect(cache.limit).toBe(2);
  });

  it("does not extend a key's TTL on a hit", () => {
    const cache = new TtlCache<string, number>(1000, 2);
    cache.set("a", 1);
    jest.advanceTimersByTime(600);
    expect(cache.get("a")).toBe(1);
    jest.advanceTimersByTime(400);
    expect(cache.get("a")).toBeUndefined();
  });

  it("deletes matching keys only", () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set("board/1:user/1", 1);
    cache.set("board/1:user/2", 2);
    cache.set("board/2:user/1", 3);
    expect(cache.deleteWhere((key) => key.startsWith("board/1:"))).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.get("board/2:user/1")).toBe(3);
  });
});
