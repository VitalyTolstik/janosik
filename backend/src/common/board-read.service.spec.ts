import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { BoardAggregate } from "@janosik/shared";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { boardReadEtag } from "./board-read-etag";
import {
  BOARD_FULL_PROJECTION,
  BOARD_READ_ROUTE,
  BoardReadService,
  boardReadKey,
  type BoardReadLimits,
  type BoardReadRequest,
} from "./board-read.service";

const BOARD: BoardAggregate = {
  id: "board-1",
  // Long enough that gzip/Brotli actually win over the identity body.
  title: "Board ".repeat(100),
  columns: [],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 100,
};

const LIMITS: BoardReadLimits = {
  maxConcurrent: 4,
  queueMax: 4,
  waitMs: 100,
  timeoutMs: 1_000,
  retryAfterSeconds: 2,
  compressMinBytes: 16,
};

function request(overrides: Partial<BoardReadRequest> = {}): BoardReadRequest {
  return {
    boardId: "board-1",
    role: "MEMBER",
    projection: BOARD_FULL_PROJECTION,
    route: BOARD_READ_ROUTE,
    acceptEncoding: "identity",
    ifNoneMatch: undefined,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function service(overrides: Partial<BoardReadLimits> = {}): BoardReadService {
  return new BoardReadService({ ...LIMITS, ...overrides });
}

describe("BoardReadService", () => {
  it("rejects a timeout that can fire while the caller is still queued", () => {
    expect(() => service({ waitMs: 50, timeoutMs: 50 })).toThrow(
      /BOARD_READ_TIMEOUT_MS must be greater/,
    );
    expect(() => service({ waitMs: 50, timeoutMs: 10 })).toThrow(
      /BOARD_READ_TIMEOUT_MS must be greater/,
    );
    expect(() => service({ waitMs: 10, timeoutMs: 299 })).toThrow(
      /must be at least 300/,
    );
  });

  it("answers 304 from the cheap stamp without building", async () => {
    const read = service();
    const stamp = { revision: 3n, seq: 3 };
    const etag = boardReadEtag({ ...request(), ...stamp });
    const build = jest.fn();

    const result = await read.read(request({ ifNoneMatch: etag }), {
      stamp: () => Promise.resolve(stamp),
      build,
    });

    expect(result).toMatchObject({ status: 304, seq: 3, etag });
    expect(result.body.byteLength).toBe(0);
    expect(build).not.toHaveBeenCalled();
    expect(read.metrics.notModified).toBe(1);
  });

  it("does not read the stamp on an unconditional request", async () => {
    const read = service();
    const stamp = jest.fn();
    await expect(
      read.read(request({ acceptEncoding: "identity" }), {
        stamp,
        build: () => Promise.resolve({ board: BOARD, seq: 3, revision: 3n }),
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(stamp).not.toHaveBeenCalled();
  });

  it("builds, serializes and compresses a 200 response", async () => {
    const read = service();
    const build = jest
      .fn()
      .mockResolvedValue({ board: BOARD, seq: 3, revision: 3n });

    const result = await read.read(request({ acceptEncoding: "gzip" }), {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    });

    expect(result.status).toBe(200);
    expect(result.encoding).toBe("gzip");
    expect(gunzipSync(result.body).toString("utf8")).toBe(
      JSON.stringify(BOARD),
    );
    expect(result.etag).toBe(boardReadEtag({ ...request(), revision: 3n }));
    expect(read.metrics).toMatchObject({
      fullReads: 1,
      compressed: 1,
      identity: 0,
      coalesced: 0,
    });
  });

  it("passes the Prisma maxWait/timeout budget into the build", async () => {
    const read = service({ waitMs: 100, timeoutMs: 1_000 });
    const build = jest
      .fn()
      .mockResolvedValue({ board: BOARD, seq: 3, revision: 3n });
    await read.read(request({ acceptEncoding: "identity" }), {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    });
    const budget = build.mock.calls[0]![0] as {
      maxWaitMs: number;
      timeoutMs: number;
    };
    expect(budget.maxWaitMs).toBe(100);
    expect(budget.timeoutMs).toBeLessThanOrEqual(750);
    expect(budget.timeoutMs).toBeGreaterThan(650);
  });

  it("shares one deadline between the conditional stamp and the build", async () => {
    const read = service({ waitMs: 100, timeoutMs: 300 });
    const started = Date.now();
    let refusal: unknown;
    try {
      await read.read(request({ ifNoneMatch: 'W/"old"' }), {
        stamp: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ revision: 1n, seq: 1 }), 90),
          ),
        build: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ board: BOARD, seq: 1, revision: 1n }),
              250,
            ),
          ),
      });
    } catch (caught) {
      refusal = caught;
    }
    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(
      (refusal as ServiceUnavailableException).getResponse(),
    ).toMatchObject({ code: "board_read_timeout" });
    expect(Date.now() - started).toBeLessThan(700);
  });

  it("gives a conditional stamp the shared budget when WAIT_MS=0", async () => {
    const read = service({ waitMs: 0, timeoutMs: 300 });
    const etag = boardReadEtag({ ...request(), revision: 2n });
    const result = await read.read(request({ ifNoneMatch: etag }), {
      stamp: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ revision: 2n, seq: 0 }), 30),
        ),
      build: jest.fn(),
    });
    expect(result).toMatchObject({ status: 304, seq: 0 });
  });

  it("recovers after a hanging conditional stamp", async () => {
    const read = service({ waitMs: 50, timeoutMs: 300 });
    let first = true;
    const stamp = jest.fn(() => {
      if (first) {
        first = false;
        return new Promise<never>(() => undefined);
      }
      return Promise.resolve({ revision: 3n, seq: 3 });
    });
    let refusal: unknown;
    try {
      await read.read(request({ ifNoneMatch: 'W/"old"' }), {
        stamp,
        build: jest.fn(),
      });
    } catch (caught) {
      refusal = caught;
    }
    expect(
      (refusal as ServiceUnavailableException).getResponse(),
    ).toMatchObject({ code: "board_read_timeout" });
    expect(stamp).toHaveBeenCalledTimes(1);

    // A hung stamp is abandoned per request; the next read starts a fresh one.
    const etag = boardReadEtag({ ...request(), revision: 3n });
    await expect(
      read.read(request({ ifNoneMatch: etag }), {
        stamp,
        build: jest.fn(),
      }),
    ).resolves.toMatchObject({ status: 304 });
    expect(stamp).toHaveBeenCalledTimes(2);
  });

  it("maps P2028/P2024 transaction and pool failures to 503", async () => {
    const cases = [
      [
        Object.assign(new Error("Transaction already closed"), {
          code: "P2028",
        }),
        "board_read_timeout",
      ],
      [
        Object.assign(
          new Error("Unable to start a transaction in the given time."),
          { code: "P2028" },
        ),
        "board_read_busy",
      ],
      [
        Object.assign(new Error("Timed out fetching a new connection"), {
          code: "P2024",
        }),
        "board_read_busy",
      ],
    ] as const;

    for (const [error, code] of cases) {
      const read = service();
      let refusal: unknown;
      try {
        await read.read(request({ acceptEncoding: "identity" }), {
          stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
          build: () => Promise.reject(error),
        });
      } catch (caught) {
        refusal = caught;
      }
      expect(refusal).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (refusal as ServiceUnavailableException).getResponse(),
      ).toMatchObject({ code, retryable: true });
    }
  });

  it("bounds a hanging conditional stamp and answers 503", async () => {
    const read = service({ waitMs: 10, timeoutMs: 300 });
    let refusal: unknown;
    try {
      await read.read(request({ ifNoneMatch: 'W/"stale"' }), {
        stamp: () => new Promise(() => undefined),
        build: jest.fn(),
      });
    } catch (caught) {
      refusal = caught;
    }
    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(
      (refusal as ServiceUnavailableException).getResponse(),
    ).toMatchObject({ code: "board_read_timeout", retryAfter: 2 });
    expect(read.metrics.timeouts).toBe(1);
  });

  it("maps a pool wait in the conditional stamp to 503 busy", async () => {
    const read = service();
    let refusal: unknown;
    try {
      await read.read(request({ ifNoneMatch: 'W/"stale"' }), {
        stamp: () =>
          Promise.reject(
            Object.assign(
              new Error("Unable to start a transaction in the given time."),
              { code: "P2028" },
            ),
          ),
        build: jest.fn(),
      });
    } catch (caught) {
      refusal = caught;
    }
    expect(
      (refusal as ServiceUnavailableException).getResponse(),
    ).toMatchObject({ code: "board_read_busy" });
  });

  it("serves Brotli when negotiated", async () => {
    const read = service();
    const result = await read.read(request({ acceptEncoding: "br, gzip" }), {
      stamp: () => Promise.resolve({ revision: 1n, seq: 1 }),
      build: () => Promise.resolve({ board: BOARD, seq: 1, revision: 1n }),
    });
    expect(result.encoding).toBe("br");
    expect(brotliDecompressSync(result.body).toString("utf8")).toBe(
      JSON.stringify(BOARD),
    );
  });

  it("coalesces identical concurrent reads into one build", async () => {
    const read = service();
    const gate = deferred<{
      board: BoardAggregate;
      seq: number;
      revision: bigint;
    }>();
    const build = jest.fn(() => gate.promise);
    const deps = {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    };

    const first = read.read(request(), deps);
    const second = read.read(request(), deps);
    const third = read.read(request(), deps);
    await delay(5);
    expect(build).toHaveBeenCalledTimes(1);
    expect(read.metrics.waiting + read.metrics.active).toBe(1);

    gate.resolve({ board: BOARD, seq: 3, revision: 3n });
    const results = await Promise.all([first, second, third]);
    expect(results.every((entry) => entry.status === 200)).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
    expect(read.metrics).toMatchObject({ fullReads: 1, coalesced: 2 });
  });

  it("does not share a build across roles", async () => {
    const read = service();
    const gate = deferred<{
      board: BoardAggregate;
      seq: number;
      revision: bigint;
    }>();
    const build = jest.fn(() => gate.promise);
    const deps = {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    };

    const admin = read.read(request({ role: "ADMIN" }), deps);
    const member = read.read(request({ role: "MEMBER" }), deps);
    await delay(5);
    expect(build).toHaveBeenCalledTimes(2);

    gate.resolve({ board: BOARD, seq: 3, revision: 3n });
    await Promise.all([admin, member]);
  });

  it("answers 503 when the read queue is full, then recovers", async () => {
    const read = service({ maxConcurrent: 1, queueMax: 0, waitMs: 20 });
    const gate = deferred<{
      board: BoardAggregate;
      seq: number;
      revision: bigint;
    }>();
    const build = jest.fn(() => gate.promise);
    const deps = {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    };

    const holder = read.read(request({ acceptEncoding: "identity" }), deps);
    await delay(5);

    let refusal: unknown;
    try {
      await read.read(request({ acceptEncoding: "gzip" }), deps);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    const response = (refusal as ServiceUnavailableException).getResponse() as {
      code: string;
      retryAfter: number;
    };
    expect(response).toMatchObject({ code: "board_read_busy", retryAfter: 2 });
    expect(read.metrics.rejected).toBe(1);

    gate.resolve({ board: BOARD, seq: 3, revision: 3n });
    await expect(holder).resolves.toMatchObject({ status: 200 });

    // A settled refusal is not a poisoned key: the next read builds again.
    await expect(
      read.read(request({ acceptEncoding: "gzip" }), deps),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("answers 503 on a bounded wait timeout and cleans the entry", async () => {
    const read = service({
      maxConcurrent: 1,
      queueMax: 1,
      waitMs: 10,
      timeoutMs: 300,
    });
    const gate = deferred<{
      board: BoardAggregate;
      seq: number;
      revision: bigint;
    }>();
    const build = jest.fn(() => gate.promise);
    const deps = {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build,
    };

    const timedOut = read.read(request(), deps);
    await expect(timedOut).rejects.toMatchObject({
      response: {
        code: "board_read_timeout",
        retryable: true,
        retryAfter: 2,
      },
    });
    expect(read.metrics.timeouts).toBe(1);

    gate.resolve({ board: BOARD, seq: 3, revision: 3n });
    await delay(10);
    expect(read.metrics.inFlight).toBe(0);

    await expect(read.read(request(), deps)).resolves.toMatchObject({
      status: 200,
    });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("throws 404 when the board disappeared after the guard", async () => {
    const read = service();
    await expect(
      read.read(request({ ifNoneMatch: 'W/"stale"' }), {
        stamp: () => Promise.resolve(null),
        build: jest.fn(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("drains queued reads and refuses new work", async () => {
    const read = service({ maxConcurrent: 1, queueMax: 2, waitMs: 500 });
    const gate = deferred<{
      board: BoardAggregate;
      seq: number;
      revision: bigint;
    }>();
    const deps = {
      stamp: () => Promise.resolve({ revision: 3n, seq: 3 }),
      build: jest.fn(() => gate.promise),
    };

    const active = read.read(request(), deps);
    // Attach the assertion before `drain` rejects the queued promise.
    const queued = expect(
      read.read(request({ acceptEncoding: "gzip" }), deps),
    ).rejects.toMatchObject({ response: { code: "board_read_busy" } });
    await delay(5);

    await read.drain(20);
    await queued;
    await expect(
      read.read(request({ acceptEncoding: "br" }), deps),
    ).rejects.toMatchObject({ response: { code: "board_read_busy" } });

    gate.resolve({ board: BOARD, seq: 3, revision: 3n });
    await expect(active).resolves.toMatchObject({ status: 200 });
  });
});

describe("boardReadKey", () => {
  it("contains board, role, projection and coding but no credentials", () => {
    const key = boardReadKey({
      boardId: "board-1",
      role: "MEMBER",
      projection: BOARD_FULL_PROJECTION,
      encoding: "br",
    });
    expect(key).toBe(
      `board-1\u0000MEMBER\u0000${BOARD_FULL_PROJECTION}\u0000br`,
    );
    expect(key).not.toMatch(/token|user|@|password|secret/i);
  });
});
