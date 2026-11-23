import {
  ReadCapacityError,
  ReadSemaphore,
  type ReadSemaphoreOptions,
} from "./read-semaphore";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function semaphore(options: Partial<ReadSemaphoreOptions> = {}): ReadSemaphore {
  return new ReadSemaphore({
    limit: 2,
    maxQueue: 2,
    waitMs: 100,
    retryAfterSeconds: 3,
    ...options,
  });
}

describe("ReadSemaphore", () => {
  it("caps concurrent holders and admits a waiter on release", async () => {
    const gate = semaphore({ limit: 1, maxQueue: 2 });
    const release = await gate.acquire();
    expect(gate.snapshot.active).toBe(1);

    let admitted = false;
    const waiting = gate.acquire().then((releaseSecond) => {
      admitted = true;
      return releaseSecond;
    });
    await delay(5);
    expect(admitted).toBe(false);
    expect(gate.snapshot.waiting).toBe(1);

    release();
    const releaseSecond = await waiting;
    expect(admitted).toBe(true);
    expect(gate.snapshot.active).toBe(1);
    releaseSecond();
    expect(gate.snapshot.active).toBe(0);
  });

  it("refuses immediately when the waiting room is full", async () => {
    const gate = semaphore({ limit: 1, maxQueue: 1 });
    const release = await gate.acquire();
    const waiting = gate.acquire();
    const refused = gate.acquire();

    await expect(refused).rejects.toMatchObject({
      name: "ReadCapacityError",
      reason: "queue_full",
      retryAfterSeconds: 3,
    });
    expect(gate.snapshot.refused).toBe(1);
    release();
    (await waiting)();
  });

  it("times out a waiter, then admits a later caller", async () => {
    const gate = semaphore({ limit: 1, maxQueue: 1, waitMs: 10 });
    const release = await gate.acquire();
    const timedOut = gate.acquire();

    await expect(timedOut).rejects.toMatchObject({
      reason: "wait_timeout",
    });
    expect(gate.snapshot.waiting).toBe(0);

    release();
    const next = await gate.acquire();
    expect(gate.snapshot.active).toBe(1);
    next();
  });

  it("releases a slot only once", async () => {
    const gate = semaphore({ limit: 1 });
    const release = await gate.acquire();
    release();
    release();
    expect(gate.snapshot.active).toBe(0);
    const again = await gate.acquire();
    expect(gate.snapshot.active).toBe(1);
    again();
  });

  it("drains queued waiters and waits for an active holder", async () => {
    const gate = semaphore({ limit: 1, maxQueue: 2 });
    const release = await gate.acquire();
    // Attach the assertion before `drain` rejects the queued promise.
    const queued = expect(gate.acquire()).rejects.toBeInstanceOf(
      ReadCapacityError,
    );

    await expect(gate.drain(50)).resolves.toBeUndefined();
    await queued;
    expect(gate.snapshot.active).toBe(1);
    expect(gate.snapshot.draining).toBe(true);
    await expect(gate.acquire()).rejects.toMatchObject({
      reason: "draining",
    });

    release();
    expect(gate.snapshot.active).toBe(0);
  });

  it("rejects an invalid configuration", () => {
    expect(() => semaphore({ limit: 0 })).toThrow(/positive integer/);
    expect(() => semaphore({ maxQueue: -1 })).toThrow(/non-negative/);
    expect(() => semaphore({ waitMs: -1 })).toThrow(/non-negative/);
  });
});
