import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { BoardAction } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { hashIdempotentRequest } from "@/common/idempotency.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { wipeAll } from "./support/wipe";

const ADMIN_EMAIL = "write-contract-admin@example.com";
const OUTSIDER_EMAIL = "write-contract-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.4 reliable write contract (ADR §8): every REST error is the same
 * machine-readable envelope, and the ADR's REST write operations replay the
 * stored response for the same `Idempotency-Key`.
 */
describe("Reliable write contract (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let outsiderToken: string;
  let adminId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    adminToken = await register(ADMIN_EMAIL, "Admin");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");
    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(adminToken))
      .expect(200);
    adminId = me.body.id as string;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    // Uploaded blobs bypass the DB wipe.
    await rm(path.join(process.cwd(), "data"), {
      recursive: true,
      force: true,
    });
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let clock = Date.now() - 120_000;
  const tick = () => (clock += 100);
  const scoped = (
    boardId: string,
    body: Record<string, unknown>,
  ): BoardAction =>
    ({ boardId, at: tick(), ...body }) as unknown as BoardAction;

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
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
    title = "Todo",
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

  async function addCard(
    boardId: string,
    columnId: string,
    cardId: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: scoped(boardId, {
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Card",
        }),
      })
      .expect(200);
  }

  async function boardWithCard(): Promise<{
    boardId: string;
    cardId: string;
  }> {
    const boardId = await createBoard("Write contract board");
    const columnId = randomUUID();
    const cardId = randomUUID();
    await addColumn(boardId, columnId);
    await addCard(boardId, columnId, cardId);
    return { boardId, cardId };
  }

  it("exposes a request id on a successful mutation", async () => {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title: "Request id board" })
      .expect(201);
    expect(res.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("normalizes validation failures without the raw Nest body", async () => {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({})
      .expect(400);
    expect(res.body).toMatchObject({
      code: "validation_failed",
      retryable: false,
      requestId: res.headers["x-request-id"],
      currentVersion: null,
      statusCode: 400,
    });
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.details.messages)).toBe(true);
    expect(res.body.error).toBeUndefined();
  });

  it("turns malformed JSON into a safe 400 envelope", async () => {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Content-Type", "application/json")
      .send('{"title": "unterminated"')
      .expect(400);
    expect(res.body).toMatchObject({
      code: "validation_failed",
      retryable: false,
      requestId: res.headers["x-request-id"],
    });
    expect(res.body.message).not.toContain("unterminated");
  });

  it("maps authentication failures to 401 unauthorized", async () => {
    const res = await server()
      .get("/api/v1/boards")
      .set(auth("not-a-token"))
      .expect(401);
    expect(res.body).toMatchObject({
      code: "unauthorized",
      retryable: false,
      requestId: res.headers["x-request-id"],
    });
  });

  it("maps a missing board and a foreign membership to stable codes", async () => {
    const missing = await server()
      .get("/api/v1/boards/does-not-exist")
      .set(auth(adminToken))
      .expect(404);
    expect(missing.body).toMatchObject({
      code: "not_found",
      retryable: false,
      requestId: missing.headers["x-request-id"],
    });

    const boardId = await createBoard("Private board");
    const foreign = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(outsiderToken))
      .expect(403);
    expect(foreign.body).toMatchObject({
      code: "forbidden",
      retryable: false,
      requestId: foreign.headers["x-request-id"],
    });
  });

  it("carries currentVersion on a command version conflict", async () => {
    const boardId = await createBoard("Conflict board");
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        ifMatch: 999,
        action: scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: randomUUID(),
          title: "Never",
        }),
      })
      .expect(409);
    expect(res.body).toMatchObject({
      code: "version_conflict",
      conflict: "version",
      currentVersion: 0,
      retryable: false,
      requestId: res.headers["x-request-id"],
    });
    expect(typeof res.body.currentVersion).toBe("number");
  });

  it("rejects an oversized body as a 413 payload_too_large", async () => {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title: "x".repeat(300 * 1024) })
      .expect(413);
    expect(res.body).toMatchObject({
      code: "payload_too_large",
      retryable: false,
      requestId: res.headers["x-request-id"],
      limit: 256 * 1024,
    });
  });

  it("marks maintenance 503 as retryable and keeps the request id", async () => {
    const ops = app.get(OpsSettingsService);
    await ops.update(
      { maintenanceMode: true, maintenanceMessage: "Maintenance window" },
      "write-contract-e2e",
    );
    try {
      const res = await server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .send({ title: "Blocked by maintenance" })
        .expect(503);
      expect(res.body).toMatchObject({
        code: "service_unavailable",
        retryable: true,
        requestId: res.headers["x-request-id"],
      });
    } finally {
      await ops.update({ maintenanceMode: false }, "write-contract-e2e");
    }
  });

  it("answers a throttled auth route with the rate_limited envelope", async () => {
    let last: request.Response | undefined;
    for (let i = 0; i < 6; i += 1) {
      last = await server()
        .post("/api/v1/auth/register")
        .send({
          email: `throttle-${i}-${Date.now()}@example.com`,
          password: PASSWORD,
          displayName: `Throttle ${i}`,
        });
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    const retryAfter = Number(last?.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(last?.body).toMatchObject({
      code: "rate_limited",
      retryable: true,
      requestId: last?.headers["x-request-id"],
      retryAfter,
    });
  });

  it("replays create_board by Idempotency-Key and refuses a different body", async () => {
    const key = `create-board-${randomUUID()}`;
    const first = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({ title: "Idempotent board" })
      .expect(201);
    const replay = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({ title: "Idempotent board" })
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({ title: "Different board" })
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: "idempotency_conflict",
      retryable: false,
      field: "Idempotency-Key",
      requestId: conflict.headers["x-request-id"],
    });
  });

  it("answers an in-progress Idempotency-Key without running the write", async () => {
    const key = `held-${randomUUID()}`;
    const title = "Held board";
    await prisma.idempotencyRecord.create({
      data: {
        scope: "create_board",
        actorKey: `user:${adminId}`,
        key,
        requestHash: hashIdempotentRequest({ title }),
        status: "in_progress",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({ title })
      .expect(409);
    expect(res.body).toMatchObject({
      code: "idempotency_in_progress",
      retryable: true,
      key,
    });
    const board = await prisma.board.findFirst({ where: { title } });
    expect(board).toBeNull();
  });

  it("keeps concurrent retries to one board and one stored response", async () => {
    const key = `concurrent-${randomUUID()}`;
    const title = "Concurrent board";
    const send = () =>
      server()
        .post("/api/v1/boards")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send({ title });
    const [a, b] = await Promise.all([send(), send()]);
    for (const res of [a, b]) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 409) {
        expect(res.body).toMatchObject({
          code: "idempotency_in_progress",
          retryable: true,
        });
      }
    }
    if (a.status === 201 && b.status === 201) {
      expect(a.body.id).toBe(b.body.id);
    }
    expect(await prisma.board.count({ where: { title } })).toBe(1);
  });

  it("does not replay one user's response to another user", async () => {
    const key = `cross-user-${randomUUID()}`;
    const first = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({ title: "Admin board" })
      .expect(201);
    const second = await server()
      .post("/api/v1/boards")
      .set(auth(outsiderToken))
      .set("Idempotency-Key", key)
      .send({ title: "Outsider board" })
      .expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.title).toBe("Outsider board");
  });

  it("replays import by Idempotency-Key and refuses a different envelope", async () => {
    const sourceId = await createBoard("Import source");
    const exported = await server()
      .get(`/api/v1/boards/${sourceId}/export`)
      .set(auth(adminToken))
      .expect(200);
    const key = `import-${randomUUID()}`;
    const send = (title: string) => {
      const envelope = structuredClone(exported.body);
      envelope.boards[0].title = title;
      return server()
        .post("/api/v1/boards/import")
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(envelope);
    };

    const first = await send("Imported board").expect(201);
    const replay = await send("Imported board").expect(201);
    expect(replay.body[0].id).toBe(first.body[0].id);

    const conflict = await send("Another import").expect(409);
    expect(conflict.body.code).toBe("idempotency_conflict");
  });

  it("replays add_comment and refuses a different comment body", async () => {
    const { cardId } = await boardWithCard();
    const key = `comment-${randomUUID()}`;
    const send = (text: string) =>
      server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send({ text, kind: "note" });

    const first = await send("first").expect(201);
    const replay = await send("first").expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await send("second").expect(409);
    expect(conflict.body).toMatchObject({
      code: "idempotency_conflict",
      retryable: false,
      key,
    });
  });

  it("replays create_share and refuses a different share body", async () => {
    const boardId = await createBoard("Share idempotency board");
    const key = `share-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const send = (body: Record<string, unknown>) =>
      server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .send(body);

    const first = await send({ mode: "live", expiresAt }).expect(201);
    const replay = await send({ mode: "live", expiresAt }).expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await send({ mode: "live" }).expect(409);
    expect(conflict.body).toMatchObject({
      code: "idempotency_conflict",
      retryable: false,
      key,
    });
    await send({ mode: "live", expiresInHours: 1 }).expect(409);
    await send({
      mode: "live",
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    }).expect(409);
    await send({ mode: "snapshot", expiresAt }).expect(409);

    const relativeKey = `share-relative-${randomUUID()}`;
    const relative = () =>
      server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(adminToken))
        .set("Idempotency-Key", relativeKey);
    const relativeFirst = await relative()
      .send({ mode: "live", expiresInHours: 1, expiresAt })
      .expect(201);
    const relativeReplay = await relative()
      .send({
        mode: "live",
        expiresInHours: 1,
        expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
      })
      .expect(201);
    expect(relativeReplay.body.id).toBe(relativeFirst.body.id);
    await relative().send({ mode: "live", expiresInHours: 2 }).expect(409);
    const unlimitedKey = `share-unlimited-${randomUUID()}`;
    const unlimited = () =>
      server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(adminToken))
        .set("Idempotency-Key", unlimitedKey);
    await unlimited().send({ mode: "live" }).expect(201);
    await unlimited().send({ mode: "live", expiresAt }).expect(409);
  });

  it("replays duplicate_card and refuses a different copy", async () => {
    const { boardId, cardId } = await boardWithCard();
    const key = `duplicate-${randomUUID()}`;
    const newCardId = randomUUID();
    const body = {
      commandId: randomUUID(),
      action: scoped(boardId, {
        type: "DUPLICATE_CARD",
        cardId,
        newCardId,
      }),
    };
    const first = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send(body)
      .expect(200);
    const replay = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({
        // Transport stamps may differ on a retry; the intent is identical.
        commandId: randomUUID(),
        action: { ...body.action, at: tick() },
      })
      .expect(200);
    expect(replay.body.seq).toBe(first.body.seq);

    const conflict = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(adminToken))
      .set("Idempotency-Key", key)
      .send({
        commandId: randomUUID(),
        action: scoped(boardId, {
          type: "DUPLICATE_CARD",
          cardId,
          newCardId: randomUUID(),
        }),
      })
      .expect(409);
    expect(conflict.body.code).toBe("idempotency_conflict");
  });

  it("replays upload_attachment byte-for-byte and refuses another file", async () => {
    const { cardId } = await boardWithCard();
    const key = `upload-${randomUUID()}`;
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
      "hex",
    );
    const send = (bytes: Buffer) =>
      server()
        .post(`/api/v1/cards/${cardId}/attachments`)
        .set(auth(adminToken))
        .set("Idempotency-Key", key)
        .attach("file", bytes, {
          filename: "probe.png",
          contentType: "image/png",
        });

    const first = await send(png).expect(201);
    const replay = await send(png).expect(201);
    expect(replay.body.id).toBe(first.body.id);

    const conflict = await send(Buffer.concat([png, Buffer.from([0])])).expect(
      409,
    );
    expect(conflict.body).toMatchObject({
      code: "idempotency_conflict",
      retryable: false,
      key,
    });
  });
});
