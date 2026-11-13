import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, type User } from "@prisma/client";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { MailerService } from "@/mailer/mailer.service";
import type { MailQueueService } from "@/mailer/mail-queue.service";
import {
  emailChangeCodeEmail,
  emailChangedNoticeEmail,
  verificationCodeEmail,
} from "@/mailer/templates";
import type { EmailTemplateService } from "@/ops/email-template.service";
import type { FeatureFlagsService } from "@/ops/feature-flags.service";
import { AuthService, REFRESH_REUSE_GRACE_MS } from "./auth.service";
import { LoginBackoffService } from "./login-backoff.service";
import { securityStamp } from "./security-stamp";

const prismaMock = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  apiToken: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  passwordResetToken: { deleteMany: jest.fn() },
  agentSession: { updateMany: jest.fn() },
  card: { findMany: jest.fn(), updateMany: jest.fn() },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  emailVerificationCode: { deleteMany: jest.fn(), create: jest.fn() },
  emailChangeCode: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
} as unknown as PrismaService & {
  user: Record<"create" | "findUnique" | "update" | "count", jest.Mock>;
  refreshToken: Record<"create" | "findUnique" | "updateMany", jest.Mock>;
  apiToken: Record<"findMany" | "updateMany", jest.Mock>;
  passwordResetToken: Record<"deleteMany", jest.Mock>;
  agentSession: Record<"updateMany", jest.Mock>;
  card: Record<"findMany" | "updateMany", jest.Mock>;
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  emailVerificationCode: Record<"deleteMany" | "create", jest.Mock>;
  emailChangeCode: Record<
    "findFirst" | "create" | "update" | "updateMany" | "deleteMany",
    jest.Mock
  >;
  $transaction: jest.Mock;
};

const jwtMock = {
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
} as unknown as JwtService & {
  signAsync: jest.Mock;
  verifyAsync: jest.Mock;
};

const mailerMock = {
  send: jest.fn(),
} as unknown as MailerService & { send: jest.Mock };

/** TASK-67: enqueue delegates to the mailer; a transport failure is swallowed
 * (best-effort), exactly like the in-process drain. */
const mailQueueMock = {
  enqueue: jest.fn(),
} as unknown as MailQueueService & { enqueue: jest.Mock };

const emailTemplatesMock = {
  verificationEmail: jest.fn(
    (code: string, minutes: number, locale: "en" | "ru") =>
      Promise.resolve(verificationCodeEmail(code, minutes, locale)),
  ),
  emailChangeEmail: jest.fn(
    (code: string, minutes: number, locale: "en" | "ru") =>
      Promise.resolve(emailChangeCodeEmail(code, minutes, locale)),
  ),
  emailChangedNotice: jest.fn((email: string, locale: "en" | "ru") =>
    Promise.resolve(emailChangedNoticeEmail(email, locale)),
  ),
} as unknown as EmailTemplateService & {
  verificationEmail: jest.Mock;
  emailChangeEmail: jest.Mock;
  emailChangedNotice: jest.Mock;
};

const flagsMock = {
  assertEnabled: jest.fn(async () => undefined),
  isEnabled: jest.fn(async () => true),
} as unknown as FeatureFlagsService;

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

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    emailTemplatesMock.verificationEmail.mockImplementation(
      (code: string, minutes: number, locale: "en" | "ru") =>
        Promise.resolve(verificationCodeEmail(code, minutes, locale)),
    );
    emailTemplatesMock.emailChangeEmail.mockImplementation(
      (code: string, minutes: number, locale: "en" | "ru") =>
        Promise.resolve(emailChangeCodeEmail(code, minutes, locale)),
    );
    emailTemplatesMock.emailChangedNotice.mockImplementation(
      (email: string, locale: "en" | "ru") =>
        Promise.resolve(emailChangedNoticeEmail(email, locale)),
    );
    mailQueueMock.enqueue.mockImplementation(async (job: { to: string }) => {
      try {
        await mailerMock.send(job);
      } catch {
        /* best-effort, like the in-process drain */
      }
    });
    service = new AuthService(
      prismaMock,
      jwtMock,
      mailerMock,
      mailQueueMock,
      emailTemplatesMock,
      flagsMock,
      new LoginBackoffService(),
      { record: jest.fn() } as never,
    );
    jwtMock.signAsync.mockResolvedValue("access-token");
    Object.defineProperty(mailerMock, "enabled", {
      value: true,
      configurable: true,
    });
    prismaMock.user.findUnique.mockResolvedValue(makeUser());
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.emailVerificationCode.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.emailVerificationCode.create.mockResolvedValue({});
    prismaMock.emailChangeCode.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.apiToken.findMany.mockResolvedValue([]);
    prismaMock.apiToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.card.findMany.mockResolvedValue([]);
    prismaMock.card.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.agentSession.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    );
  });

  describe("register", () => {
    it("refuses password registration when email delivery is disabled", async () => {
      Object.defineProperty(mailerMock, "enabled", {
        value: false,
        configurable: true,
      });
      await expect(
        service.register({
          email: "user@example.com",
          password: "correct horse battery",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
    it("hashes the password with argon2id and starts a session", async () => {
      prismaMock.user.create.mockImplementation(async ({ data }) => {
        const created = makeUser({
          email: data.email,
          passwordHash: data.passwordHash,
          displayName: data.displayName,
          // The service decides verification at creation time (TASK-53).
          emailVerifiedAt: data.emailVerifiedAt,
        });
        prismaMock.user.findUnique.mockResolvedValue(created);
        return created;
      });

      const result = await service.register({
        email: "user@example.com",
        password: "correct horse battery",
        displayName: "Vera",
      });

      expect(result.user).toEqual({
        id: "user-1",
        email: "user@example.com",
        displayName: "Vera",
        avatarColor: null,
        avatarPath: null,
        createdAt: new Date("2026-09-01T00:00:00Z").getTime(),
        emailVerifiedAt: null,
        // TASK-166: the session method rides along for the account panel.
        authMethod: "password",
        hasPassword: true,
      });
      expect(result.accessToken).toBe("access-token");
      // Audience isolation (TASK-36): user tokens are signed for this
      // contour only, so they can never pass the admin strategy.
      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        { sub: "user-1", authMethod: "password", stamp: expect.any(String) },
        { audience: "janosik-user" },
      );
      const { passwordHash } = prismaMock.user.create.mock.calls[0][0].data;
      expect(passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(await argon2.verify(passwordHash, "correct horse battery")).toBe(
        true,
      );
    });

    it("stores only the sha256 hash of the refresh token", async () => {
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

    it("maps a unique-constraint violation to 409", async () => {
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

    it("bootstraps exactly the first account without email delivery", async () => {
      Object.defineProperty(mailerMock, "enabled", {
        value: false,
        configurable: true,
      });
      const original = process.env.ALLOW_BOOTSTRAP_USER;
      process.env.ALLOW_BOOTSTRAP_USER = "true";
      const created = makeUser({
        email: "first@example.com",
        emailVerifiedAt: new Date(),
      });
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.create.mockResolvedValue(created);
      prismaMock.user.findUnique.mockResolvedValue(created);
      try {
        const result = await service.register({
          email: "first@example.com",
          password: "correct horse battery",
        });

        expect(result.user.email).toBe("first@example.com");
        expect(prismaMock.$queryRaw).toHaveBeenCalled();
        expect(prismaMock.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              emailVerifiedAt: expect.any(Date),
            }),
          }),
        );
      } finally {
        if (original === undefined) delete process.env.ALLOW_BOOTSTRAP_USER;
        else process.env.ALLOW_BOOTSTRAP_USER = original;
      }
    });

    it("refuses bootstrap once a user already exists", async () => {
      Object.defineProperty(mailerMock, "enabled", {
        value: false,
        configurable: true,
      });
      const original = process.env.ALLOW_BOOTSTRAP_USER;
      process.env.ALLOW_BOOTSTRAP_USER = "true";
      prismaMock.user.count.mockResolvedValue(1);
      try {
        await expect(
          service.register({
            email: "second@example.com",
            password: "correct horse battery",
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      } finally {
        if (original === undefined) delete process.env.ALLOW_BOOTSTRAP_USER;
        else process.env.ALLOW_BOOTSTRAP_USER = original;
      }
    });
  });

  describe("login", () => {
    it("requires the current password before linking an OAuth provider", async () => {
      const passwordHash = await argon2.hash("correct horse battery", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
      await expect(
        service.issueOAuthLinkProof("user-1", "wrong", "state"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtMock.signAsync).not.toHaveBeenCalled();
      await service.issueOAuthLinkProof(
        "user-1",
        "correct horse battery",
        "state",
      );
      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: "user-1",
          state: "state",
          stamp: expect.any(String),
        }),
        expect.objectContaining({ audience: "janosik-oauth-link" }),
      );
    });
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

    it("refuses a disabled account with 403 after a correct password", async () => {
      const passwordHash = await argon2.hash("correct horse battery", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash, disabledAt: new Date() }),
      );

      await expect(
        service.login({
          email: "user@example.com",
          password: "correct horse battery",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
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

    it("rejects a rotation when credentials changed after the initial read", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser({ passwordHash: "old" }),
      });
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: "new" }),
      );
      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("preserves the real OAuth authentication time when rotating", async () => {
      const authenticatedAt = 1700000000000;
      const raw = `jnko_${authenticatedAt}_opaque`;
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser(),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.refresh(raw);
      expect(result.refreshToken.startsWith(`jnko_${authenticatedAt}_`)).toBe(
        true,
      );
      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          authMethod: "oauth",
          authTime: authenticatedAt,
        }),
        expect.anything(),
      );
    });

    it("keeps a legacy OAuth-only refresh marked as oauth with authTime 0", async () => {
      const raw = "old-refresh-without-prefix";
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser({ passwordHash: null }),
      });
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: null }),
      );
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refresh(raw);

      expect(result.refreshToken.startsWith("jnko_0_")).toBe(true);
      expect(jwtMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ authMethod: "oauth", authTime: 0 }),
        expect.anything(),
      );
    });

    it("writes the new family onto a legacy rotated token", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        familyId: null,
        user: makeUser(),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.refreshToken.create.mockResolvedValue({});

      await service.refresh(rawToken);

      const rotation = prismaMock.refreshToken.updateMany.mock.calls[0][0];
      expect(rotation.data.familyId).toEqual(expect.any(String));
      const created = prismaMock.refreshToken.create.mock.calls[0][0];
      expect(created.data.familyId).toBe(rotation.data.familyId);
    });

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
        where: {
          id: "token-1",
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
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
        // Beyond the grace window — a real theft signal (§7.0).
        revokedAt: new Date(Date.now() - 2 * REFRESH_REUSE_GRACE_MS),
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

    it("treats a reuse within the grace window as a lost race, not theft", async () => {
      // A rotation whose response never reached the browser (frozen tab,
      // dropped network) leaves the client on the stale cookie; its retry
      // presents a just-revoked token. No sessions may die for that.
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Date.now() - 1000),
        user: makeUser(),
      });

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("answers a concurrent rotation race with 401 and keeps the sessions", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser(),
      });
      // Another request rotated the token between the read and the write.
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Only the single-token rotation attempt, no all-sessions revocation.
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: "token-1",
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it("kills every session of a disabled account", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        tokenHash: sha256(rawToken),
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: makeUser({ disabledAt: new Date() }),
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(
        ForbiddenException,
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
    it("revokes the whole rotation family of the presented token", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        familyId: "family-1",
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.logout("raw-refresh-token-value");

      expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256("raw-refresh-token-value") },
        select: { id: true, userId: true, familyId: true },
      });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          familyId: "family-1",
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("revokes a legacy token without a family by its id", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "token-1",
        userId: "user-1",
        familyId: null,
      });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout("raw-refresh-token-value");

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: "token-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("is a no-op without a cookie", async () => {
      await service.logout(undefined);
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("changePassword", () => {
    const current = "correct horse battery";
    const next = "new correct horse battery";

    it("hashes the new password and revokes every other session", async () => {
      const passwordHash = await argon2.hash(current, {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash });
      prismaMock.user.findUnique.mockResolvedValue(user);
      prismaMock.user.update.mockResolvedValue(makeUser());
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.apiToken.findMany.mockResolvedValue([{ id: "token-1" }]);
      prismaMock.apiToken.updateMany.mockResolvedValue({ count: 1 });

      await service.changePassword(
        "user-1",
        { currentPassword: current, newPassword: next },
        "caller-cookie",
        securityStamp(user),
      );

      const stored = prismaMock.user.update.mock.calls[0][0].data.passwordHash;
      expect(stored.startsWith("$argon2id$")).toBe(true);
      expect(await argon2.verify(stored, next)).toBe(true);
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          revokedAt: null,
          tokenHash: { not: sha256("caller-cookie") },
        },
        data: { revokedAt: expect.any(Date) },
      });
      // B-2: a password rotation also kills every personal API token.
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
    });

    it("rejects a wrong current password without writing", async () => {
      const passwordHash = await argon2.hash(current, {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash });
      prismaMock.user.findUnique.mockResolvedValue(user);

      const error = await service
        .changePassword(
          "user-1",
          { currentPassword: "wrong horse battery", newPassword: next },
          undefined,
          securityStamp(user),
        )
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe("Current password is incorrect");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.apiToken.updateMany).not.toHaveBeenCalled();
    });

    it("rejects an in-flight request after a reset changed the stamp", async () => {
      const before = makeUser({
        passwordHash: await argon2.hash(current, {
          type: argon2.argon2id,
        }),
      });
      const after = makeUser({
        passwordHash: await argon2.hash(next, { type: argon2.argon2id }),
      });
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      prismaMock.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          entered();
          await gate;
          return fn(prismaMock);
        },
      );
      prismaMock.user.findUnique.mockResolvedValue(after);

      const pending = service.changePassword(
        "user-1",
        { currentPassword: current, newPassword: next },
        undefined,
        securityStamp(before),
      );
      // The request already passed the guard; the reset commits while it
      // waits for the row lock.
      await waiting;
      release();

      await expect(pending).rejects.toThrow("Credentials changed");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("requires a fresh OAuth proof to set the first password", async () => {
      const user = makeUser({ passwordHash: null });
      prismaMock.user.findUnique.mockResolvedValue(user);

      const error = await service
        .changePassword(
          "user-1",
          { newPassword: next },
          undefined,
          securityStamp(user),
        )
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.response).toMatchObject({ code: "oauth_proof_required" });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("accepts a fresh OAuth proof for the first password", async () => {
      const user = makeUser({ passwordHash: null });
      prismaMock.user.findUnique.mockResolvedValue(user);
      prismaMock.user.update.mockResolvedValue(makeUser());
      jwtMock.verifyAsync.mockResolvedValue({
        sub: user.id,
        authMethod: "oauth",
        authTime: Date.now(),
        stamp: securityStamp(user),
      });

      await service.changePassword(
        "user-1",
        { newPassword: next, oauthProof: "fresh-oauth-token" },
        undefined,
        securityStamp(user),
      );

      expect(jwtMock.verifyAsync).toHaveBeenCalledWith(
        "fresh-oauth-token",
        expect.objectContaining({ audience: "janosik-user" }),
      );
      expect(prismaMock.user.update).toHaveBeenCalled();
    });

    it("revokes all sessions when no caller cookie is present", async () => {
      const passwordHash = await argon2.hash(current, {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash });
      prismaMock.user.findUnique.mockResolvedValue(user);
      prismaMock.user.update.mockResolvedValue(makeUser());

      await service.changePassword(
        "user-1",
        { currentPassword: current, newPassword: next },
        undefined,
        securityStamp(user),
      );

      expect(prismaMock.user.update).toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe("email change (TASK-51)", () => {
    const currentPassword = "correct horse battery";

    const passwordHashOf = async () =>
      argon2.hash(currentPassword, { type: argon2.argon2id });

    describe("requestEmailChange", () => {
      it("replaces any pending code and emails a fresh one to the new address", async () => {
        const user = makeUser({ passwordHash: await passwordHashOf() });
        prismaMock.user.findUnique
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(null); // uniqueness pre-check
        prismaMock.emailChangeCode.deleteMany.mockResolvedValue({ count: 1 });
        prismaMock.emailChangeCode.create.mockResolvedValue({});
        mailerMock.send.mockResolvedValue(undefined);

        const result = await service.requestEmailChange(
          "user-1",
          { newEmail: "new@example.com", currentPassword },
          "en",
          securityStamp(user),
        );

        expect(prismaMock.emailChangeCode.deleteMany).toHaveBeenCalledWith({
          where: { userId: "user-1" },
        });
        const created = prismaMock.emailChangeCode.create.mock.calls[0][0].data;
        expect(created.userId).toBe("user-1");
        expect(created.newEmail).toBe("new@example.com");
        // Only the sha256 of the code is ever persisted.
        expect(created.codeHash).toMatch(/^[0-9a-f]{64}$/);
        expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
        const sent = mailerMock.send.mock.calls[0][0];
        expect(sent.to).toBe("new@example.com");
        expect(sent.subject).toContain("verification code");
        const code = sent.text.match(/\b\d{6}\b/)?.[0] ?? "";
        expect(sha256(`email-change:user-1:${code}`)).toBe(created.codeHash);
        expect(result.expiresAt).toBe(created.expiresAt.getTime());
      });

      it("rejects a wrong current password without creating a code", async () => {
        const user = makeUser({ passwordHash: await passwordHashOf() });
        prismaMock.user.findUnique.mockResolvedValue(user);

        const error = await service
          .requestEmailChange(
            "user-1",
            { newEmail: "new@example.com", currentPassword: "wrong" },
            "en",
            securityStamp(user),
          )
          .catch((e) => e);

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.message).toBe("Current password is incorrect");
        expect(prismaMock.emailChangeCode.create).not.toHaveBeenCalled();
        expect(mailerMock.send).not.toHaveBeenCalled();
      });

      it("rejects an in-flight request after the credential stamp changed", async () => {
        const before = makeUser({ passwordHash: await passwordHashOf() });
        const after = makeUser({
          passwordHash: await argon2.hash("a newer password", {
            type: argon2.argon2id,
          }),
        });
        let entered!: () => void;
        const waiting = new Promise<void>((resolve) => {
          entered = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        prismaMock.$transaction.mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) => {
            entered();
            await gate;
            return fn(prismaMock);
          },
        );
        prismaMock.user.findUnique.mockResolvedValue(after);

        const pending = service.requestEmailChange(
          "user-1",
          { newEmail: "new@example.com", currentPassword },
          "en",
          securityStamp(before),
        );
        await waiting;
        release();

        await expect(pending).rejects.toThrow("Credentials changed");
        expect(prismaMock.emailChangeCode.create).not.toHaveBeenCalled();
      });

      it("refuses the unchanged address", async () => {
        const user = makeUser({ passwordHash: await passwordHashOf() });
        prismaMock.user.findUnique.mockResolvedValue(user);

        await expect(
          service.requestEmailChange(
            "user-1",
            { newEmail: "user@example.com", currentPassword },
            "en",
            securityStamp(user),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.emailChangeCode.create).not.toHaveBeenCalled();
      });

      it("refuses an address that is already registered", async () => {
        const user = makeUser({ passwordHash: await passwordHashOf() });
        prismaMock.user.findUnique
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(makeUser({ id: "other-user" }));

        await expect(
          service.requestEmailChange(
            "user-1",
            { newEmail: "taken@example.com", currentPassword },
            "en",
            securityStamp(user),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.emailChangeCode.create).not.toHaveBeenCalled();
      });

      it("queues the code even when the transport fails (no 503, TASK-67)", async () => {
        const user = makeUser({ passwordHash: await passwordHashOf() });
        prismaMock.user.findUnique
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(null);
        prismaMock.emailChangeCode.create.mockResolvedValue({});
        mailerMock.send.mockRejectedValue(new Error("smtp down"));

        const result = await service.requestEmailChange(
          "user-1",
          { newEmail: "new@example.com", currentPassword },
          "en",
          securityStamp(user),
        );
        expect(result.queued).toBe(true);
        expect(prismaMock.emailChangeCode.create).toHaveBeenCalled();
      });
    });

    describe("confirmEmailChange", () => {
      const code = "123456";
      const future = new Date(Date.now() + 60_000);
      const pendingRow = () => ({
        id: "change-1",
        userId: "user-1",
        newEmail: "new@example.com",
        codeHash: sha256(code),
        attempts: 0,
        expiresAt: future,
        consumedAt: null,
        createdAt: new Date(),
      });

      const expectConfirmation = async (
        stored: Record<string, unknown> | null,
      ) => {
        prismaMock.user.findUnique.mockResolvedValue(
          makeUser({ passwordHash: await passwordHashOf() }),
        );
        prismaMock.emailChangeCode.findFirst.mockResolvedValue(stored);
      };

      it("moves the email, consumes the code and revokes other sessions", async () => {
        await expectConfirmation(pendingRow());
        const updatedUser = makeUser({ email: "new@example.com" });
        const txUserUpdate = jest.fn().mockResolvedValue(updatedUser);
        const txCodeUpdate = jest.fn().mockResolvedValue({ count: 1 });
        const txSessionUpdate = jest.fn().mockResolvedValue({ count: 2 });
        prismaMock.$transaction.mockImplementation(
          async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              $queryRaw: jest.fn(),
              user: {
                update: txUserUpdate,
                findUnique: jest.fn().mockResolvedValue(updatedUser),
              },
              emailChangeCode: { updateMany: txCodeUpdate },
              emailVerificationCode: { deleteMany: jest.fn() },
              passwordResetToken: { deleteMany: jest.fn() },
              refreshToken: {
                findFirst: jest.fn().mockResolvedValue({ id: "session" }),
                updateMany: txSessionUpdate,
              },
            }),
        );
        prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 2 });
        mailerMock.send.mockResolvedValue(undefined);

        const result = await service.confirmEmailChange(
          "user-1",
          { code },
          "ru",
          "caller-cookie",
        );

        expect(txUserUpdate).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { email: "new@example.com", emailVerifiedAt: expect.any(Date) },
        });
        expect(txCodeUpdate).toHaveBeenCalledWith({
          where: {
            id: "change-1",
            consumedAt: null,
            expiresAt: { gt: expect.any(Date) },
          },
          data: { consumedAt: expect.any(Date) },
        });
        expect(txSessionUpdate).toHaveBeenCalledWith({
          where: {
            userId: "user-1",
            revokedAt: null,
            tokenHash: { not: sha256("caller-cookie") },
          },
          data: { revokedAt: expect.any(Date) },
        });
        // The notice goes to the OLD address, in the caller's locale.
        const sent = mailerMock.send.mock.calls[0][0];
        expect(sent.to).toBe("user@example.com");
        expect(sent.subject).toContain("изменён");
        expect(result.user.email).toBe("new@example.com");
        expect(result.accessToken).toBe("access-token");
      });

      it("rejects a wrong code and burns an attempt", async () => {
        await expectConfirmation(pendingRow());
        prismaMock.emailChangeCode.update.mockResolvedValue({});

        await expect(
          service.confirmEmailChange("user-1", { code: "000000" }, "en"),
        ).rejects.toThrow("Invalid verification code");
        expect(prismaMock.emailChangeCode.updateMany).toHaveBeenCalledWith({
          where: {
            id: "change-1",
            consumedAt: null,
            expiresAt: { gt: expect.any(Date) },
            attempts: { lt: 5 },
          },
          data: { attempts: { increment: 1 } },
        });
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
      });

      it("destroys the code after the fifth wrong attempt", async () => {
        await expectConfirmation({ ...pendingRow(), attempts: 4 });
        prismaMock.emailChangeCode.deleteMany.mockResolvedValue({ count: 1 });

        await expect(
          service.confirmEmailChange("user-1", { code: "000000" }, "en"),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.emailChangeCode.deleteMany).toHaveBeenCalledWith({
          where: { id: "change-1", attempts: { gte: 5 } },
        });
        expect(prismaMock.emailChangeCode.update).not.toHaveBeenCalled();
      });

      it.each([
        [
          "expired",
          () => ({ ...pendingRow(), expiresAt: new Date(Date.now() - 1) }),
        ],
        ["consumed", () => ({ ...pendingRow(), consumedAt: new Date() })],
        ["absent", () => null],
      ])("answers no-pending for a %s code", async (_label, row) => {
        await expectConfirmation(row());

        await expect(
          service.confirmEmailChange("user-1", { code }, "en"),
        ).rejects.toThrow("No pending email change");
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      });

      it("maps a late unique-constraint violation to 409", async () => {
        await expectConfirmation(pendingRow());
        prismaMock.$transaction.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          }),
        );

        await expect(
          service.confirmEmailChange("user-1", { code }, "en"),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(mailerMock.send).not.toHaveBeenCalled();
      });
    });
  });
});
