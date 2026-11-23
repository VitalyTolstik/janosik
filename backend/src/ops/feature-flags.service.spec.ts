import type { FeatureFlag } from "@prisma/client";
import { HotPathCacheService } from "@/common/hot-path-cache.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { FeatureFlagsService } from "./feature-flags.service";

const prismaMock = {
  featureFlag: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
} as unknown as PrismaService & {
  featureFlag: Record<"findUnique" | "findMany" | "upsert", jest.Mock>;
};

function fakeBus() {
  const listeners = new Set<(event: unknown) => void>();
  return {
    publishInvalidation: jest.fn((event: unknown) => {
      for (const listener of listeners) listener(event);
    }),
    onInvalidation: jest.fn((listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
}

function cache(ttlMs = 30_000): HotPathCacheService {
  return new HotPathCacheService(fakeBus() as never, {
    patTtlMs: 0,
    membershipTtlMs: 0,
    streamMembershipTtlMs: 0,
    flagsTtlMs: ttlMs,
    patMaxEntries: 10,
    membershipMaxEntries: 10,
    streamMembershipMaxEntries: 10,
    flagsMaxEntries: 10,
  });
}

function row(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: "realtime_sse",
    enabled: true,
    perUser: {},
    updatedBy: null,
    updatedAt: new Date("2026-11-23T10:00:00Z"),
    ...overrides,
  };
}

describe("FeatureFlagsService hot-path cache (TASK-200.5)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("serves 500 agent checks from one row lookup", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue(row());
    const service = new FeatureFlagsService(prismaMock, cache());

    for (let i = 0; i < 500; i += 1) {
      await expect(service.isEnabled("realtime_sse")).resolves.toBe(true);
    }
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(1);
  });

  it("expires the row after the window", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-23T10:00:00Z"));
    try {
      prismaMock.featureFlag.findUnique.mockResolvedValue(row());
      const service = new FeatureFlagsService(prismaMock, cache(10_000));
      await service.isEnabled("realtime_sse");
      await service.isEnabled("realtime_sse");
      expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(10_000);
      await service.isEnabled("realtime_sse");
      expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("applies per-user overrides without leaking them to another user", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue(
      row({ enabled: true, perUser: { alice: false } }),
    );
    const service = new FeatureFlagsService(prismaMock, cache());

    await expect(service.isEnabled("realtime_sse", "alice")).resolves.toBe(
      false,
    );
    await expect(service.isEnabled("realtime_sse", "bob")).resolves.toBe(true);
    await expect(service.isEnabled("realtime_sse", null)).resolves.toBe(true);
    // The row is shared; the override map is applied per caller.
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(1);
  });

  it("invalidates on update so a toggle is effective immediately", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue(row({ enabled: true }));
    prismaMock.featureFlag.upsert.mockResolvedValue(row({ enabled: false }));
    const service = new FeatureFlagsService(prismaMock, cache());

    await expect(service.isEnabled("realtime_sse")).resolves.toBe(true);
    await service.update("realtime_sse", { enabled: false }, "admin-1");
    prismaMock.featureFlag.findUnique.mockResolvedValue(
      row({ enabled: false }),
    );

    await expect(service.isEnabled("realtime_sse")).resolves.toBe(false);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(2);
  });

  it("serves the env default and caches an absent row", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue(null);
    const service = new FeatureFlagsService(prismaMock, cache());
    const expected = service.envDefaults().registration_open;
    await expect(service.isEnabled("registration_open")).resolves.toBe(
      expected,
    );
    await expect(service.isEnabled("registration_open")).resolves.toBe(
      expected,
    );
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledTimes(1);
  });
});
