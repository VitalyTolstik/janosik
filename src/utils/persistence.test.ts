import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncedLocalStoragePersistence } from "@/utils/persistence";

/**
 * Tests for the debounced persistence adapter: coalescing rapid writes into
 * one, flushing immediately on demand, and surfacing storage failures
 * through the error handler instead of failing silently.
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
    expect(localStorage.getItem("janosik-persist-test")).toBe(
      '{"n":3}',
    );
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
    expect(persistence.load()).toEqual({ n: 5 });
  });

  it("invokes the error handler when storage writes fail", () => {
    const persistence = createDebouncedLocalStoragePersistence<{ n: number }>(
      "janosik-persist-test",
      400,
    );
    const handler = vi.fn();
    persistence.setErrorHandler(handler);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    persistence.queueSave({ n: 1 });
    vi.advanceTimersByTime(400);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});