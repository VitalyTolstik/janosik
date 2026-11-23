import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AdminFeatureFlagDto, FeatureFlagKey } from "@janosik/shared";
import { FEATURE_FLAGS } from "@janosik/shared";
import { Prisma, type FeatureFlag } from "@prisma/client";
import { HotPathCacheService } from "@/common/hot-path-cache.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";

/**
 * Behaviour feature flags (TASK-61). One row per key (`FeatureFlag`) carries
 * the global switch plus an optional per-user override map; the seed value
 * for an absent row comes from the env/most-permissive default.
 *
 * TASK-200.5: the raw row (not the per-user answer) is cached for 10–30 s.
 * That is safe to share across tenants — the override map is applied after
 * the lookup — and keeps a 30 s SSE tick from re-reading the same four rows
 * for every connection. `update()` invalidates the key synchronously and on
 * every replica through the realtime bus.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hotPathCache: HotPathCacheService,
  ) {}

  /** The fallback value when no row exists for a key. */
  envDefaults(): Record<FeatureFlagKey, boolean> {
    return {
      registration_open: env.ALLOW_REGISTRATION,
      public_shares: env.ALLOW_PUBLIC_SHARES,
      video_transcode: true,
      realtime_sse: true,
    };
  }

  /** Effective value of a flag for a user (or globally when `userId` is null). */
  async isEnabled(
    key: FeatureFlagKey,
    userId?: string | null,
  ): Promise<boolean> {
    const row = await this.cachedFlagRow(key);
    if (userId && row?.perUser && typeof row.perUser === "object") {
      const overrides = row.perUser as Record<string, boolean>;
      if (Object.prototype.hasOwnProperty.call(overrides, userId)) {
        return overrides[userId] === true;
      }
    }
    return row?.enabled ?? this.envDefaults()[key];
  }

  /**
   * One row lookup per key per window, even when hundreds of SSE ticks or
   * requests miss it at the same instant. An invalidation during the query
   * changes the epoch and prevents the older row from being cached.
   */
  private cachedFlagRow(key: FeatureFlagKey): Promise<FeatureFlag | null> {
    const cached = this.hotPathCache.getFlag(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const epoch = this.hotPathCache.epochs.flags;
    return this.hotPathCache.singleFlight(`flag:${key}`, epoch, async () => {
      const again = this.hotPathCache.getFlag(key);
      if (again !== undefined) return again;
      const row = await this.prisma.featureFlag.findUnique({ where: { key } });
      if (this.hotPathCache.epochs.flags === epoch) {
        this.hotPathCache.rememberFlag(key, row);
      }
      return row;
    });
  }

  /** Throws 403 when a flag is off — the guard used by gated code paths. */
  async assertEnabled(
    key: FeatureFlagKey,
    userId?: string | null,
  ): Promise<void> {
    if (!(await this.isEnabled(key, userId))) {
      throw new ForbiddenException("This feature is disabled");
    }
  }

  async list(): Promise<AdminFeatureFlagDto[]> {
    const rows = await this.prisma.featureFlag.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const defaults = this.envDefaults();
    return FEATURE_FLAGS.map((flag) => {
      const row = byKey.get(flag.key);
      const perUser = (row?.perUser as Record<string, boolean> | null) ?? null;
      return {
        key: flag.key,
        label: flag.label,
        description: flag.description,
        enabled: row?.enabled ?? defaults[flag.key],
        overrides: perUser ? Object.keys(perUser).length : 0,
        envDefault: defaults[flag.key],
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.getTime() ?? null,
      };
    });
  }

  async update(
    key: string,
    patch: { enabled?: boolean; perUser?: Record<string, boolean> | null },
    updatedBy: string,
  ): Promise<AdminFeatureFlagDto> {
    if (!FEATURE_FLAGS.some((flag) => flag.key === key)) {
      throw new NotFoundException("Unknown feature flag");
    }
    const data: Prisma.FeatureFlagUpdateInput = { updatedBy };
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.perUser !== undefined) {
      data.perUser = patch.perUser === null ? {} : patch.perUser;
    }
    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled: patch.enabled ?? this.envDefaults()[key as FeatureFlagKey],
        perUser: patch.perUser ?? {},
        updatedBy,
      },
      update: data,
    });
    // The toggle must beat the cached row on this node and every replica.
    this.hotPathCache.invalidateFlags(key);
    const perUser = (row.perUser as Record<string, boolean> | null) ?? null;
    const flag = FEATURE_FLAGS.find((entry) => entry.key === key)!;
    return {
      key,
      label: flag.label,
      description: flag.description,
      enabled: row.enabled,
      overrides: perUser ? Object.keys(perUser).length : 0,
      envDefault: this.envDefaults()[key as FeatureFlagKey],
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.getTime(),
    };
  }
}
