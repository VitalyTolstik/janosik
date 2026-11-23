import type { BoardMember, FeatureFlag, Role } from "@prisma/client";
import type { AuthenticatedToken } from "@/auth/api-token.service";
import type {
  CacheInvalidation,
  CacheInvalidationListener,
} from "@/realtime/realtime.service";
import {
  HotPathCacheService,
  type HotPathCacheConfig,
  type StreamMembershipSnapshot,
} from "./hot-path-cache.service";

/**
 * A tiny stand-in for the realtime bus: `publishInvalidation` fans the event
 * out to the same listeners a Redis subscriber would, synchronously. That is
 * exactly the ordering the local path guarantees in production.
 */
function fakeBus() {
  const listeners = new Set<CacheInvalidationListener>();
  const publishInvalidation = jest.fn((event: CacheInvalidation) => {
    for (const listener of listeners) listener(event);
  });
  return {
    publishInvalidation,
    onInvalidation: jest.fn((listener: CacheInvalidationListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
}

function config(
  overrides: Partial<HotPathCacheConfig> = {},
): HotPathCacheConfig {
  return {
    patTtlMs: 30_000,
    membershipTtlMs: 30_000,
    streamMembershipTtlMs: 30_000,
    flagsTtlMs: 30_000,
    patMaxEntries: 100,
    membershipMaxEntries: 100,
    streamMembershipMaxEntries: 100,
    flagsMaxEntries: 100,
    ...overrides,
  };
}

function member(overrides: Partial<BoardMember> = {}): BoardMember {
  return {
    id: "member-1",
    boardId: "board-1",
    userId: "user-1",
    role: "MEMBER" as Role,
    expiresAt: null,
    acceptedAt: new Date(0),
    invitedById: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function streamSnapshot(): StreamMembershipSnapshot {
  return {
    acceptedAt: new Date(0),
    expiresAt: null,
    board: { deletedAt: null },
  };
}

function pat(): AuthenticatedToken {
  return {
    user: {
      id: "user-1",
      email: "u@example.com",
    } as AuthenticatedToken["user"],
    tokenId: "token-1",
    tokenName: "CI",
    identity: {} as AuthenticatedToken["identity"],
    scope: { boardId: null, readOnly: false, rateLimitPerMinute: null },
  };
}

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: "realtime_sse",
    enabled: true,
    perUser: {},
    updatedBy: null,
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("HotPathCacheService (TASK-200.5)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-23T10:00:00Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves PAT entries until the window elapses", () => {
    const cache = new HotPathCacheService(fakeBus() as never, config());
    cache.rememberPat("hash-1", pat());
    expect(cache.getPat("hash-1")?.tokenId).toBe("token-1");
    jest.advanceTimersByTime(30_000);
    expect(cache.getPat("hash-1")).toBeUndefined();
  });

  it("keeps memberships of different tenants apart", () => {
    const cache = new HotPathCacheService(fakeBus() as never, config());
    cache.rememberMembership("board-1", "user-1", member({ id: "m-11" }));
    cache.rememberMembership("board-2", "user-1", member({ id: "m-21" }));
    cache.rememberMembership("board-1", "user-2", member({ id: "m-12" }));

    expect(cache.getMembership("board-1", "user-1")?.id).toBe("m-11");
    expect(cache.getMembership("board-2", "user-1")?.id).toBe("m-21");
    expect(cache.getMembership("board-1", "user-2")?.id).toBe("m-12");
    expect(cache.getMembership("board-2", "user-2")).toBeUndefined();
  });

  it("invalidates one membership on this node and through the bus", () => {
    const bus = fakeBus();
    const cache = new HotPathCacheService(bus as never, config());
    cache.rememberMembership("board-1", "user-1", member());
    cache.rememberStreamMembership("board-1", "user-1", streamSnapshot());

    cache.invalidateMembership("board-1", "user-1");

    expect(cache.getMembership("board-1", "user-1")).toBeUndefined();
    expect(cache.getStreamMembership("board-1", "user-1")).toBeUndefined();
    expect(bus.publishInvalidation).toHaveBeenCalledWith({
      kind: "membership",
      boardId: "board-1",
      userId: "user-1",
    });
  });

  it("applies a remote invalidation without publishing it again", () => {
    const bus = fakeBus();
    const cache = new HotPathCacheService(bus as never, config());
    cache.rememberMembership("board-1", "user-1", member());
    cache.rememberFlag("realtime_sse", flag());

    // A second instance is the remote receiver; its own bus plays the
    // inbound frame Redis would deliver.
    const remoteBus = fakeBus();
    const remote = new HotPathCacheService(remoteBus as never, config());
    remote.rememberMembership("board-1", "user-1", member());
    remote.rememberFlag("realtime_sse", flag());
    const listener = remoteBus.onInvalidation.mock.calls[0][0];
    listener({ kind: "membership", boardId: "board-1", userId: "user-1" });
    listener({ kind: "flags", key: "realtime_sse" });

    expect(remote.getMembership("board-1", "user-1")).toBeUndefined();
    expect(remote.getFlag("realtime_sse")).toBeUndefined();
    expect(remoteBus.publishInvalidation).not.toHaveBeenCalled();
    expect(cache.getMembership("board-1", "user-1")).not.toBeUndefined();
    expect(bus.publishInvalidation).not.toHaveBeenCalled();
  });

  it("clears only the affected board on a board-scoped event", () => {
    const cache = new HotPathCacheService(fakeBus() as never, config());
    cache.rememberMembership("board-1", "user-1", member());
    cache.rememberMembership(
      "board-2",
      "user-1",
      member({ boardId: "board-2" }),
    );

    cache.invalidateBoard("board-1");

    expect(cache.getMembership("board-1", "user-1")).toBeUndefined();
    expect(cache.getMembership("board-2", "user-1")?.boardId).toBe("board-2");
  });

  it("drops a PAT map on a token event and flags by key", () => {
    const cache = new HotPathCacheService(fakeBus() as never, config());
    cache.rememberPat("hash-1", pat());
    cache.rememberFlag("realtime_sse", flag());
    cache.rememberFlag("public_shares", flag({ key: "public_shares" }));

    cache.invalidatePat("token-1");
    cache.invalidateFlags("realtime_sse");

    expect(cache.getPat("hash-1")).toBeUndefined();
    expect(cache.getFlag("realtime_sse")).toBeUndefined();
    expect(cache.getFlag("public_shares")).not.toBeUndefined();
  });

  it("bounds every cache (LRU) so a swarm cannot grow the heap", () => {
    const cache = new HotPathCacheService(
      fakeBus() as never,
      config({
        patMaxEntries: 2,
        membershipMaxEntries: 2,
        streamMembershipMaxEntries: 2,
        flagsMaxEntries: 2,
      }),
    );
    for (let i = 0; i < 5; i += 1) {
      cache.rememberPat(`hash-${i}`, pat());
      cache.rememberMembership(`board-${i}`, "user-1", member());
      cache.rememberStreamMembership(`board-${i}`, "user-1", streamSnapshot());
      cache.rememberFlag(`flag-${i}`, flag({ key: `flag-${i}` }));
    }
    expect(cache.sizes).toEqual({
      pats: 2,
      memberships: 2,
      streamMemberships: 2,
      flags: 2,
    });
    expect(cache.getPat("hash-4")).not.toBeUndefined();
    expect(cache.getPat("hash-0")).toBeUndefined();
  });

  it("expires each cache on its own window", () => {
    const cache = new HotPathCacheService(
      fakeBus() as never,
      config({ patTtlMs: 10_000, flagsTtlMs: 20_000 }),
    );
    cache.rememberPat("hash-1", pat());
    cache.rememberFlag("realtime_sse", flag());
    jest.advanceTimersByTime(10_000);
    expect(cache.getPat("hash-1")).toBeUndefined();
    expect(cache.getFlag("realtime_sse")).not.toBeUndefined();
    jest.advanceTimersByTime(10_000);
    expect(cache.getFlag("realtime_sse")).toBeUndefined();
  });

  it("single-flights one cold load across 500 callers", async () => {
    const cache = new HotPathCacheService(fakeBus() as never, config());
    const loader = jest.fn(async () => {
      await Promise.resolve();
      return "value";
    });
    const epoch = cache.epochs.flags;
    const results = await Promise.all(
      Array.from({ length: 500 }, () =>
        cache.singleFlight("flag:realtime_sse", epoch, loader),
      ),
    );
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((value) => value === "value")).toBe(true);
  });

  it("does not join a fill that predates an invalidation", async () => {
    const bus = fakeBus();
    const cache = new HotPathCacheService(bus as never, config());
    let release: (() => void) | undefined;
    const stale = new Promise<string>((resolve) => {
      release = () => resolve("stale");
    });
    const staleLoader = jest.fn(() => stale);
    const oldEpoch = cache.epochs.pat;

    const pending = cache.singleFlight("pat:hash", oldEpoch, staleLoader);
    cache.invalidatePat("token-1");
    const freshEpoch = cache.epochs.pat;
    expect(freshEpoch).toBeGreaterThan(oldEpoch);

    const fresh = jest.fn(async () => "fresh");
    const result = await cache.singleFlight("pat:hash", freshEpoch, fresh);
    expect(result).toBe("fresh");
    expect(fresh).toHaveBeenCalledTimes(1);
    release?.();
    await pending;
  });
});
