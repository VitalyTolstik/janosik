import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RequestLogService } from "@/common/request-log";
import { resetRateLimits } from "@/common/rate-limit";
import { TrafficService } from "@/common/traffic.service";
import { recentQueueJobs, resetQueueJobLog } from "@/ops/queue-core";
import {
  setAgentSessionRateLimit,
  setBoardRateLimit,
} from "@/config/rate-limit";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "observability@example.com";
const PASSWORD = "correct horse battery";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);

/**
 * TASK-166.10: agent rate limits, structured request logs, metrics and queue
 * attribution. The spec uses a dedicated board set so the per-board and
 * per-session buckets cannot be exhausted by another case.
 */
describe("Observability and agent rate limits (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let logs: RequestLogService;
  let traffic: TrafficService;
  let session: string;
  let ownerId: string;
  let boardId: string;
  let otherBoardId: string;
  let cardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    logs = app.get(RequestLogService);
    traffic = app.get(TrafficService);
    await wipeAll(prisma);
    resetRateLimits();
    resetQueueJobLog();

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    session = registered.body.accessToken as string;
    ownerId = registered.body.user.id as string;

    boardId = await createBoard("Observability board");
    otherBoardId = await createBoard("Other board");
    cardId = "card-obs-1";
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-obs",
      title: "Todo",
    });
    await command({
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-obs",
      title: "Evidence",
    });
  });

  afterAll(async () => {
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    resetRateLimits();
    await wipeAll(prisma);
    await app.close();
  });

  beforeEach(() => {
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    resetRateLimits();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function command(action: Record<string, unknown>): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(session))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function createToken(name: string): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  async function startSession(pat: string): Promise<string> {
    return server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(pat))
      .send({ name: `session-${randomUUID()}` })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  it("applies a shared per-board budget to agent traffic and isolates boards", async () => {
    setBoardRateLimit(2);
    const pat = await createToken("board-budget");

    await server().get(`/api/v1/boards/${boardId}`).set(auth(pat)).expect(200);
    const second = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(pat))
      .expect(200);
    expect(second.headers["x-ratelimit-scope"]).toBe("board");

    const denied = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(pat))
      .expect(429);
    expect(denied.body).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfter: Number(denied.headers["retry-after"]),
      requestId: denied.headers["x-request-id"],
      scope: "board",
    });
    expect(denied.headers["x-ratelimit-scope"]).toBe("board");
    expect(denied.headers["x-ratelimit-remaining"]).toBe("0");
    expect(
      traffic.snapshot().telemetry?.rateLimited.board,
    ).toBeGreaterThanOrEqual(1);

    // Another board is a separate bucket for the same token.
    await server()
      .get(`/api/v1/boards/${otherBoardId}`)
      .set(auth(pat))
      .expect(200);
  });

  it("applies a per-session budget and leaves a sibling session alone", async () => {
    setAgentSessionRateLimit(2);
    const pat = await createToken("session-budget");
    const first = await startSession(pat);
    const second = await startSession(pat);
    const heartbeat = (sessionId: string) =>
      server()
        .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionId}/heartbeat`)
        .set(auth(pat))
        .send({});

    await heartbeat(first).expect(200);
    await heartbeat(first).expect(200);
    const denied = await heartbeat(first).expect(429);
    expect(denied.body).toMatchObject({
      code: "rate_limited",
      retryable: true,
      scope: "session",
    });
    expect(denied.headers["x-ratelimit-scope"]).toBe("session");

    await heartbeat(second).expect(200);
  });

  it("logs attributed requests and redacts public share tokens", async () => {
    logs.clear();
    const pat = await createToken("log-attribution");
    const startedAt = Date.now();

    await server().get(`/api/v1/boards/${boardId}`).set(auth(pat)).expect(200);
    await server().get("/api/v1/share/super-secret-share-token").expect(404);

    const entries = logs
      .recentEntries()
      .filter((entry) => entry.durationMs >= 0 && entry.requestId !== "");
    const boardEntry = entries.find(
      (entry) =>
        entry.path === `/api/v1/boards/${boardId}` &&
        entry.actorType === "agent",
    );
    expect(boardEntry).toMatchObject({
      method: "GET",
      status: 200,
      actorType: "agent",
      actorId: ownerId,
      boardId,
    });
    expect(boardEntry?.apiTokenId).toBeTruthy();
    expect(boardEntry?.requestId).toBeTruthy();

    const shareEntry = entries.find((entry) =>
      entry.path.startsWith("/api/v1/share/"),
    );
    expect(shareEntry?.path).toBe("/api/v1/share/[redacted]");
    const logged = JSON.stringify(logs.recentEntries());
    expect(logged).not.toContain("super-secret-share-token");
    expect(logged).not.toContain(PNG.toString("base64").slice(0, 16));
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
  });

  it("puts token/session attribution on queued attachment jobs", async () => {
    resetQueueJobLog();
    const pat = await createToken("queue-attribution");
    const sessionId = await startSession(pat);

    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(pat))
      .set("X-Agent-Session", sessionId)
      .attach("file", PNG, {
        filename: "evidence.png",
        contentType: "image/png",
      })
      .expect(201);

    const event = recentQueueJobs().find(
      (candidate) => candidate.queue === "media",
    );
    expect(event).toMatchObject({
      event: "queue.job",
      queue: "media",
      attribution: {
        actorType: "agent",
        actorId: ownerId,
        boardId,
        agentSessionId: sessionId,
      },
    });
    expect(event?.attribution?.apiTokenId).toBeTruthy();
    const line = JSON.stringify(event);
    expect(line).not.toContain("evidence.png");
    expect(line).not.toContain("PNG");
  });

  it("exposes attributable counters on the existing traffic snapshot", async () => {
    const pat = await createToken("metrics");
    await server().get(`/api/v1/boards/${boardId}`).set(auth(pat)).expect(200);

    const snapshot = traffic.snapshot();
    expect(snapshot.telemetry?.requests.agent).toBeGreaterThan(0);
    expect(snapshot.telemetry?.writes).toBeGreaterThan(0);
    expect(snapshot.telemetry?.latencyMs.count).toBeGreaterThan(0);
  });
});
