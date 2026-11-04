import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash, argon2id } from "argon2";
import { randomUUID } from "node:crypto";
import { AppModule } from "@/app.module";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AuthService } from "@/auth/auth.service";
import { MailerService } from "@/mailer/mailer.service";

describe("Password recovery security (database integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let mailer: MailerService;
  let mailEnabled: jest.SpyInstance;
  const userIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    mailer = app.get(MailerService);
    mailEnabled = jest.spyOn(mailer, "enabled", "get").mockReturnValue(true);
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    mailEnabled.mockRestore();
    await app.close();
  });
  async function user() {
    const account = await prisma.user.create({
      data: {
        email: `reset-${randomUUID()}@example.com`,
        passwordHash: await hash("old-password", { type: argon2id }),
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(account.id);
    return account;
  }
  async function issue(email: string) {
    await auth.requestPasswordReset(email, "en");
    const message = [...mailer.outbox]
      .reverse()
      .find((item) => item.to === email);
    const code = message?.text.match(/\b[a-f0-9]{32}\b/)?.[0];
    expect(code).toBeDefined();
    return code!;
  }
  it("stores only a hash and rejects an expired code", async () => {
    const account = await user();
    const code = await issue(account.email);
    const token = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { userId: account.id },
    });
    expect(token.tokenHash).not.toContain(code);
    await prisma.passwordResetToken.update({
      where: { userId: account.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      auth.confirmPasswordReset({
        email: account.email,
        code,
        newPassword: "new-password",
      }),
    ).rejects.toThrow("Invalid or expired");
  });
  it("revokes sessions and API keys and consumes the code", async () => {
    const account = await user();
    const code = await issue(account.email);
    await prisma.refreshToken.create({
      data: {
        userId: account.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.apiToken.create({
      data: { userId: account.id, tokenHash: randomUUID(), name: "test" },
    });
    const dto = { email: account.email, code, newPassword: "new-password" };
    await auth.confirmPasswordReset(dto);
    expect(
      await prisma.refreshToken.count({
        where: { userId: account.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.apiToken.count({
        where: { userId: account.id, revokedAt: null },
      }),
    ).toBe(0);
    await expect(auth.confirmPasswordReset(dto)).rejects.toThrow(
      "Invalid or expired",
    );
  });
  it("limits requests per account without replacing the live code", async () => {
    const account = await user();
    const code = await issue(account.email);
    expect(await auth.requestPasswordReset(account.email, "en")).toBe(true);
    await auth.confirmPasswordReset({
      email: account.email,
      code,
      newPassword: "new-password",
    });
  });
  it("does not issue codes to unverified or disabled accounts", async () => {
    const unverified = await user();
    const disabled = await user();
    await prisma.user.update({
      where: { id: unverified.id },
      data: { emailVerifiedAt: null },
    });
    await prisma.user.update({
      where: { id: disabled.id },
      data: { disabledAt: new Date() },
    });
    await auth.requestPasswordReset(unverified.email, "en");
    await auth.requestPasswordReset(disabled.email, "en");
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: { in: [unverified.id, disabled.id] } },
      }),
    ).toBe(0);
  });

  it("invalidates the previous code when the cooldown has passed", async () => {
    const account = await user();
    const oldCode = await issue(account.email);
    await prisma.passwordResetToken.update({
      where: { userId: account.id },
      data: { expiresAt: new Date(Date.now() + 13 * 60_000) },
    });
    const newCode = await issue(account.email);
    await expect(
      auth.confirmPasswordReset({
        email: account.email,
        code: oldCode,
        newPassword: "new-password",
      }),
    ).rejects.toThrow("Invalid or expired");
    await auth.confirmPasswordReset({
      email: account.email,
      code: newCode,
      newPassword: "new-password",
    });
  });

  it("only allows one concurrent confirmation", async () => {
    const account = await user();
    const code = await issue(account.email);
    const dto = { email: account.email, code, newPassword: "new-password" };
    const results = await Promise.allSettled([
      auth.confirmPasswordReset(dto),
      auth.confirmPasswordReset(dto),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});
