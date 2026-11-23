import type { User } from "@prisma/client";
import { HotPathCacheService } from "@/common/hot-path-cache.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { securityStamp } from "@/auth/security-stamp";
import { StreamAccessService } from "./stream-access.service";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "u@example.com",
    passwordHash: "hash-a",
    displayName: null,
    avatarColor: null,
    avatarPath: null,
    disabledAt: null,
    emailVerifiedAt: new Date(0),
    notifyDigest: true,
    notifyAttention: true,
    locale: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("StreamAccessService keep-alive snapshot (TASK-200.5)", () => {
  const boardMember = {
    acceptedAt: new Date(0),
    expiresAt: null as Date | null,
    board: { deletedAt: null as Date | null },
  };
  const prismaMock = {
    boardMember: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    refreshToken: { findFirst: jest.fn() },
  };
  const apiTokensMock = { isActive: jest.fn() };

  function cache(): HotPathCacheService {
    const bus = {
      publishInvalidation: jest.fn(),
      onInvalidation: jest.fn(() => () => undefined),
    };
    return new HotPathCacheService(bus as never, {
      patTtlMs: 0,
      membershipTtlMs: 30_000,
      streamMembershipTtlMs: 30_000,
      flagsTtlMs: 0,
      patMaxEntries: 10,
      membershipMaxEntries: 10,
      streamMembershipMaxEntries: 10,
      flagsMaxEntries: 10,
    });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.boardMember.findUnique.mockResolvedValue(boardMember);
    prismaMock.refreshToken.findFirst.mockResolvedValue({ id: "family-1" });
    apiTokensMock.isActive.mockResolvedValue(true);
  });

  function service(hotPathCache = cache()): StreamAccessService {
    return new StreamAccessService(
      prismaMock as unknown as PrismaService,
      apiTokensMock as never,
      hotPathCache,
    );
  }

  it("keeps the membership snapshot but reads a changed password fresh", async () => {
    const first = user();
    prismaMock.user.findUnique.mockResolvedValue(first);
    const access = service();
    const principal = {
      via: "jwt" as const,
      stamp: securityStamp(first),
    };

    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(true);
    expect(prismaMock.boardMember.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);

    // A password rotation changes the stamp. The membership snapshot is
    // still valid, but the open stream must close on the next tick.
    prismaMock.user.findUnique.mockResolvedValue(
      user({ passwordHash: "hash-b" }),
    );
    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(false);
    expect(prismaMock.boardMember.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("closes when the account is disabled, without waiting for the snapshot", async () => {
    const first = user();
    prismaMock.user.findUnique.mockResolvedValue(first);
    const access = service();
    const principal = {
      via: "jwt" as const,
      stamp: securityStamp(first),
    };
    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(true);

    prismaMock.user.findUnique.mockResolvedValue(
      user({ disabledAt: new Date() }),
    );
    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(false);
  });

  it("checks PAT activity fresh while sharing the membership snapshot", async () => {
    const access = service();
    const principal = { via: "pat" as const, apiTokenId: "token-1" };

    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(true);
    apiTokensMock.isActive.mockResolvedValue(false);
    await expect(
      access.memberStreamAllowed("board-1", "user-1", principal),
    ).resolves.toBe(false);
    expect(apiTokensMock.isActive).toHaveBeenCalledTimes(2);
    expect(prismaMock.boardMember.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not serve a lapsed VIEWER window from the snapshot", async () => {
    prismaMock.boardMember.findUnique.mockResolvedValue({
      ...boardMember,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(
      service().memberStreamAllowed("board-1", "user-1", {
        via: "pat",
        apiTokenId: "token-1",
      }),
    ).resolves.toBe(false);
  });
});
