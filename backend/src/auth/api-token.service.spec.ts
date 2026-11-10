import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiToken, User } from "@prisma/client";
import { API_TOKEN_PREFIX } from "@janosik/shared";
import { createHash } from "node:crypto";
import type { PrismaService } from "@/common/prisma/prisma.service";
import {
  API_TOKEN_DEFAULT_TTL_DAYS,
  ApiTokenService,
} from "./api-token.service";

const prismaMock = {
  apiToken: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  agentSession: { updateMany: jest.fn() },
  card: { updateMany: jest.fn(), findMany: jest.fn() },
  boardMember: {
    findUnique: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
} as unknown as PrismaService & {
  apiToken: Record<
    | "findUnique"
    | "findUniqueOrThrow"
    | "findFirst"
    | "findMany"
    | "create"
    | "update"
    | "updateMany",
    jest.Mock
  >;
  agentSession: Record<"updateMany", jest.Mock>;
  card: Record<"updateMany" | "findMany", jest.Mock>;
  boardMember: Record<"findUnique", jest.Mock>;
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
};

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "",
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  disabledAt: null,
  emailVerifiedAt: null,
  notifyDigest: true,
  notifyAttention: true,
  locale: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

const makeToken = (overrides: Partial<ApiToken> = {}): ApiToken => ({
  id: "token-1",
  userId: "user-1",
  name: "CI",
  tokenHash: "hash",
  boardId: null,
  readOnly: false,
  rateLimitPerMinute: null,
  scopePreset: "worker",
  trustedCi: false,
  individualPausedAt: null,
  individualPausedBy: null,
  individualPausedReason: null,
  stopAllPausedAt: null,
  stopAllPausedBy: null,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("ApiTokenService", () => {
  let service: ApiTokenService;
  const attentionMock = { notifyTokenRevoked: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prismaMock),
    );
    prismaMock.agentSession.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.card.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.card.findMany.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);
    attentionMock.notifyTokenRevoked.mockResolvedValue(undefined);
    service = new ApiTokenService(
      prismaMock,
      {
        record: jest.fn(),
      } as never,
      attentionMock as never,
    );
  });

  describe("generate / hashToken", () => {
    it("issues a jnk_ token whose hash is its sha256", () => {
      const token = service.generate();

      expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      // 32 random bytes → 43 base64url chars after the 4-char prefix.
      expect(token).toHaveLength(API_TOKEN_PREFIX.length + 43);
      expect(service.hashToken(token)).toBe(sha256(token));
      expect(service.generate()).not.toBe(token);
    });
  });

  describe("authenticate", () => {
    it("projects the owner and stamps lastUsedAt", async () => {
      const stored = makeToken();
      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...stored,
        user: makeUser({ displayName: "Vera", avatarColor: "teal" }),
      });

      const { user, tokenId } = await service.authenticate("raw-token");
      expect(tokenId).toBe("token-1");

      expect(prismaMock.apiToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256("raw-token") },
        include: { user: true },
      });
      expect(user).toEqual({
        id: "user-1",
        email: "user@example.com",
        displayName: "Vera",
        avatarColor: "teal",
        avatarPath: null,
        emailVerifiedAt: null,
        createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
        hasPassword: true,
      });
      expect(prismaMock.apiToken.update).toHaveBeenCalledWith({
        where: { id: "token-1" },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it("stamps lastUsedAt at most once a minute", async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...makeToken({ lastUsedAt: new Date(Date.now() - 5_000) }),
        user: makeUser(),
      });
      await service.authenticate("raw-token");
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();

      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...makeToken({ lastUsedAt: new Date(Date.now() - 61_000) }),
        user: makeUser(),
      });
      await service.authenticate("raw-token");
      expect(prismaMock.apiToken.update).toHaveBeenCalledTimes(1);
    });

    it("rejects an unknown token", async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(null);

      await expect(service.authenticate("ghost")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();
    });

    it("rejects a revoked token", async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...makeToken({ revokedAt: new Date() }),
        user: makeUser(),
      });

      await expect(service.authenticate("raw")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();
    });

    it("rejects an expired token", async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...makeToken({ expiresAt: new Date(Date.now() - 1000) }),
        user: makeUser(),
      });

      await expect(service.authenticate("raw")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects the token of a disabled user", async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        ...makeToken(),
        user: makeUser({ disabledAt: new Date() }),
      });

      await expect(service.authenticate("raw")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("returns every row newest first with Unix ms dates", async () => {
      prismaMock.apiToken.findMany.mockResolvedValue([
        makeToken({
          lastUsedAt: new Date("2026-09-02T00:00:00Z"),
          expiresAt: new Date("2027-09-01T00:00:00Z"),
          revokedAt: new Date("2026-09-03T00:00:00Z"),
        }),
      ]);

      const tokens = await service.list("user-1");

      expect(prismaMock.apiToken.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(tokens).toEqual([
        {
          id: "token-1",
          name: "CI",
          createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
          lastUsedAt: new Date("2026-09-02T00:00:00Z").getTime(),
          expiresAt: new Date("2027-09-01T00:00:00Z").getTime(),
          revokedAt: new Date("2026-09-03T00:00:00Z").getTime(),
          boardId: null,
          readOnly: false,
          rateLimitPerMinute: null,
          scopePreset: "worker",
          trustedCi: false,
          individualPausedAt: null,
          individualPausedBy: null,
          individualPausedReason: null,
          stopAllPausedAt: null,
          stopAllPausedBy: null,
          paused: false,
          effectiveTokenScope: "worker",
        },
      ]);
    });

    it("exposes TASK-166 scope, trust and pause state", async () => {
      prismaMock.apiToken.findMany.mockResolvedValue([
        makeToken({
          scopePreset: "reviewer",
          trustedCi: true,
          individualPausedAt: new Date("2026-09-04T00:00:00Z"),
          individualPausedBy: "admin-1",
          individualPausedReason: "maintenance",
          stopAllPausedAt: new Date("2026-09-05T00:00:00Z"),
          stopAllPausedBy: "owner-1",
          readOnly: false,
        }),
        makeToken({ id: "token-2", scopePreset: "admin", readOnly: true }),
      ]);

      const [paused, readOnly] = await service.list("user-1");

      expect(paused).toMatchObject({
        scopePreset: "reviewer",
        trustedCi: true,
        paused: true,
        effectiveTokenScope: "reviewer",
        individualPausedAt: new Date("2026-09-04T00:00:00Z").getTime(),
        stopAllPausedAt: new Date("2026-09-05T00:00:00Z").getTime(),
      });
      expect(readOnly).toMatchObject({
        scopePreset: "admin",
        paused: false,
        effectiveTokenScope: "observer",
      });
    });
  });

  describe("create", () => {
    it("stores the hash and returns the plaintext exactly once", async () => {
      prismaMock.apiToken.create.mockImplementation(
        async ({ data }: { data: Partial<ApiToken> }) =>
          makeToken({ name: data.name, expiresAt: data.expiresAt ?? null }),
      );

      const result = await service.create("user-1", {
        name: "Deploy",
        expiresAt: null,
      });

      expect(result.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      const stored = prismaMock.apiToken.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(sha256(result.token));
      expect(stored.tokenHash).not.toBe(result.token);
      expect(result.apiToken).toMatchObject({
        name: "Deploy",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
      });
    });

    it("bounds a token created without any expiresAt (B-2 default TTL)", async () => {
      prismaMock.apiToken.create.mockImplementation(
        async ({ data }: { data: Partial<ApiToken> }) => makeToken(data),
      );
      const before = Date.now();

      const result = await service.create("user-1", { name: "Forgetful" });

      const ttl = API_TOKEN_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
      expect(result.apiToken.expiresAt).toBeGreaterThanOrEqual(before + ttl);
      expect(result.apiToken.expiresAt).toBeLessThanOrEqual(Date.now() + ttl);
    });

    it("accepts a future expiry inside the TTL bound", async () => {
      prismaMock.apiToken.create.mockImplementation(
        async ({ data }: { data: Partial<ApiToken> }) => makeToken(data),
      );
      const future = new Date(Date.now() + 86_400_000).toISOString();

      const result = await service.create("user-1", {
        name: "Scoped",
        expiresAt: future,
      });

      expect(result.apiToken.expiresAt).toBe(new Date(future).getTime());
    });

    it("rejects past and over-long expiries", async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const tooFar = new Date(
        Date.now() + 3651 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await expect(
        service.create("user-1", { name: "Old", expiresAt: past }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create("user-1", { name: "Far", expiresAt: tooFar }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
    });

    it("stores read-only and a rate limit (TASK-157)", async () => {
      prismaMock.apiToken.create.mockImplementation(
        async ({ data }: { data: Partial<ApiToken> }) => makeToken(data),
      );

      const result = await service.create("user-1", {
        name: "Agent",
        expiresAt: null,
        readOnly: true,
        rateLimitPerMinute: 120,
      });

      expect(result.apiToken.readOnly).toBe(true);
      expect(result.apiToken.rateLimitPerMinute).toBe(120);
      expect(prismaMock.apiToken.create.mock.calls[0][0].data).toMatchObject({
        readOnly: true,
        rateLimitPerMinute: 120,
        boardId: null,
      });
    });

    it("stores TASK-166 scopePreset and trustedCi", async () => {
      prismaMock.apiToken.create.mockImplementation(
        async ({ data }: { data: Partial<ApiToken> }) => makeToken(data),
      );

      const result = await service.create(
        "user-1",
        {
          name: "Reviewer",
          expiresAt: null,
          scopePreset: "reviewer",
          trustedCi: true,
        },
        { allowTrustedCi: true },
      );

      expect(prismaMock.apiToken.create.mock.calls[0][0].data).toMatchObject({
        scopePreset: "reviewer",
        trustedCi: true,
      });
      expect(result.apiToken).toMatchObject({
        scopePreset: "reviewer",
        trustedCi: true,
        effectiveTokenScope: "reviewer",
        paused: false,
      });
    });

    it("rejects trustedCi unless the caller is a browser session", async () => {
      await expect(
        service.create("user-1", {
          name: "Escalated",
          expiresAt: null,
          trustedCi: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
    });

    it("rejects a board scope the owner is not a member of", async () => {
      prismaMock.boardMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create("user-1", { name: "Scoped", boardId: "board-9" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range rate limit", async () => {
      await expect(
        service.create("user-1", { name: "Fast", rateLimitPerMinute: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
    });
  });

  describe("revoke", () => {
    it("404s a token that belongs to someone else", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(null);

      await expect(service.revoke("user-2", "token-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.apiToken.updateMany).not.toHaveBeenCalled();
    });

    it("stamps an active token and stays idempotent", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(makeToken());
      prismaMock.apiToken.findMany.mockResolvedValue([{ id: "token-1" }]);
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 1 });

      await service.revoke("user-1", "token-1");

      expect(prismaMock.apiToken.findFirst).toHaveBeenCalledWith({
        where: { id: "token-1", userId: "user-1" },
      });
      expect(prismaMock.apiToken.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["token-1"] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.agentSession.updateMany).toHaveBeenCalledWith({
        where: { apiTokenId: { in: ["token-1"] }, endedAt: null },
        data: {
          status: "cancelled",
          endedAt: expect.any(Date),
          endReason: "cancelled",
        },
      });
      expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
        where: { claimedByTokenId: { in: ["token-1"] } },
        data: {
          claimedBy: null,
          claimedByTokenId: null,
          claimedBySessionId: null,
          leaseUntil: null,
        },
      });
      expect(attentionMock.notifyTokenRevoked).toHaveBeenCalledWith({
        userId: "user-1",
        tokenId: "token-1",
        tokenName: "CI",
        reason: "revoked",
      });
    });

    it("does not notify again when the token was already revoked", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(
        makeToken({ revokedAt: new Date("2026-09-03T00:00:00Z") }),
      );
      prismaMock.apiToken.findMany.mockResolvedValue([{ id: "token-1" }]);
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 0 });

      await service.revoke("user-1", "token-1");

      expect(attentionMock.notifyTokenRevoked).not.toHaveBeenCalled();
    });

    it("notifies the owner for every token in a bulk revoke", async () => {
      prismaMock.apiToken.findMany.mockResolvedValue([
        { id: "token-1", name: "CI" },
        { id: "token-2", name: "Deploy" },
      ]);
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 2 });

      expect(await service.revokeAll("user-1")).toBe(2);
      expect(attentionMock.notifyTokenRevoked).toHaveBeenCalledTimes(2);
      expect(attentionMock.notifyTokenRevoked).toHaveBeenCalledWith({
        userId: "user-1",
        tokenId: "token-1",
        tokenName: "CI",
        reason: "revoke_all",
      });
      expect(attentionMock.notifyTokenRevoked).toHaveBeenCalledWith({
        userId: "user-1",
        tokenId: "token-2",
        tokenName: "Deploy",
        reason: "revoke_all",
      });
    });
  });

  describe("pause / resume", () => {
    it("sets only the individual pause stamp", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(makeToken());
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.apiToken.findUniqueOrThrow.mockResolvedValue(
        makeToken({
          individualPausedAt: new Date("2026-09-02T00:00:00Z"),
          individualPausedBy: "user-1",
          individualPausedReason: "maintenance",
        }),
      );

      const dto = await service.pause("user-1", "token-1", " maintenance ");
      expect(dto).toMatchObject({
        paused: true,
        individualPausedAt: expect.any(Number),
        individualPausedBy: "user-1",
        individualPausedReason: "maintenance",
        stopAllPausedAt: null,
      });
      expect(prismaMock.apiToken.updateMany).toHaveBeenCalledWith({
        where: { id: "token-1", userId: "user-1", individualPausedAt: null },
        data: {
          individualPausedAt: expect.any(Date),
          individualPausedBy: "user-1",
          individualPausedReason: "maintenance",
        },
      });
    });

    it("resume clears only the individual stamp", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(makeToken());
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.apiToken.findUniqueOrThrow.mockResolvedValue(makeToken());

      await service.resume("user-1", "token-1", undefined);
      expect(prismaMock.apiToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: "token-1",
          userId: "user-1",
          individualPausedAt: { not: null },
        },
        data: {
          individualPausedAt: null,
          individualPausedBy: null,
          individualPausedReason: null,
        },
      });
    });

    it("is an explicit no-op on an already revoked token", async () => {
      prismaMock.apiToken.findFirst.mockResolvedValue(
        makeToken({ revokedAt: new Date("2026-09-03T00:00:00Z") }),
      );

      const dto = await service.pause("user-1", "token-1", "late");
      expect(dto.revokedAt).toBe(new Date("2026-09-03T00:00:00Z").getTime());
      expect(prismaMock.apiToken.updateMany).not.toHaveBeenCalled();
    });

    it("pause-all touches only stopAll; resume-all does not clear an individual pause", async () => {
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 2 });
      prismaMock.apiToken.findFirst.mockResolvedValue({
        stopAllPausedAt: new Date("2026-09-02T00:00:00Z"),
        stopAllPausedBy: "user-1",
      });

      await service.pauseAll("user-1", "freeze");
      expect(prismaMock.apiToken.updateMany).toHaveBeenLastCalledWith({
        where: {
          userId: "user-1",
          revokedAt: null,
          stopAllPausedAt: null,
        },
        data: {
          stopAllPausedAt: expect.any(Date),
          stopAllPausedBy: "user-1",
        },
      });

      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 2 });
      await service.resumeAll("user-1", undefined);
      expect(prismaMock.apiToken.updateMany).toHaveBeenLastCalledWith({
        where: {
          userId: "user-1",
          revokedAt: null,
          stopAllPausedAt: { not: null },
        },
        data: { stopAllPausedAt: null, stopAllPausedBy: null },
      });
    });
  });
});
