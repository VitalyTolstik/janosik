import { describe, expect, it } from "vitest";

import {
  KeyedTokenBucket,
  NegativeTokenCache,
  SingleFlight,
  SingleFlightCapacityError,
  TenantConcurrencyGate,
} from "./http-admission.js";

describe("gateway admission", () => {
  it("bounds per-key and global concurrent holders without queueing", () => {
    const gate = new TenantConcurrencyGate(2, 3);
    expect(gate.tryAcquire("a").ok).toBe(true);
    expect(gate.tryAcquire("a").ok).toBe(true);
    expect(gate.tryAcquire("a")).toEqual({ ok: false, scope: "key" });
    expect(gate.tryAcquire("b").ok).toBe(true);
    expect(gate.tryAcquire("c")).toEqual({ ok: false, scope: "global" });
    gate.release("a");
    expect(gate.tryAcquire("c").ok).toBe(true);
    expect(gate.inUse).toBe(3);
    expect(gate.keys).toBe(3);
  });

  it("limits a key, reports Retry-After and refills over time", () => {
    let now = 0;
    const bucket = new KeyedTokenBucket({
      capacity: 2,
      refillPerMinute: 60,
      now: () => now,
    });
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("a").ok).toBe(true);
    const denied = bucket.take("a");
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
    expect(bucket.take("b").ok).toBe(true);
    now += 1_000;
    expect(bucket.take("a").ok).toBe(true);
  });

  it("bounds the number of tracked keys", () => {
    const bucket = new KeyedTokenBucket({
      capacity: 1,
      refillPerMinute: 60,
      maxKeys: 2,
    });
    expect(bucket.take("a").ok).toBe(true);
    expect(bucket.take("b").ok).toBe(true);
    expect(bucket.take("c").ok).toBe(true);
    expect(bucket.size).toBe(2);
  });

  it("bounds and expires the negative cache", () => {
    let now = 0;
    const cache = new NegativeTokenCache({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });
    cache.set("a");
    cache.set("b");
    expect(cache.has("a")).toBe(true);
    cache.set("c");
    expect(cache.size).toBe(2);
    // `has("a")` refreshed it, so "b" is the oldest entry.
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    now += 101;
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("deduplicates concurrent validation calls", async () => {
    const flight = new SingleFlight<string>();
    let calls = 0;
    let release!: (value: string) => void;
    const task = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = flight.run("hash", task);
    const second = flight.run("hash", task);
    expect(flight.size).toBe(1);
    release("ok");
    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
    expect(calls).toBe(1);
    expect(flight.size).toBe(0);
  });

  it("bounds distinct in-flight validation keys", async () => {
    const flight = new SingleFlight<string>({ maxKeys: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = flight.run("a", async () => {
      await gate;
      return "a";
    });
    expect(() => flight.run("b", async () => "b")).toThrow(
      SingleFlightCapacityError,
    );
    expect(flight.run("a", async () => "duplicate")).toBe(first);
    release();
    await expect(first).resolves.toBe("a");
    await expect(flight.run("b", async () => "b")).resolves.toBe("b");
  });
});
