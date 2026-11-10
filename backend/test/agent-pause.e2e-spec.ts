import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import type { ReadableStreamReadResult } from "node:stream/web";
import request from "supertest";
import type {
  ActivityFeedPage,
  AgentSessionDto,
  AgentStopAllPauseDto,
  BoardAgentPauseDto,
  UserTokenDto,
} from "@janosik/shared";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { BoardWriteService } from "@/common/board-write.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { sseTiming } from "@/realtime/sse-timing";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "agent-pause@example.com";
const PASSWORD = "correct horse battery";

interface SseFrame {
  type: string;
  op?: string;
  scope?: string;
  sessionId?: string;
  seq?: number;
}

/**
 * TASK-166.3 pause / kill switch.
 *
 * Covers the four levels (session, token, board, stop-all) against a real
 * database, the control-plane exceptions, claims, SSE close/reconnect and
 * the in-flight semantics of the second pause read under the board lock.
 */
describe("Agent pause and kill (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let boardWrite: BoardWriteService;
  let baseUrl: string;
  let session: string;
  let ownerId: string;
  let boardId: string;
  let cardId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenAId: string;
  let tokenBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    boardWrite = app.get(BoardWriteService);
    await wipeAll(prisma);

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    session = registered.body.accessToken as string;
    ownerId = registered.body.user.id as string;

    boardId = await createBoard("Pause board");
    cardId = "card-pause-1";
    await command(null, {
      type: "ADD_COLUMN",
      newColumnId: "col-pause",
      title: "Todo",
    });
    await command(null, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-pause",
      title: "Pause target",
    });

    tokenA = await createToken("agent-A");
    tokenB = await createToken("agent-B");
    const tokens = await listTokens();
    tokenAId = tokens.find((token) => token.name === "agent-A")!.id;
    tokenBId = tokens.find((token) => token.name === "agent-B")!.id;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const header = (
    token: string,
    sessionId: string,
  ): Record<string, string> => ({
    ...auth(token),
    "X-Agent-Session": sessionId,
  });

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function createToken(name: string): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({
        name,
        expiresAt: null,
        scopePreset: "worker",
        trustedCi: false,
      })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  async function listTokens(): Promise<UserTokenDto[]> {
    return server()
      .get("/api/v1/users/me/tokens")
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as UserTokenDto[]);
  }

  async function command(
    token: string | null,
    action: Record<string, unknown>,
    agentSessionId?: string,
  ): Promise<request.Response> {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(
        token === null
          ? auth(session)
          : agentSessionId === undefined
            ? auth(token)
            : header(token, agentSessionId),
      )
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
  }

  async function start(token: string, name: string): Promise<AgentSessionDto> {
    return server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(token))
      .send({ name })
      .expect(201)
      .then((res) => res.body as AgentSessionDto);
  }

  async function boardSeq(): Promise<number> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(session))
      .expect(200);
    return Number(res.headers["x-board-seq"]);
  }

  it("pauses one session, keeps its claim, allows heartbeat/end and resumes", async () => {
    const agentSession = await start(tokenA, "session-pause");
    await command(
      tokenA,
      {
        type: "CLAIM_CARD",
        cardId,
        claimedBy: ownerId,
        leaseUntil: Date.now() + 120_000,
      },
      agentSession.id,
    ).then((res) => expect(res.status).toBe(200));

    const deniedToken = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/pause`)
      .set(auth(tokenA))
      .send({ reason: "agent tries to self-resume" })
      .expect(403);
    expect(deniedToken.body.code).toBe("pat_forbidden");

    const paused = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/pause`)
      .set(auth(session))
      .send({ reason: "inspect the run" })
      .expect(200);
    expect(paused.body).toMatchObject({
      id: agentSession.id,
      paused: true,
      pauseScope: "session",
      pausedBy: ownerId,
      pausedReason: "inspect the run",
    });
    expect(paused.body.pausedAt).toEqual(expect.any(Number));

    const blocked = await command(
      tokenA,
      { type: "TOUCH_CARD", cardId },
      agentSession.id,
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      code: "agent_paused",
      pauseScope: "session",
      scope: "session",
      retryable: false,
      pausedAt: expect.any(Number),
    });

    // A token-level write without the session header is not session-paused.
    expect((await command(tokenA, { type: "TOUCH_CARD", cardId })).status).toBe(
      200,
    );

    // Pause never releases a claim.
    const claimed = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    expect(claimed.claimedBySessionId).toBe(agentSession.id);
    expect(claimed.claimedByTokenId).toBe(tokenAId);

    // Control-plane exceptions stay open during the pause.
    await server()
      .post(
        `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/heartbeat`,
      )
      .set(auth(tokenA))
      .send({ summary: "still alive" })
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}`)
      .set(auth(tokenA))
      .expect(200);

    const resumed = await server()
      .post(
        `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/resume`,
      )
      .set(auth(session))
      .send({ reason: "reviewed" })
      .expect(200);
    expect(resumed.body).toMatchObject({
      paused: false,
      pauseScope: null,
      pausedAt: null,
      pausedBy: null,
      pausedReason: null,
    });
    expect(
      (await command(tokenA, { type: "TOUCH_CARD", cardId }, agentSession.id))
        .status,
    ).toBe(200);

    // End is a control-plane exception and releases the session's claims.
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/end`)
      .set(auth(tokenA))
      .send({ status: "completed" })
      .expect(200);
    const released = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    expect(released.claimedBy).toBeNull();
    expect(released.claimedByTokenId).toBeNull();
    expect(released.claimedBySessionId).toBeNull();

    const activity = await activityTypes();
    expect(activity).toEqual(
      expect.arrayContaining(["agent_session_paused", "agent_session_resumed"]),
    );
  });

  it("pauses the whole board, blocks every PAT write and keeps humans/reads open", async () => {
    const agentSession = await start(tokenA, "board-pause");
    const paused = await server()
      .post(`/api/v1/boards/${boardId}/agents/pause`)
      .set(auth(session))
      .send({ reason: "incident response" })
      .expect(200)
      .then((res) => res.body as BoardAgentPauseDto);
    expect(paused).toMatchObject({
      scope: "board",
      boardId,
      paused: true,
      pausedBy: ownerId,
      reason: "incident response",
    });

    const aggregate = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(session))
      .expect(200);
    expect(aggregate.body).toMatchObject({
      agentsPausedAt: paused.pausedAt,
      agentsPausedBy: ownerId,
      agentsPauseReason: "incident response",
    });

    for (const token of [tokenA, tokenB]) {
      const blocked = await command(token, { type: "TOUCH_CARD", cardId });
      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({
        code: "agent_paused",
        pauseScope: "board",
      });
    }
    // Session control writes are not a bypass, but heartbeat/end are.
    const blockedStart = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(tokenA))
      .send({ name: "blocked-start" })
      .expect(403);
    expect(blockedStart.body.code).toBe("agent_paused");
    await server()
      .post(
        `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/heartbeat`,
      )
      .set(auth(tokenA))
      .send({})
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}`)
      .set(auth(tokenA))
      .expect(200);

    // Content REST paths are blocked too; GETs stay open.
    const comment = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(tokenA))
      .send({ text: "should not land", commandId: randomUUID() })
      .expect(403);
    expect(comment.body.code).toBe("agent_paused");
    const upload = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(tokenA))
      .attach("file", Buffer.from("not really"), {
        filename: "blocked.txt",
        contentType: "text/plain",
      })
      .expect(403);
    expect(upload.body.code).toBe("agent_paused");
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(tokenA))
      .expect(200);

    const selfResume = await server()
      .post(`/api/v1/boards/${boardId}/agents/resume`)
      .set(auth(tokenA))
      .send({})
      .expect(403);
    expect(selfResume.body.code).toBe("pat_forbidden");

    // Pause is operational state: it must not travel in an export.
    const exported = await server()
      .get(`/api/v1/boards/${boardId}/export`)
      .set(auth(session))
      .expect(200);
    const envelope = JSON.parse(exported.text) as {
      boards: Array<Record<string, unknown>>;
    };
    expect(envelope.boards[0]).not.toHaveProperty("agentsPausedAt");
    expect(envelope.boards[0]).not.toHaveProperty("agentsPauseReason");

    const resumed = await server()
      .post(`/api/v1/boards/${boardId}/agents/resume`)
      .set(auth(session))
      .send({ reason: "all clear" })
      .expect(200)
      .then((res) => res.body as BoardAgentPauseDto);
    expect(resumed).toMatchObject({
      paused: false,
      pausedAt: null,
      pausedBy: null,
      reason: null,
    });
    expect((await command(tokenB, { type: "TOUCH_CARD", cardId })).status).toBe(
      200,
    );

    const activity = await activityTypes();
    expect(activity).toEqual(
      expect.arrayContaining(["agents_paused", "agents_resumed"]),
    );
  });

  it("keeps individual and stop-all pauses independent", async () => {
    const pausedA = await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
      .set(auth(session))
      .send({ reason: "rotate credentials" })
      .expect(200)
      .then((res) => res.body as UserTokenDto);
    expect(pausedA).toMatchObject({
      paused: true,
      individualPausedBy: ownerId,
      individualPausedReason: "rotate credentials",
      stopAllPausedAt: null,
    });
    expect((await command(tokenA, { type: "TOUCH_CARD", cardId })).status).toBe(
      403,
    );
    expect((await command(tokenB, { type: "TOUCH_CARD", cardId })).status).toBe(
      200,
    );

    const stopped = await server()
      .post("/api/v1/agents/pause-all")
      .set(auth(session))
      .send({ reason: "freeze the swarm" })
      .expect(200)
      .then((res) => res.body as AgentStopAllPauseDto);
    expect(stopped.paused).toBe(true);
    expect(stopped.affected).toBeGreaterThanOrEqual(2);
    expect((await command(tokenB, { type: "TOUCH_CARD", cardId })).status).toBe(
      403,
    );

    await server()
      .post("/api/v1/agents/resume-all")
      .set(auth(session))
      .send({})
      .expect(200);
    const after = await listTokens();
    expect(after.find((token) => token.id === tokenAId)).toMatchObject({
      paused: true,
      individualPausedAt: expect.any(Number),
      stopAllPausedAt: null,
    });
    expect(after.find((token) => token.id === tokenBId)).toMatchObject({
      paused: false,
      individualPausedAt: null,
      stopAllPausedAt: null,
    });
    expect((await command(tokenA, { type: "TOUCH_CARD", cardId })).status).toBe(
      403,
    );
    expect((await command(tokenB, { type: "TOUCH_CARD", cardId })).status).toBe(
      200,
    );

    await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/resume`)
      .set(auth(session))
      .send({})
      .expect(200);
    expect((await command(tokenA, { type: "TOUCH_CARD", cardId })).status).toBe(
      200,
    );

    const patPause = await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
      .set(auth(tokenA))
      .send({})
      .expect(403);
    expect(patPause.body.code).toBe("pat_forbidden");

    const audits = await prisma.securityAuditLog.findMany({
      where: {
        action: {
          in: [
            "token.paused",
            "token.resumed",
            "agents.paused_all",
            "agents.resumed_all",
          ],
        },
      },
      select: { action: true },
    });
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "token.paused",
        "token.resumed",
        "agents.paused_all",
        "agents.resumed_all",
      ]),
    );
  });

  it("cancels sessions and releases token claims on kill", async () => {
    const agentSession = await start(tokenB, "kill-me");
    await command(
      tokenB,
      {
        type: "CLAIM_CARD",
        cardId,
        claimedBy: ownerId,
        leaseUntil: Date.now() + 120_000,
      },
      agentSession.id,
    ).then((res) => expect(res.status).toBe(200));

    await server()
      .delete(`/api/v1/users/me/tokens/${tokenBId}`)
      .set(auth(session))
      .expect(200);

    const killed = await prisma.agentSession.findUniqueOrThrow({
      where: { id: agentSession.id },
    });
    expect(killed).toMatchObject({
      status: "cancelled",
      endReason: "cancelled",
    });
    expect(killed.endedAt).not.toBeNull();
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.claimedBy).toBeNull();
    expect(card.claimedByTokenId).toBeNull();
    expect(card.claimedBySessionId).toBeNull();
    expect(card.leaseUntil).toBeNull();

    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(tokenB))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(401);
  });

  it("announces pause on the next SSE tick and closes only PAT streams", async () => {
    const previous = sseTiming.keepAliveMs;
    sseTiming.keepAliveMs = 150;
    const agentSession = await start(tokenA, "sse-pause");
    const since = await boardSeq();
    const humanStream = await fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
      { headers: { Accept: "text/event-stream", ...auth(session) } },
    );
    const agentStream = await fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0&session=${agentSession.id}`,
      {
        headers: {
          Accept: "text/event-stream",
          ...header(tokenA, agentSession.id),
        },
      },
    );
    expect(humanStream.status).toBe(200);
    expect(agentStream.status).toBe(200);
    try {
      await server()
        .post(
          `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/pause`,
        )
        .set(auth(session))
        .send({ reason: "sse check" })
        .expect(200);

      const paused = await readFrame(
        agentStream,
        (frame) => frame.op === "paused",
      );
      expect(paused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "session",
      });
      await expectStreamEnded(agentStream);
      await server()
        .post(
          `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/resume`,
        )
        .set(auth(session))
        .send({})
        .expect(200);

      // The human stream stays open through the agent pause.
      await command(null, { type: "TOUCH_CARD", cardId }).then((res) =>
        expect(res.status).toBe(200),
      );
      const commandFrame = await readFrame(
        humanStream,
        (frame) => frame.type === "command",
      );
      expect(commandFrame.type).toBe("command");

      // A token pause closes a token-level PAT stream and blocks reconnect.
      const tokenSince = await boardSeq();
      const tokenStream = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${tokenSince}&presence=0`,
        { headers: { Accept: "text/event-stream", ...auth(tokenA) } },
      );
      expect(tokenStream.status).toBe(200);
      await server()
        .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
        .set(auth(session))
        .send({ reason: "stream stop" })
        .expect(200);
      const tokenPaused = await readFrame(
        tokenStream,
        (frame) => frame.op === "paused",
      );
      expect(tokenPaused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "token",
      });
      await expectStreamEnded(tokenStream);
      const reconnect = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${tokenSince}&presence=0`,
        {
          headers: {
            Accept: "text/event-stream",
            ...header(tokenA, agentSession.id),
          },
        },
      );
      expect(reconnect.status).toBe(403);
      expect(await reconnect.json()).toMatchObject({
        code: "agent_paused",
        pauseScope: "token",
      });
      await server()
        .post(`/api/v1/users/me/tokens/${tokenAId}/resume`)
        .set(auth(session))
        .send({})
        .expect(200);

      // Board pause closes a PAT stream with the board scope too.
      const boardSince = await boardSeq();
      const boardStream = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${boardSince}&presence=0`,
        { headers: { Accept: "text/event-stream", ...auth(tokenA) } },
      );
      expect(boardStream.status).toBe(200);
      await server()
        .post(`/api/v1/boards/${boardId}/agents/pause`)
        .set(auth(session))
        .send({ reason: "stream board stop" })
        .expect(200);
      const boardPaused = await readFrame(
        boardStream,
        (frame) => frame.op === "paused",
      );
      expect(boardPaused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "board",
      });
      await expectStreamEnded(boardStream);
      await server()
        .post(`/api/v1/boards/${boardId}/agents/resume`)
        .set(auth(session))
        .send({})
        .expect(200);
    } finally {
      sseTiming.keepAliveMs = previous;
      await cancelBody(humanStream);
      await cancelBody(agentStream);
      await server()
        .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/end`)
        .set(auth(session))
        .send({})
        .expect(200);
    }
  });

  it("checks pause again under the board lock (in-flight semantics)", async () => {
    // A writer that already passed the second read and holds the lock must
    // finish even if the pause commits inside its body.
    const committed = await boardWrite.run(
      boardId,
      async (tx) => {
        await prisma.apiToken.update({
          where: { id: tokenAId },
          data: { individualPausedAt: new Date(), individualPausedBy: ownerId },
        });
        await tx.activity.create({
          data: {
            boardId,
            type: "agents_paused",
            actorId: ownerId,
            actorType: "human",
            details: { probe: "in-flight" },
          },
        });
        return "committed";
      },
      { principal: { via: "pat", apiTokenId: tokenAId } },
    );
    expect(committed).toBe("committed");
    expect(
      await prisma.activity.count({
        where: { boardId, type: "agents_paused" },
      }),
    ).toBeGreaterThan(0);
    await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/resume`)
      .set(auth(session))
      .send({})
      .expect(200);

    // A queued request that has not acquired the lock when the pause commits
    // is refused by the second read.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
      locked();
      await gate;
    });
    await lockHeld;
    const queued = command(tokenA, { type: "TOUCH_CARD", cardId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
      .set(auth(session))
      .send({ reason: "queued" })
      .expect(200);
    release();
    await holder;
    const refused = await queued;
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("agent_paused");
    await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/resume`)
      .set(auth(session))
      .send({})
      .expect(200);
  });

  async function activityTypes(): Promise<string[]> {
    const feed = await server()
      .get(`/api/v1/boards/${boardId}/activity?limit=100`)
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as ActivityFeedPage);
    return feed.items.map((entry) => entry.type);
  }

  async function readFrame(
    response: Response,
    match: (frame: SseFrame) => boolean,
  ): Promise<SseFrame> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No SSE body");
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 10_000;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out waiting for SSE");
      const chunk = await readWithTimeout(reader, remaining);
      if (chunk.done) throw new Error("SSE stream ended before the frame");
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const separator = buffer.indexOf("\n\n");
        if (separator === -1) break;
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "ping") continue;
          const frame = JSON.parse(payload) as SseFrame;
          if (frame.type === "keepalive") continue;
          if (match(frame)) {
            reader.releaseLock();
            return frame;
          }
        }
      }
    }
  }

  /** Consume until the server closes the stream, bounded by a short deadline. */
  async function expectStreamEnded(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;
    const deadline = Date.now() + 5_000;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("SSE stream did not close");
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) return;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async function cancelBody(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }

  function readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ms: number,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for SSE data")),
        ms,
      );
      reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
});
