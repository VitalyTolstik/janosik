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
});
