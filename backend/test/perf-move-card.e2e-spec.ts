import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "@/app.module";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

/** Unique per run: other specs wipe the test DB, this one never collides. */
const RUN = randomUUID().slice(0, 8);
const EMAIL = `perf-move-card-${RUN}@example.com`;
const PASSWORD = "correct horse battery";
const CARDS_PER_COLUMN = 100;
const MOVES = 60;

/** A PrismaService stand-in that counts every SQL statement it sends. */
class CountingPrisma extends PrismaClient<Prisma.PrismaClientOptions, "query"> {
  queries = 0;

  constructor() {
    super({
      datasources: { db: { url: env.DATABASE_URL } },
      log: [{ emit: "event", level: "query" }],
    });
    this.$on("query", () => {
      this.queries += 1;
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  logError(): void {}
}

/**
 * B-7 measurement: the cost of one `MOVE_CARD` between two columns of
 * ~100 cards each. Both columns' positions are rewritten by the command, so
 * this is the worst everyday case of `writeCardPositions`. Prints latency
 * and SQL statements per command, and guards the statement count so the
 * per-card UPDATE loop cannot silently come back.
 */
describe("MOVE_CARD cost on a 100-card column (e2e, B-7)", () => {
  let app: INestApplication;
  let prisma: CountingPrisma;
  let token: string;
  let boardId: string;
  const todo = `perf-col-todo-${RUN}`;
  const doing = `perf-col-doing-${RUN}`;
  const todoCards: string[] = [];
  const doingCards: string[] = [];

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function command(action: Record<string, unknown>): Promise<void> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth())
      .send({ commandId: randomUUID(), action: { at: Date.now(), ...action } });
    if (res.status !== 200) {
      throw new Error(`command ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  beforeAll(async () => {
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    prisma = new CountingPrisma();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    token = registered.body.accessToken as string;
    const board = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title: "Perf board" })
      .expect(201);
    boardId = board.body.id as string;
    await command({ type: "ADD_COLUMN", newColumnId: todo, title: "Todo" });
    await command({ type: "ADD_COLUMN", newColumnId: doing, title: "Doing" });
    for (let i = 0; i < CARDS_PER_COLUMN; i += 1) {
      const a = `perf-todo-${RUN}-${i}`;
      const b = `perf-doing-${RUN}-${i}`;
      await command({
        type: "ADD_CARD",
        newCardId: a,
        columnId: todo,
        title: a,
      });
      await command({
        type: "ADD_CARD",
        newCardId: b,
        columnId: doing,
        title: b,
      });
      todoCards.push(a);
      doingCards.push(b);
    }
  }, 120_000);

  afterAll(async () => {
    // Leave nothing behind: other specs wipe users but not boards.
    if (boardId) {
      await prisma.activity.deleteMany({ where: { boardId } });
      await prisma.command.deleteMany({ where: { boardId } });
      await prisma.card.deleteMany({ where: { column: { boardId } } });
      await prisma.column.deleteMany({ where: { boardId } });
      await prisma.boardMember.deleteMany({ where: { boardId } });
      await prisma.board.deleteMany({ where: { id: boardId } });
    }
    await prisma.refreshToken.deleteMany({ where: { user: { email: EMAIL } } });
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  it("moves cards between two full columns", async () => {
    const latencies: number[] = [];
    const statements: number[] = [];
    for (let i = 0; i < MOVES; i += 1) {
      // Alternate directions so both columns stay ~100 cards deep; always
      // move the top card to the top of the other column.
      const [from, to, fromList, toList] =
        i % 2 === 0
          ? [todo, doing, todoCards, doingCards]
          : [doing, todo, doingCards, todoCards];
      const cardId = fromList.shift() as string;
      toList.unshift(cardId);
      const before = prisma.queries;
      const started = process.hrtime.bigint();
      await command({
        type: "MOVE_CARD",
        cardId,
        fromColumnId: from,
        fromIndex: 0,
        toColumnId: to,
        toIndex: 0,
      });
      latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
      statements.push(prisma.queries - before);
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
    const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const perCommand = statements.reduce((s, v) => s + v, 0) / MOVES;
    console.log(
      `[perf] MOVE_CARD x${MOVES} (${CARDS_PER_COLUMN}+${CARDS_PER_COLUMN} cards): ` +
        `mean ${mean.toFixed(1)} ms, p50 ${pick(0.5).toFixed(1)} ms, ` +
        `p95 ${pick(0.95).toFixed(1)} ms; SQL statements/command ${perCommand.toFixed(1)}`,
    );

    // Measured (B-7): 231 statements/command with the per-card UPDATE loop,
    // 33 with the batched `UPDATE … FROM (VALUES …)`. Guard well above the
    // batched figure, far below the loop.
    expect(perCommand).toBeLessThan(60);

    // The board must still reflect the moves exactly.
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .expect(200);
    const columns = res.body.columns as Array<{
      id: string;
      cardIds: string[];
    }>;
    expect(columns.find((c) => c.id === todo)?.cardIds).toEqual(todoCards);
    expect(columns.find((c) => c.id === doing)?.cardIds).toEqual(doingCards);
  }, 120_000);
});
