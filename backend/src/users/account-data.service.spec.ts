import { UnauthorizedException } from "@nestjs/common";
import type { User } from "@prisma/client";
import { hash as argonHash, argon2id } from "argon2";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { securityStamp } from "@/auth/security-stamp";
import { AccountDataService } from "./account-data.service";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: null,
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  disabledAt: null,
  emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  notifyDigest: true,
  notifyAttention: true,
  locale: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("AccountDataService deletion races", () => {
  it("rejects an in-flight deletion after a reset changed the stamp", async () => {
    const before = makeUser({
      passwordHash: await argonHash("old password", { type: argon2id }),
    });
    const after = makeUser({
      passwordHash: await argonHash("new password", { type: argon2id }),
    });
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduleInTransaction = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(after) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        entered();
        await gate;
        return fn(prisma);
      }),
    } as unknown as PrismaService;
    const service = new AccountDataService(
      prisma,
      {} as never,
      { scheduleInTransaction } as never,
      { record: jest.fn() } as never,
      {} as never,
      { enqueue: jest.fn() } as never,
    );

    const pending = service.deleteAccount(
      "user-1",
      { confirmEmail: "user@example.com", password: "old password" },
      securityStamp(before),
    );
    // The guard accepted the old token; the reset commits while the request
    // waits for the user row lock.
    await waiting;
    release();

    await expect(pending).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(pending).rejects.toThrow("Credentials changed");
    expect(scheduleInTransaction).not.toHaveBeenCalled();
  });
});
