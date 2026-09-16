import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, type User } from "@prisma/client";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { AuthService } from "./auth.service";

const prismaMock = {
  user: {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
} as unknown as PrismaService & {
  user: Record<"count" | "create" | "findUnique", jest.Mock>;
  refreshToken: Record<"create" | "findUnique" | "updateMany", jest.Mock>;
};

const jwtMock = { signAsync: jest.fn() } as unknown as JwtService & {
  signAsync: jest.Mock;
};

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "",
  displayName: null,
  isSuperAdmin: false,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AuthService(prismaMock, jwtMock);
    jwtMock.signAsync.mockResolvedValue("access-token");
    prismaMock.refreshToken.create.mockResolvedValue({});
  });

  describe("register", () => {
    it("hashes the password with argon2id and makes the first user a super-admin", async () => {
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.create.mockImplementation(async ({ data }) =>
        makeUser({
          email: data.email,
          passwordHash: data.passwordHash,
          displayName: data.displayName,
          isSuperAdmin: data.isSuperAdmin,
        }),
      );

      const result = await service.register({
        email: "user@example.com",
        password: "correct horse battery",
        displayName: "Vera",
      });

      expect(result.user).toEqual({
        id: "user-1",
        email: "user@example.com",
        displayName: "Vera",
        isSuperAdmin: true,
      });
      expect(result.accessToken).toBe("access-token");
      const { passwordHash } = prismaMock.user.create.mock.calls[0][0].data;
      expect(passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(await argon2.verify(passwordHash, "correct horse battery")).toBe(
        true,
      );
    });

    it("stores only the sha256 hash of the refresh token", async () => {
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.create.mockResolvedValue(makeUser());

      const result = await service.register({
        email: "user@example.com",
        password: "correct horse battery",
      });

      expect(result.refreshToken).not.toContain("+");
      expect(result.refreshToken).not.toContain("/");
      const stored = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(sha256(result.refreshToken));
      expect(stored.tokenHash).not.toBe(result.refreshToken);
    });

    it("does not grant super-admin to a later user", async () => {
      prismaMock.user.count.mockResolvedValue(3);
      prismaMock.user.create.mockImplementation(async ({ data }) =>
        makeUser({ isSuperAdmin: data.isSuperAdmin }),
      );

      const result = await service.register({
        email: "second@example.com",
        password: "correct horse battery",
      });

      expect(result.user.isSuperAdmin).toBe(false);
    });

    it("maps a unique-constraint violation to 409", async () => {
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        service.register({
          email: "taken@example.com",
          password: "correct horse battery",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("login", () => {
    it("issues a session for valid credentials", async () => {
      const passwordHash = await argon2.hash("correct horse battery", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

      const result = await service.login({
        email: "user@example.com",
        password: "correct horse battery",
      });

      expect(result.user.email).toBe("user@example.com");
      expect(result.accessToken).toBe("access-token");
    });

    it("answers 401 with the same generic message for wrong password", async () => {
      const passwordHash = await argon2.hash("correct horse battery", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

      const error = await service
        .login({ email: "user@example.com", password: "wrong password" })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe("Invalid credentials");
    });

    it("answers the same generic 401 for an unknown email", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const error = await service
        .login({ email: "ghost@example.com", password: "whatever pass" })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe("Invalid credentials");
    });
  });

  describe("refresh", () => {
    const rawToken = "raw-refresh-token-value";

    it("looks the token up by its sha256 hash and rotates it", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser(),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refresh(rawToken);

      expect(result.accessToken).toBe("access-token");
      expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256(rawToken) },
        include: { user: true },
      });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: "token-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects an unknown token", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it("rejects an expired token", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() - 60_000),
        revokedAt: null,
        user: makeUser(),
      });

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("revokes every session of the user when a revoked token is reused", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Date.now() - 1000),
        user: makeUser(),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("requires a token at all", async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes the presented active token", async () => {
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout("raw-refresh-token-value");

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: sha256("raw-refresh-token-value"),
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("is a no-op without a cookie", async () => {
      await service.logout(undefined);
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
