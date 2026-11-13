import type { User } from "@prisma/client";
import { UnauthorizedException } from "@nestjs/common";
import { securityStamp } from "./security-stamp";
import { JwtStrategy } from "./jwt.strategy";
import type { PrismaService } from "@/common/prisma/prisma.service";

const user = {
  id: "u1",
  email: "person@example.com",
  passwordHash: "old-hash",
  emailVerifiedAt: null,
  disabledAt: null,
  displayName: null,
  avatarColor: null,
  avatarPath: null,
  notifyDigest: true,
  notifyAttention: true,
  locale: null,
  createdAt: new Date(),
} satisfies User;

describe("credential security stamp", () => {
  it("changes after credential, email and verification changes", () => {
    const stamp = securityStamp(user);
    expect(securityStamp({ ...user, passwordHash: "new-hash" })).not.toBe(
      stamp,
    );
    expect(securityStamp({ ...user, email: "new@example.com" })).not.toBe(
      stamp,
    );
    expect(securityStamp({ ...user, emailVerifiedAt: new Date() })).not.toBe(
      stamp,
    );
  });

  it("rejects an old access token after a password reset", async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...user, passwordHash: "new-hash" }),
      },
    };
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({ sub: user.id, stamp: securityStamp(user) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
