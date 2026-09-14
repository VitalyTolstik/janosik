import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncedLocalStoragePersistence } from "@/utils/persistence";

/**
 * Tests for the debounced persistence adapter: coalescing rapid writes into
 * one, flushing immediately on demand, reporting every write attempt to the
 * write listener instead of failing silently, and holding writes back so a
 * corrupt stored value cannot be overwritten before the user is told
 * (TASK-21.2).
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createDebouncedLocalStoragePersistence", () => {
  it("does not write before the debounce window elapses", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 1 });
    expect(localStorage.getItem("janosik-persist-test")).toBeNull();
    vi.advanceTimersByTime(399);
    expect(localStorage.getItem("janosik-persist-test")).toBeNull();
  });

  it("writes the coalesced value after the debounce window", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 1 });
    vi.advanceTimersByTime(100);
    persistence.queueSave({ n: 2 });
    vi.advanceTimersByTime(100);
    persistence.queueSave({ n: 3 });
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem("janosik-persist-test")).toBe('{"n":3}');
  });

  it("flush() writes pending data immediately", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 7 });
    persistence.flush();
    expect(localStorage.getItem("janosik-persist-test")).toBe('{"n":7}');
  });

  it("flush() is a no-op when nothing is pending", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 1 });
    persistence.flush();
    // After the first flush nothing remains queued.
    persistence.flush();
    expect(localStorage.getItem("janosik-persist-test")).toBe('{"n":1}');
  });

  it("clears the timer after a flush", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 1 });
    persistence.flush();
    vi.advanceTimersByTime(1000);
    // The pending timer was cleared — no second write happens.
    expect(localStorage.getItem("janosik-persist-test")).toBe('{"n":1}');
  });

  it("load() round-trips what was stored", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.queueSave({ n: 5 });
    persistence.flush();
    expect(persistence.load()).toEqual({ status: "ok", value: { n: 5 } });
  });

  it("load() distinguishes a missing key from an unparsable one", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    expect(persistence.load()).toEqual({ status: "missing" });

    localStorage.setItem("janosik-persist-test", "{not json");
    const result = persistence.load();
    expect(result.status).toBe("corrupt");
    // The unparsable text was copied aside before anything overwrites it.
    if (result.status !== "corrupt") throw new Error("expected corrupt");
    expect(result.quarantineKey).not.toBeNull();
    expect(localStorage.getItem(result.quarantineKey!)).toBe("{not json");
  });

  it("reports failed writes to the write listener", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    const listener = vi.fn();
    persistence.setWriteListener(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    persistence.queueSave({ n: 1 });
    vi.advanceTimersByTime(400);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(false);
  });

  it("reports successful writes to the write listener, with the size", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    const listener = vi.fn();
    persistence.setWriteListener(listener);
    persistence.queueSave({ n: 1 });
    vi.advanceTimersByTime(400);
    expect(listener).toHaveBeenCalledWith(true, undefined, expect.any(Number));
    // The report carries the serialized size, so a nearly-full storage can
    // be flagged before a write actually fails (TASK-21.5).
    expect(listener.mock.calls[0]?.[2]).toBe('{"n":1}'.length);
  });

  it("writes nothing while writes are held back", () => {
    localStorage.setItem("janosik-persist-test", "{corrupt");
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.setWritesEnabled(false);
    persistence.queueSave({ n: 1 });
    vi.advanceTimersByTime(400);
    persistence.flush();
    // The value in storage is the user's only copy — it stays untouched.
    expect(localStorage.getItem("janosik-persist-test")).toBe("{corrupt");
  });

  it("writes the value queued while held back once writes resume", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    persistence.setWritesEnabled(false);
    persistence.queueSave({ n: 9 });
    vi.advanceTimersByTime(400);
    persistence.setWritesEnabled(true);
    expect(localStorage.getItem("janosik-persist-test")).toBe('{"n":9}');
  });
});
