import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { wipeAll } from "./support/wipe";

const PASSWORD = "correct horse battery";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * M3 (TASK-180.3): an abandoned registration must not reserve its unique
 * address forever. The maintenance sweep releases only accounts that never
 * verified, never became accepted members and never wrote anything; a real
 * account with content is left untouched.
 */
describe("Unverified registration cleanup (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let maintenance: MaintenanceService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    maintenance = app.get(MaintenanceService);
    await wipeAll(prisma);
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  async function createUser(
    email: string,
    options: {
      verified?: boolean;
      createdAt?: Date;
    } = {},
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argonHash(PASSWORD, { type: argon2id }),
        emailVerifiedAt: options.verified ? new Date() : null,
        createdAt: options.createdAt,
      },
    });
    return user.id;
  }

  it("deletes an abandoned unverified row and releases its address", async () => {
    const old = new Date(Date.now() - 20 * DAY_MS);
    await createUser("abandoned@example.com", { createdAt: old });

    const result = await maintenance.run("sweep-unverified-users");
    expect(result).toEqual([{ job: "sweep-unverified-users", removed: 1 }]);
    expect(
      await prisma.user.findUnique({
        where: { email: "abandoned@example.com" },
      }),
    ).toBeNull();

    // The address is genuinely free: a normal registration succeeds again.
    await server()
      .post("/api/v1/auth/register")
      .send({ email: "abandoned@example.com", password: PASSWORD })
      .expect(201);
  });

  it("keeps a verified account even when it is old", async () => {
    const old = new Date(Date.now() - 40 * DAY_MS);
    await createUser("verified@example.com", {
      verified: true,
      createdAt: old,
    });

    const result = await maintenance.run("sweep-unverified-users");
    expect(result[0]?.removed).toBe(0);
    expect(
      await prisma.user.findUnique({
        where: { email: "verified@example.com" },
      }),
    ).not.toBeNull();
  });

  it("keeps an unverified account that already accepted a board membership", async () => {
    const old = new Date(Date.now() - 20 * DAY_MS);
    const userId = await createUser("member@example.com", { createdAt: old });
    const board = await prisma.board.create({
      data: { title: "Keep this membership" },
    });
    await prisma.boardMember.create({
      data: {
        boardId: board.id,
        userId,
        role: "MEMBER",
        acceptedAt: new Date(),
      },
    });

    const result = await maintenance.run("sweep-unverified-users");
    expect(result[0]?.removed).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { id: userId } }),
    ).not.toBeNull();
  });

  it("does not touch a fresh unverified registration", async () => {
    await createUser("fresh@example.com");
    const result = await maintenance.run("sweep-unverified-users");
    expect(result[0]?.removed).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { email: "fresh@example.com" } }),
    ).not.toBeNull();
  });
});
