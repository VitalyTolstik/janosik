import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type { Board } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "concurrency-owner@example.com";
const PASSWORD = "correct horse battery";

/** A 1×1 PNG — enough to exercise the multipart attachment path. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAABDQAAAP+m6wAAAAtJREFUGFdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=",
  "base64",
);

const CARDS = 12;

/**
 * Many writers on one board (§7.4, TASK-56).
 *
 * Before `BoardWriteService` existed, reducer commands took the board row
 * (`SELECT … FOR UPDATE`) while comments/attachments walked Card → Activity
 * (whose FKs lock the board row) — opposite orders, so a burst deadlocked
 * (`40P01`) and answered 500. Now every board writer goes through the same
 * per-board lock first, so a mixed burst must complete cleanly and leave a
 * consistent board.
 */
describe("Board writes under concurrency (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let boardId: string;
  let todoId: string;
  let doingId: string;
  let cardIds: string[];

  beforeAll(async () => {
    // This suite fires hundreds of requests at once; throttling is not the
    // subject here (auth-rate-limit covers it). Patch the guard class — an
    // enhancer cannot be swapped via overrideProvider.
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    token = await register(EMAIL, "Owner");

    const board = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title: "Concurrency" })
      .expect(201);
    boardId = board.body.id;

    todoId = "col-todo";
    doingId = "col-doing";
    await apply({ type: "ADD_COLUMN", newColumnId: todoId, title: "Todo" });
    await apply({ type: "ADD_COLUMN", newColumnId: doingId, title: "Doing" });

    cardIds = [];
    for (let i = 0; i < CARDS; i++) {
      const cardId = `card-${i}`;
      cardIds.push(cardId);
      await apply({
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: todoId,
        title: `Card ${i}`,
      });
    }
  }, 60_000);

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  function command(action: Record<string, unknown>) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth())
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
  }

  async function apply(action: Record<string, unknown>): Promise<void> {
    await command(action).expect(200);
  }

  async function aggregate(): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .expect(200);
    return res.body as Board;
  }

  it("completes a mixed burst without deadlocks and keeps the board consistent", async () => {
    const moves = cardIds.map((cardId) =>
      command({
        type: "MOVE_CARD",
        cardId,
        fromColumnId: todoId,
        fromIndex: 0,
        toColumnId: doingId,
        toIndex: 0,
      }).expect(200),
    );
    const edits = cardIds.map((cardId) =>
      command({
        type: "UPDATE_CARD",
        cardId,
        description: `edited ${cardId}`,
      }).expect(200),
    );
    const comments = cardIds.map((cardId) =>
      server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth())
        .send({ text: `note on ${cardId}` })
        .expect(201),
    );
    // Phase 1 — the historical deadlock pair: reducer commands (which took
    // the board row) and comments (which took Card → Activity, locking the
    // board row through the foreign keys) in opposite orders.
    await Promise.all([...moves, ...edits, ...comments]);
    // Phase 2 — attachment writes, themselves a Board → Card → Activity
    // path, fired together.
    await Promise.all(
      cardIds
        .slice(0, 5)
        .map((cardId) =>
          server()
            .post(`/api/v1/cards/${cardId}/attachments`)
            .set(auth())
            .attach("file", PNG, "shot.png")
            .expect(201),
        ),
    );

    const board = await aggregate();
    const doing = board.columns.find((column) => column.id === doingId);
    expect(doing?.cardIds).toHaveLength(CARDS);
    expect(
      board.columns.find((column) => column.id === todoId)?.cardIds,
    ).toEqual([]);
    for (const cardId of cardIds) {
      expect(board.cards[cardId].description).toBe(`edited ${cardId}`);
    }
    for (const cardId of cardIds.slice(0, 5)) {
      expect(board.cards[cardId].attachmentCount).toBe(1);
    }

    // Every comment landed exactly once (a lost write would leave a gap).
    const totals = await Promise.all(
      cardIds.map((cardId) =>
        server()
          .get(`/api/v1/cards/${cardId}/comments`)
          .set(auth())
          .expect(200)
          .then((res) => res.body.items.length),
      ),
    );
    expect(totals.every((n) => n === 1)).toBe(true);
  }, 60_000);

  it("keeps one strict board sequence under a command flood", async () => {
    // 40 independent renames fired at once: the `seq` column must stay a
    // gap-free, unique monotonic series (serialized per board).
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        command({
          type: "UPDATE_CARD",
          cardId: "card-0",
          title: `flood ${i}`,
        }).expect(200),
      ),
    );
    const seqs = results
      .map((res) => res.body.seq as number)
      .sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  }, 60_000);
});

async function wipe(prisma: PrismaService): Promise<void> {
  await prisma.command.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklist.deleteMany();
  await prisma.cardLink.deleteMany();
  await prisma.cardLabel.deleteMany();
  await prisma.card.deleteMany();
  await prisma.label.deleteMany();
  await prisma.column.deleteMany();
  await prisma.boardMember.deleteMany();
  await prisma.boardShare.deleteMany();
  await prisma.board.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.emailVerificationCode.deleteMany();
  await prisma.emailChangeCode.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}
