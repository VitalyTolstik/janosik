import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DEFAULT_BOARD_AGENT_POLICY } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import * as boardAggregate from "@/boards/board-aggregate";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "entity-cas@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-200.7: targeted card intents and per-entity CAS.
 *
 * - Two agents editing/moving different cards never conflict even when they
 *   share a board and a column.
 * - The same card still conflicts, and the `409` carries the current
 *   `card:`/`column:` versions so the retry can stay targeted.
 * - The intent endpoint does not load the full board aggregate; WIP, workflow
 *   and command idempotency remain on the same path.
 */
describe("Card entity CAS and targeted intents (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let pat: string;
  let boardId: string;
  let todoId: string;
  let doingId: string;

  const load = jest.spyOn(boardAggregate, "loadBoardAggregate");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    session = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201)
      .then((res) => res.body.accessToken as string);

    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title: "Entity CAS" })
      .expect(201)
      .then((res) => res.body.id as string);

    todoId = "col-todo";
    doingId = "col-doing";
    await command(session, {
      type: "ADD_COLUMN",
      newColumnId: todoId,
      title: "Todo",
    }).expect(200);
    await command(session, {
      type: "ADD_COLUMN",
      newColumnId: doingId,
      title: "Doing",
    }).expect(200);

    pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name: "entity-cas", boardId, scopePreset: "admin" })
      .expect(201)
      .then((res) => res.body.token as string);
  }, 60_000);

  afterAll(async () => {
    load.mockRestore();
    await wipeAll(prisma);
    await app.close();
  });

  beforeEach(() => load.mockClear());

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function command(
    token: string,
    action: Record<string, unknown>,
    extra: {
      commandId?: string;
      ifMatchVersions?: Record<string, number>;
    } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: extra.commandId ?? randomUUID(),
        action: { boardId, at: Date.now(), ...action },
        ...(extra.ifMatchVersions !== undefined
          ? { ifMatchVersions: extra.ifMatchVersions }
          : {}),
      });
  }

  async function card(title: string): Promise<string> {
    const cardId = randomUUID();
    await command(pat, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: todoId,
      title,
    }).expect(200);
    return cardId;
  }

  async function context(cardId: string) {
    return server()
      .get(`/api/v1/boards/${boardId}/cards/${cardId}/context`)
      .set(auth(pat))
      .expect(200)
      .then(
        (res) =>
          res.body as {
            card: { id: string; description?: string };
            columnId: string;
            cardIndex: number;
            versions: Record<string, number>;
          },
      );
  }

  function patch(
    cardId: string,
    body: Record<string, unknown>,
    commandId = randomUUID(),
  ) {
    return server()
      .patch(`/api/v1/boards/${boardId}/cards/${cardId}`)
      .set(auth(pat))
      .send({ commandId, ...body });
  }

  function move(
    cardId: string,
    body: Record<string, unknown>,
    commandId = randomUUID(),
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/cards/${cardId}/move`)
      .set(auth(pat))
      .send({ commandId, ...body });
  }

  it("lets different cards be updated concurrently with per-card CAS", async () => {
    const a = await card("A");
    const b = await card("B");
    const before = await Promise.all([context(a), context(b)]);

    load.mockClear();
    const results = await Promise.all([
      patch(a, {
        description: "A edited",
        ifMatchVersions: { [`card:${a}`]: before[0]!.versions[`card:${a}`]! },
      }),
      patch(b, {
        description: "B edited",
        ifMatchVersions: { [`card:${b}`]: before[1]!.versions[`card:${b}`]! },
      }),
    ]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(load).not.toHaveBeenCalled();
    expect((await context(a)).card.description).toBe("A edited");
    expect((await context(b)).card.description).toBe("B edited");
  });

  it("keeps a same-card update conflict and returns the current versions", async () => {
    const cardId = await card("Same card update");
    const version = (await context(cardId)).versions[`card:${cardId}`]!;

    const [first, second] = await Promise.all([
      patch(cardId, {
        description: "first",
        ifMatchVersions: { [`card:${cardId}`]: version },
      }),
      patch(cardId, {
        description: "second",
        ifMatchVersions: { [`card:${cardId}`]: version },
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body).toMatchObject({
      conflict: "version",
      versions: { [`card:${cardId}`]: expect.any(Number) },
    });

    // The conflict body is enough to retry without a board read.
    const fresh = conflict.body.versions[`card:${cardId}`] as number;
    await patch(cardId, {
      description: "retried",
      ifMatchVersions: { [`card:${cardId}`]: fresh },
    }).expect(200);
    expect((await context(cardId)).card.description).toBe("retried");
  });

  it("lets different cards move concurrently and targets a same-card move conflict", async () => {
    const a = await card("Move A");
    const b = await card("Move B");
    const before = await Promise.all([context(a), context(b)]);
    load.mockClear();

    const moved = await Promise.all([
      move(a, {
        toColumnId: doingId,
        ifMatchVersions: { [`card:${a}`]: before[0]!.versions[`card:${a}`]! },
      }),
      move(b, {
        toColumnId: doingId,
        ifMatchVersions: { [`card:${b}`]: before[1]!.versions[`card:${b}`]! },
      }),
    ]);
    expect(moved.map((res) => res.status)).toEqual([200, 200]);
    expect(load).not.toHaveBeenCalled();

    const same = await Promise.all([
      move(a, { toColumnId: todoId }),
      move(a, { toColumnId: todoId }),
    ]);
    expect(same.map((res) => res.status).sort()).toEqual([200, 409]);
    const conflict = same.find((res) => res.status === 409)!;
    expect(conflict.body).toMatchObject({
      conflict: "version",
      versions: { [`card:${a}`]: expect.any(Number) },
    });
  });

  it("replays a targeted patch idempotently", async () => {
    const cardId = await card("Replay");
    const commandId = randomUUID();
    const first = await patch(
      cardId,
      { title: "Replay one" },
      commandId,
    ).expect(200);
    const before = await prisma.command.count({ where: { boardId } });
    const replay = await patch(
      cardId,
      { title: "Replay one" },
      commandId,
    ).expect(200);

    expect(replay.body.seq).toBe(first.body.seq);
    expect(replay.body.versions).toEqual(first.body.versions);
    expect(await prisma.command.count({ where: { boardId } })).toBe(before);
  });

  it("enforces WIP on the targeted move path", async () => {
    await command(pat, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: doingId,
      wipLimit: 1,
    }).expect(200);
    const full = await card("WIP full");
    await move(full, { toColumnId: doingId }).expect(200);

    const extra = await card("WIP extra");
    const conflict = await move(extra, { toColumnId: doingId }).expect(409);
    expect(conflict.body).toMatchObject({ conflict: "wip", columnId: doingId });
  });

  it("enforces the workflow on the targeted move path", async () => {
    await command(pat, {
      type: "SET_BOARD_WORKFLOW",
      workflow: {
        schemaVersion: 1,
        enabled: true,
        doneColumnIds: [doingId],
        transitions: [
          {
            id: randomUUID(),
            fromColumnId: todoId,
            toColumnId: doingId,
            allowedRoles: ["ADMIN", "MEMBER"],
          },
        ],
      },
    }).expect(200);
    const blocked = await card("Workflow blocked");
    await move(blocked, { toColumnId: doingId }).expect(200);
    const conflict = await move(blocked, { toColumnId: todoId }).expect(409);
    expect(conflict.body).toMatchObject({
      conflict: "workflow",
      workflow: { code: "transition_not_allowed" },
    });
  });

  it("keeps the move-to-done approval gate on the targeted path", async () => {
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentPolicy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          requireApprovalFor: ["move_to_done"],
        } as never,
      },
    });
    const cardId = await card("Needs approval");
    const refused = await move(cardId, { toColumnId: doingId }).expect(409);
    expect(refused.body).toMatchObject({
      code: "approval_required",
      approvalId: expect.any(String),
    });
    expect(
      await prisma.approvalRequest.count({
        where: { boardId, cardId },
      }),
    ).toBe(1);
    await prisma.board.update({
      where: { id: boardId },
      data: { agentPolicy: null as never },
    });
  });

  it("claims and releases through the intent without a board read", async () => {
    const cardId = await card("Claim me");
    load.mockClear();
    const claimed = await server()
      .post(`/api/v1/boards/${boardId}/cards/${cardId}/claim`)
      .set(auth(pat))
      .send({ leaseMs: 60_000 })
      .expect(200);
    expect(claimed.body.claimedBy).toEqual(expect.any(String));
    expect(claimed.body.leaseUntil).toBeGreaterThan(Date.now());
    expect(load).not.toHaveBeenCalled();

    const released = await server()
      .post(`/api/v1/boards/${boardId}/cards/${cardId}/claim`)
      .set(auth(pat))
      .send({ release: true })
      .expect(200);
    expect(released.body.claimedBy).toBeNull();
    expect(released.body.leaseUntil).toBeNull();
  });
});
