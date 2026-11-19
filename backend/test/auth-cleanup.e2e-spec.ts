import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { AccountDeletionService } from "@/users/account-deletion.service";
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
  let accountDeletion: AccountDeletionService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    maintenance = app.get(MaintenanceService);
    accountDeletion = app.get(AccountDeletionService);
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

  async function boardCard(
    label: string,
  ): Promise<{ boardId: string; cardId: string }> {
    const board = await prisma.board.create({ data: { title: label } });
    const column = await prisma.column.create({
      data: {
        id: `${label}-col`,
        boardId: board.id,
        title: "Todo",
        position: 0,
      },
    });
    const card = await prisma.card.create({
      data: {
        id: `${label}-card`,
        columnId: column.id,
        title: "Card",
        position: 0,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
    });
    return { boardId: board.id, cardId: card.id };
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

  it("keeps content-bearing accounts (comment, command, attachment)", async () => {
    const old = new Date(Date.now() - 20 * DAY_MS);
    const commenter = await createUser("commenter@example.com", {
      createdAt: old,
    });
    const commander = await createUser("commander@example.com", {
      createdAt: old,
    });
    const uploader = await createUser("uploader@example.com", {
      createdAt: old,
    });
    const { boardId, cardId } = await boardCard("cleanup-content");
    await prisma.comment.create({
      data: { cardId, authorId: commenter, text: "keep me" },
    });
    await prisma.command.create({
      data: {
        id: "cleanup-command",
        boardId,
        actorId: commander,
        type: "ADD_CARD",
        payload: { type: "ADD_CARD" },
        result: { seq: 1 },
        touches: [],
      },
    });
    await prisma.attachment.create({
      data: {
        cardId,
        boardId,
        fileName: "keep.txt",
        storedName: "cleanup-keep.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
        uploadedById: uploader,
      },
    });

    const result = await maintenance.run("sweep-unverified-users");
    expect(result[0]?.removed).toBe(0);
    for (const id of [commenter, commander, uploader]) {
      expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
    }
  });

  it("re-checks eligibility after the prefilter when a membership lands", async () => {
    const old = new Date(Date.now() - 20 * DAY_MS);
    const userId = await createUser("raced@example.com", { createdAt: old });
    const board = await prisma.board.create({ data: { title: "Race board" } });

    const original = accountDeletion.deleteAccount.bind(accountDeletion);
    const spy = jest
      .spyOn(accountDeletion, "deleteAccount")
      .mockImplementation(
        async (target, actor, dueCutoff, unverifiedBefore) => {
          // Simulates a writer that commits after the sweep's outer prefilter
          // but before deleteAccount locks the user row.
          await prisma.boardMember.create({
            data: {
              boardId: board.id,
              userId: target,
              role: "MEMBER",
              acceptedAt: new Date(),
            },
          });
          return original(target, actor, dueCutoff, unverifiedBefore);
        },
      );
    try {
      const result = await maintenance.run("sweep-unverified-users");
      expect(result[0]?.removed).toBe(0);
      expect(
        await prisma.user.findUnique({ where: { id: userId } }),
      ).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
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
