import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const EMAIL = "command-global-ids@example.com";
const PASSWORD = "correct horse battery";

/** The event loop clock must stay inside the server's command skew window. */
let clock = Date.now() - 120_000;
const nextAt = () => (clock += 100);

/**
 * TASK-200.11 — the partitioned log must keep the old `Command_pkey`
 * guarantee: a client commandId is global. The registry trigger rejects a
 * concurrent use on another board with 409 `id_conflict`, never a second
 * command, a leaked detail row or a cross-board delete.
 */
describe("Command log global ids (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let boardA: string;
  let boardB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);
    token = await register();
    boardA = await createBoard("Global ids A");
    boardB = await createBoard("Global ids B");
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  function register(): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "Global ids" })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  function action(columnId: string, title: string) {
    return {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title,
      at: nextAt(),
    };
  }

  it("rejects the same id concurrently used on two boards", async () => {
    const commandId = randomUUID();
    const actionA = action(`col-${commandId}-a`, "A");
    const actionB = action(`col-${commandId}-b`, "B");
    const [a, b] = await Promise.all([
      server()
        .post(`/api/v1/boards/${boardA}/commands`)
        .set(auth())
        .send({ commandId, action: actionA }),
      server()
        .post(`/api/v1/boards/${boardB}/commands`)
        .set(auth())
        .send({ commandId, action: actionB }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ code: "id_conflict" });

    const stored = await prisma.command.findMany({
      where: { id: commandId },
      select: { boardId: true, seq: true },
    });
    expect(stored).toHaveLength(1);
    const winnerBoard = stored[0]!.boardId;
    const winnerStatus = winnerBoard === boardA ? a : b;

    expect(await prisma.commandDetail.count({ where: { commandId } })).toBe(1);
    const key = await prisma.commandKey.findUnique({
      where: { id: commandId },
    });
    expect(key?.boardId).toBe(winnerBoard);
    // The detail read is board-scoped even if a caller only has the id.
    const loserBoard = winnerBoard === boardA ? boardB : boardA;
    expect(await readDetailForBoard(loserBoard, commandId)).toBe(0);

    // A same-board retry is still an idempotent replay.
    const retry = await server()
      .post(`/api/v1/boards/${winnerBoard}/commands`)
      .set(auth())
      .send({
        commandId,
        action: winnerBoard === boardA ? actionA : actionB,
      });
    expect(retry.status).toBe(200);
    expect(retry.body.seq).toBe(Number(stored[0]!.seq));

    // Deleting the winner releases the key and only its own detail.
    await prisma.command.deleteMany({ where: { id: commandId } });
    expect(await prisma.commandKey.count({ where: { id: commandId } })).toBe(0);
    expect(await prisma.commandDetail.count({ where: { commandId } })).toBe(0);
    expect(winnerStatus.status).toBe(200);
  });

  it("rejects the same commandId twice in one batch before writing anything", async () => {
    const commandId = randomUUID();
    const res = await server()
      .post(`/api/v1/boards/${boardA}/commands/batch`)
      .set(auth())
      .send({
        commands: [
          {
            commandId,
            action: action(`batch-${commandId}-1`, "First"),
          },
          {
            commandId,
            action: action(`batch-${commandId}-2`, "Second"),
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "idempotency_conflict" });
    expect(await prisma.command.count({ where: { id: commandId } })).toBe(0);
    expect(await prisma.commandDetail.count({ where: { commandId } })).toBe(0);
  });

  async function readDetailForBoard(
    boardId: string,
    commandId: string,
  ): Promise<number> {
    return prisma.commandDetail.count({
      where: { commandId, commandKey: { boardId } },
    });
  }
});
