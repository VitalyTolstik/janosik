import { Inject, Injectable } from "@nestjs/common";
import type { BoardMember, FeatureFlag } from "@prisma/client";
import type { AuthenticatedToken } from "@/auth/api-token.service";
import type { CacheInvalidation } from "@/realtime/realtime.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { env } from "@/config/env";
import { TtlCache } from "./ttl-cache";

/**
 * The fields an open SSE stream re-validates on every keep-alive tick. The
 * joined row is cached as a snapshot, but its time/disabled/deleted bits are
 * checked on every read, so an expiry inside the window still closes the
 * stream on the next tick instead of surviving until the TTL.
 */
export interface StreamMembershipSnapshot {
  acceptedAt: Date | null;
  expiresAt: Date | null;
  user: {
    id: string;
    email: string;
    passwordHash: string | null;
    emailVerifiedAt: Date | null;
    disabledAt: Date | null;
  };
  board: { deletedAt: Date | null };
}

export interface HotPathCacheConfig {
  /** PAT lookup by sha256 hash. */
  patTtlMs: number;
  /** (board, user) membership row used by the HTTP guard. */
  membershipTtlMs: number;
  /** Joined membership snapshot used by the SSE keep-alive tick. */
  streamMembershipTtlMs: number;
  /** Raw feature-flag row; per-user overrides are applied on each read. */
  flagsTtlMs: number;
  patMaxEntries: number;
  membershipMaxEntries: number;
  streamMembershipMaxEntries: number;
  flagsMaxEntries: number;
}

/** Injection token so a focused spec can enable short windows. */
export const HOT_PATH_CACHE_CONFIG = Symbol("HOT_PATH_CACHE_CONFIG");

/** The production/test default from `env` (tests set the TTLs to 0). */
export function defaultHotPathCacheConfig(): HotPathCacheConfig {
  return {
    patTtlMs: env.AUTH_CACHE_TTL_MS,
    membershipTtlMs: env.MEMBERSHIP_CACHE_TTL_MS,
    streamMembershipTtlMs: env.MEMBERSHIP_CACHE_TTL_MS,
    flagsTtlMs: env.FEATURE_FLAG_CACHE_MS,
    patMaxEntries: env.AUTH_CACHE_MAX_ENTRIES,
    membershipMaxEntries: env.MEMBERSHIP_CACHE_MAX_ENTRIES,
    streamMembershipMaxEntries: env.MEMBERSHIP_CACHE_MAX_ENTRIES,
    flagsMaxEntries: env.FEATURE_FLAG_CACHE_MAX_ENTRIES,
  };
}

/**
 * TASK-200.5: the hot-path caches shared by the PAT guard, the board
 * membership guard, the SSE keep-alive and the feature-flag service.
 *
 * One process-wide instance (provided by `HotPathCacheModule`) matters:
 * guards are instantiated per module, so per-guard maps would multiply the
 * entries and make invalidation only partially effective. Every key names its
 * full tenant tuple — `sha256` for a token, `boardId + userId` for a
 * membership, `flag key + userId` only at read time — so a value can never be
 * served to another user or board.
 *
 * The realtime bus is the invalidation path (TASK-200.5): a write clears the
 * local entry synchronously and publishes one control-plane frame on Redis
 * for the other replicas. A missed frame degrades to the TTL, which is why
 * every window is 10–30 s and every cache is bounded LRU.
 */
@Injectable()
export class HotPathCacheService {
  private readonly pats: TtlCache<string, AuthenticatedToken>;
  private readonly memberships: TtlCache<string, BoardMember>;
  private readonly streamMemberships: TtlCache<
    string,
    StreamMembershipSnapshot
  >;
  private readonly flags: TtlCache<string, FeatureFlag | null>;

  constructor(
    private readonly realtime: RealtimeService,
    @Inject(HOT_PATH_CACHE_CONFIG) private readonly config: HotPathCacheConfig,
  ) {
    this.pats = new TtlCache(config.patTtlMs, config.patMaxEntries);
    this.memberships = new TtlCache(
      config.membershipTtlMs,
      config.membershipMaxEntries,
    );
    this.streamMemberships = new TtlCache(
      config.streamMembershipTtlMs,
      config.streamMembershipMaxEntries,
    );
    this.flags = new TtlCache(config.flagsTtlMs, config.flagsMaxEntries);
    // The bus may already be created; registration is synchronous and works
    // with or without Redis (a single node is its own listener).
    this.realtime.onInvalidation((event) => this.apply(event));
  }

  // ------------------------------------------------------------------- PAT

  /** Current PAT window; `0` means the cache is disabled. */
  get patTtlMs(): number {
    return this.config.patTtlMs;
  }

  getPat(tokenHash: string): AuthenticatedToken | undefined {
    return this.pats.get(tokenHash);
  }

  rememberPat(tokenHash: string, token: AuthenticatedToken): void {
    this.pats.set(tokenHash, token);
  }

  /**
   * A token was revoked, re-scoped, paused or resumed. `tokenId` is carried
   * on the bus for observability; every replica may drop the whole PAT map
   * because token-control writes are rare and correctness beats a few
   * re-lookups.
   */
  invalidatePat(tokenId?: string): void {
    this.pats.clear();
    this.realtime.publishInvalidation({ kind: "pat", tokenId });
  }

  // ------------------------------------------------------------- membership

  getMembership(boardId: string, userId: string): BoardMember | undefined {
    return this.memberships.get(membershipKey(boardId, userId));
  }

  rememberMembership(boardId: string, userId: string, row: BoardMember): void {
    this.memberships.set(membershipKey(boardId, userId), row);
  }

  invalidateMembership(boardId: string, userId: string): void {
    this.memberships.delete(membershipKey(boardId, userId));
    this.streamMemberships.delete(membershipKey(boardId, userId));
    this.realtime.publishInvalidation({ kind: "membership", boardId, userId });
  }

  /**
   * Drop a cached row locally without a bus frame. The guard uses this when
   * it notices that a snapshot lapsed inside its window; the database truth
   * is re-read immediately, so every other node's TTL is still correct.
   */
  dropMembership(boardId: string, userId: string): void {
    const key = membershipKey(boardId, userId);
    this.memberships.delete(key);
    this.streamMemberships.delete(key);
  }

  /** Board-wide change (delete, pause, bulk membership edit). */
  invalidateBoard(boardId: string): void {
    const prefix = `${boardId}\u0000`;
    this.memberships.deleteWhere((key) => key.startsWith(prefix));
    this.streamMemberships.deleteWhere((key) => key.startsWith(prefix));
    this.realtime.publishInvalidation({ kind: "board", boardId });
  }

  getStreamMembership(
    boardId: string,
    userId: string,
  ): StreamMembershipSnapshot | undefined {
    return this.streamMemberships.get(membershipKey(boardId, userId));
  }

  rememberStreamMembership(
    boardId: string,
    userId: string,
    snapshot: StreamMembershipSnapshot,
  ): void {
    this.streamMemberships.set(membershipKey(boardId, userId), snapshot);
  }

  // ---------------------------------------------------------- feature flags

  getFlag(key: string): FeatureFlag | null | undefined {
    return this.flags.get(key);
  }

  rememberFlag(key: string, row: FeatureFlag | null): void {
    this.flags.set(key, row);
  }

  invalidateFlags(key?: string): void {
    if (key === undefined) this.flags.clear();
    else this.flags.delete(key);
    this.realtime.publishInvalidation({ kind: "flags", key });
  }

  // ---------------------------------------------------------------- stats

  /** Entry counts — tests and diagnostics only. */
  get sizes(): {
    pats: number;
    memberships: number;
    streamMemberships: number;
    flags: number;
  } {
    return {
      pats: this.pats.size,
      memberships: this.memberships.size,
      streamMemberships: this.streamMemberships.size,
      flags: this.flags.size,
    };
  }

  /**
   * Apply one invalidation, locally or from another node. Deliberately does
   * not publish again: the frame has already travelled.
   */
  private apply(event: CacheInvalidation): void {
    switch (event.kind) {
      case "pat":
        this.pats.clear();
        return;
      case "membership": {
        const key = membershipKey(event.boardId, event.userId);
        this.memberships.delete(key);
        this.streamMemberships.delete(key);
        return;
      }
      case "board": {
        const prefix = `${event.boardId}\u0000`;
        this.memberships.deleteWhere((key) => key.startsWith(prefix));
        this.streamMemberships.deleteWhere((key) => key.startsWith(prefix));
        return;
      }
      case "flags":
        if (event.key === undefined) this.flags.clear();
        else this.flags.delete(event.key);
        return;
    }
  }
}

/** `boardId\u0000userId` — the separator cannot occur in a cuid. */
function membershipKey(boardId: string, userId: string): string {
  return `${boardId}\u0000${userId}`;
}
