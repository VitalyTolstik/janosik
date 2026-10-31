import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction, CommandResponse } from "@janosik/shared";
import { COMMAND_BATCH_MAX, boardReducer } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";

const ADMIN_EMAIL = "batch-admin@example.com";
const VIEWER_EMAIL = "batch-viewer@example.com";
const PASSWORD = "correct horse battery";

/**
 * Batched command transport (TASK-160): `POST /boards/:id/commands/batch`
 * applies several commands in one transaction under the board's single write
 * lock. The suite locks the two properties that make it safe — the batch is
 * equivalent to applying the commands one by one (the same reducer contract),
 * and it is atomic (any failure rolls the whole batch back).
 */
describe("Commands batch API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let viewerToken: string;

  beforeAll(async () => {
    // This suite POSTs many commands by design; the global quota is another
    // suite's subject, so it is lifted on the guard class (see
    // commands-columns-cards.e2e-spec.ts).
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    // Bind the server before any request (supertest closes a lazily started
    // server after each request, which races concurrent sockets).
    await app.listen(0);
    prisma = app.get(PrismaService);
    await wipe(prisma);

    adminToken = await register(ADMIN_EMAIL, "Admin");
    adminId = await whoami(adminToken);
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Near the server clock: commands outside its ±5 min skew window get their
  // `at` replaced (B-5), which would break the reducer contract.
  let clock = Date.now() - 120_000;
  const tick = () => (clock += 100);
  const scoped = (
    boardId: string,
    body: Record<string, unknown>,
  ): BoardAction =>
    ({ boardId, at: tick(), ...body }) as unknown as BoardAction;

  /** One batch member: a fresh `commandId` plus an optional precondition. */
  const item = (
    action: BoardAction,
    extra: { commandId?: string; ifMatch?: number } = {},
  ) => ({ commandId: extra.commandId ?? randomUUID(), action, ...extra });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function whoami(token: string): Promise<string> {
    const res = await server()
      .get("/api/v1/auth/me")
      .set(auth(token))
      .expect(200);
    return res.body.id as string;
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function addColumn(
    boardId: string,
    columnId: string,
    title: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: columnId,
          title,
        }),
      })
      .expect(200);
  }

  function postBatch(boardId: string, commands: unknown[], token = adminToken) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(token))
      .send({ commands });
  }

  async function getAggregate(boardId: string): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);
    return res.body as Board;
  }

  async function boardSeq(boardId: string): Promise<number> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);
    return Number(res.headers["x-board-seq"]);
  }

  it("applies a create-plus-fields batch in order and equals the reducer", async () => {
    const boardId = await createBoard("Batch board");
    const columnId = randomUUID();
    await addColumn(boardId, columnId, "Todo");
    const cardId = randomUUID();

    const actions: BoardAction[] = [
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Batched card",
      }),
      scoped(boardId, {
        type: "UPDATE_CARD",
        cardId,
        description: "hello",
      }),
      scoped(boardId, { type: "SET_CARD_PRIORITY", cardId, priority: "high" }),
      scoped(boardId, { type: "SET_CARD_ASSIGN", cardId, assigneeId: adminId }),
      scoped(boardId, {
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate: clock + 86_400_000,
      }),
    ];

    const before = await getAggregate(boardId);
    const commandsBefore = await prisma.command.count({ where: { boardId } });
    let expected = before;
    for (const action of actions) {
      expected = boardReducer([expected], action, { withActivity: false })[0];
    }

    const res = await postBatch(
      boardId,
      actions.map((action) => item(action)),
    ).expect(200);
    const results = res.body.results as CommandResponse[];
    expect(results).toHaveLength(actions.length);
    // The batch's commands are ordered: each `seq` is higher than the last.
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i]!.seq).toBeGreaterThan(results[i - 1]!.seq);
    }

    const after = await getAggregate(boardId);
    // The batch must be indistinguishable from applying the same commands one
    // by one — the same reducer contract the single endpoint honours.
    expect(stripAttribution(after)).toEqual(stripAttribution(expected));
    expect(after.cards[cardId]!.priority).toBe("high");
    expect(after.cards[cardId]!.description).toBe("hello");
    expect(after.cards[cardId]!.assigneeId).toBe(adminId);

    // One `Command` row per batch member — the log, undo history and
    // `?since=` delta stay per-command even though the writes share one lock.
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore + actions.length,
    );
  });

  it("rolls the whole batch back when one command is rejected", async () => {
    const boardId = await createBoard("Rollback board");
    const columnId = randomUUID();
    await addColumn(boardId, columnId, "Todo");
    const cardId = randomUUID();
    const stranger = randomUUID();

    const commandsBefore = await prisma.command.count({ where: { boardId } });

    await postBatch(boardId, [
      item(
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Doomed",
        }),
      ),
      // The assignee is not a member: this command is a 400, and the batch
      // must not have created the card.
      item(
        scoped(boardId, {
          type: "SET_CARD_ASSIGN",
          cardId,
          assigneeId: stranger,
        }),
      ),
    ]).expect(400);

    const after = await getAggregate(boardId);
    expect(after.cards[cardId]).toBeUndefined();
    // The rejected batch wrote nothing — not even its first command.
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore,
    );
  });

  it("replays a batch idempotently: same seqs, no new commands", async () => {
    const boardId = await createBoard("Idempotent board");
    const columnId = randomUUID();
    await addColumn(boardId, columnId, "Todo");
    const cardId = randomUUID();

    const commands = [
      item(
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Once",
        }),
        { commandId: cardId },
      ),
      item(scoped(boardId, { type: "UPDATE_CARD", cardId, description: "x" })),
    ];

    const first = (await postBatch(boardId, commands).expect(200)).body
      .results as CommandResponse[];
    const countAfterFirst = await prisma.command.count({ where: { boardId } });

    const second = (await postBatch(boardId, commands).expect(200)).body
      .results as CommandResponse[];
    expect(second.map((r) => r.seq)).toEqual(first.map((r) => r.seq));
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      countAfterFirst,
    );
  });

  it("honours ifMatch on the first command and refuses a stale version", async () => {
    const boardId = await createBoard("IfMatch board");
    const columnId = randomUUID();
    await addColumn(boardId, columnId, "Todo");
    const seq = await boardSeq(boardId);
    const cardId = randomUUID();

    // A matching version applies the whole batch.
    await postBatch(boardId, [
      item(
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Fresh",
        }),
        { ifMatch: seq },
      ),
    ]).expect(200);

    // A stale version refuses it (the board moved on by one command).
    const staleCardId = randomUUID();
    await postBatch(boardId, [
      item(
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: staleCardId,
          columnId,
          title: "Stale",
        }),
        { ifMatch: seq },
      ),
    ]).expect(409);
    expect((await getAggregate(boardId)).cards[staleCardId]).toBeUndefined();
  });

  it("rejects a VIEWER, an empty batch and one over the cap", async () => {
    const boardId = await createBoard("Guard rails board");

    await postBatch(
      boardId,
      [item(scoped(boardId, { type: "RENAME_BOARD", title: "Nope" }))],
      viewerToken,
    ).expect(403);

    await postBatch(boardId, []).expect(400);

    const tooMany = Array.from({ length: COMMAND_BATCH_MAX + 1 }, () =>
      item(scoped(boardId, { type: "RENAME_BOARD", title: "Nope" })),
    );
    await postBatch(boardId, tooMany).expect(400);
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.apiToken.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
