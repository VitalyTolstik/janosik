import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import * as boardAggregate from "@/boards/board-aggregate";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "aggregate-load@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-200.4: a PAT command path used to load the full board aggregate up to
 * three times (pre-lock classification, in-transaction plan limits, running
 * state). This suite pins the new contract with a module spy instead of a
 * load generator: one snapshot per fresh command/batch, none for a replay,
 * and none before the lock for a plan that classification can judge without
 * board contents.
 */
describe("Command aggregate loads (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let pat: string;
  let boardId: string;
  let columnId: string;
  let cardId: string;

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
      .send({ title: "Aggregate loads" })
      .expect(201)
      .then((res) => res.body.id as string);

    columnId = randomUUID();
    await command(session, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    }).expect(200);

    cardId = randomUUID();
    await command(session, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Base",
    }).expect(200);

    pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name: "aggregate-writer", boardId })
      .expect(201)
      .then((res) => res.body.token as string);
  });

  afterAll(async () => {
    load.mockRestore();
    await wipeAll(prisma);
    await app.close();
  });

  beforeEach(() => load.mockClear());

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tick = () => Date.now();

  function command(
    token: string,
    body: Record<string, unknown>,
    extra: { commandId?: string; ifMatch?: number } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: extra.commandId ?? randomUUID(),
        ...(extra.ifMatch !== undefined ? { ifMatch: extra.ifMatch } : {}),
        action: { boardId, at: tick(), ...body },
      });
  }

  it("loads the aggregate once for a fresh PAT command", async () => {
    const res = await command(pat, {
      type: "UPDATE_CARD",
      cardId,
      description: "one snapshot",
    }).expect(200);

    expect(load).toHaveBeenCalledTimes(1);
    expect(res.body.seq).toBeGreaterThan(0);
  });

  it("does not load the aggregate to replay the same command", async () => {
    const commandId = randomUUID();
    const first = await command(
      pat,
      { type: "UPDATE_CARD", cardId, description: "replay me" },
      { commandId },
    ).expect(200);
    const before = await prisma.command.count({ where: { boardId } });

    load.mockClear();
    const replay = await command(
      pat,
      { type: "UPDATE_CARD", cardId, description: "replay me" },
      { commandId },
    ).expect(200);

    expect(load).not.toHaveBeenCalled();
    expect(replay.body.seq).toBe(first.body.seq);
    expect(replay.body.versions).toEqual(first.body.versions);
    expect(await prisma.command.count({ where: { boardId } })).toBe(before);
  });

  it("keeps the stale-ifMatch conflict and writes nothing", async () => {
    const before = await prisma.command.count({ where: { boardId } });
    const stale = await command(
      pat,
      { type: "UPDATE_CARD", cardId, description: "stale" },
      { ifMatch: 0 },
    ).expect(409);

    expect(stale.body).toMatchObject({ conflict: "version" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await prisma.command.count({ where: { boardId } })).toBe(before);
    expect(
      (await prisma.card.findUniqueOrThrow({ where: { id: cardId } })).version,
    ).toBeGreaterThan(0);
  });

  it("loads once for a whole PAT batch", async () => {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(pat))
      .send({
        commands: ["Batch 1", "Batch 2", "Batch 3"].map((description) => ({
          commandId: randomUUID(),
          action: {
            boardId,
            at: tick(),
            type: "UPDATE_CARD",
            cardId,
            description,
          },
        })),
      })
      .expect(200);

    expect(res.body.results).toHaveLength(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("skips the pre-lock snapshot when classification needs no board content", async () => {
    const before = await prisma.command.count({ where: { boardId } });
    const refused = await command(pat, {
      type: "DELETE_CARD",
      cardId,
    }).expect(409);

    expect(refused.body.code).toBe("approval_required");
    // The destructive gate is decided from the action type + policy; the
    // approval seam reuses the content-free classification shell.
    expect(load).not.toHaveBeenCalled();
    expect(await prisma.command.count({ where: { boardId } })).toBe(before);
    expect(
      await prisma.card.findUnique({ where: { id: cardId } }),
    ).not.toBeNull();
  });

  it("never loads a third snapshot when the policy requires one pre-lock", async () => {
    // Create plans count cards against the current board, so the pre-lock
    // classification/limit pass and the transaction each need a snapshot —
    // but there must never be a third one (plan limits and running state
    // share the transaction's load).
    const res = await command(pat, {
      type: "ADD_CARD",
      newCardId: randomUUID(),
      columnId,
      title: "Created by an agent",
    }).expect(200);

    expect(res.body.seq).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
