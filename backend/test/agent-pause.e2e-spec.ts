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
const MEMBER_EMAIL = "agent-pause-member@example.com";
const OUTSIDER_EMAIL = "agent-pause-outsider@example.com";
const PASSWORD = "correct horse battery";

interface SseFrame {
  type: string;
  op?: string;
  scope?: string;
  sessionId?: string;
  seq?: number;
  at?: number;
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
  let otherBoardId: string;
  let cardId: string;
  let legacyCardId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenAId: string;
  let tokenBId: string;
  let observerToken: string;
  let readOnlyToken: string;
  let memberSession: string;
  let memberToken: string;
  let outsiderSession: string;

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
    otherBoardId = await createBoard("Other pause board");
    cardId = "card-pause-1";
    legacyCardId = "card-pause-legacy";
    await command(null, {
      type: "ADD_COLUMN",
      newColumnId: "col-pause",
      title: "Todo",
    });
    for (const [id, title] of [
      [cardId, "Pause target"],
      [legacyCardId, "Legacy claim target"],
    ] as const) {
      await command(null, {
        type: "ADD_CARD",
        newCardId: id,
        columnId: "col-pause",
        title,
      });
    }

    tokenA = await createToken("agent-A");
    tokenB = await createToken("agent-B");
    observerToken = await createToken("agent-observer", {
      scopePreset: "observer",
    });
    readOnlyToken = await createToken("agent-readonly", { readOnly: true });
    const tokens = await listTokens();
    tokenAId = tokens.find((token) => token.name === "agent-A")!.id;
    tokenBId = tokens.find((token) => token.name === "agent-B")!.id;

    const memberRegistered = await server()
      .post("/api/v1/auth/register")
      .send({
        email: MEMBER_EMAIL,
        password: PASSWORD,
        displayName: "Member",
      })
      .expect(201);
    memberSession = memberRegistered.body.accessToken as string;
    const memberId = memberRegistered.body.user.id as string;
    await prisma.boardMember.create({
      data: {
        boardId,
        userId: memberId,
        role: "MEMBER",
        acceptedAt: new Date(),
      },
    });
    memberToken = await createToken("agent-member", {}, memberSession);

    outsiderSession = await server()
      .post("/api/v1/auth/register")
      .send({
        email: OUTSIDER_EMAIL,
        password: PASSWORD,
        displayName: "Outsider",
      })
      .expect(201)
      .then((res) => res.body.accessToken as string);
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

  async function createToken(
    name: string,
    options: Record<string, unknown> = {},
    sessionToken: string = session,
  ): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(sessionToken))
      .send({
        name,
        expiresAt: null,
        scopePreset: "worker",
        trustedCi: false,
        ...options,
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

  async function tokenIdByName(name: string): Promise<string> {
    const tokens = await listTokens();
    return tokens.find((token) => token.name === name)!.id;
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

  /**
   * Deterministic barrier for the in-flight races: hold the same advisory
   * lock as `BoardWriteService`, then wait until the queued HTTP command
   * actually blocks on it (visible as an ungranted advisory lock).
   */
  async function holdBoardLock(): Promise<{
    release: () => void;
    done: Promise<void>;
  }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
        locked();
        await gate;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await acquired;
    return { release, done };
  }

  async function waitForWaitingLock(expected = 1): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
      `;
      if (Number(rows[0]?.count ?? 0) >= expected) return;
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the queued board lock");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
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
    const sessionPaused = await prisma.activity.findFirstOrThrow({
      where: { boardId, type: "agent_session_paused" },
      orderBy: { createdAt: "desc" },
    });
    expect(sessionPaused).toMatchObject({
      actorId: ownerId,
      actorType: "human",
    });
    expect(sessionPaused.details).toMatchObject({
      sessionId: agentSession.id,
      reason: "inspect the run",
    });
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
    // Pause precedes the destructive/approval and scope gates (ADR §5.2).
    const destructive = await command(tokenA, {
      type: "DELETE_CARD",
      cardId,
    });
    expect(destructive.status).toBe(403);
    expect(destructive.body).toMatchObject({
      code: "agent_paused",
      pauseScope: "board",
    });
    const observer = await command(observerToken, {
      type: "TOUCH_CARD",
      cardId,
    });
    expect(observer.status).toBe(403);
    expect(observer.body).toMatchObject({
      code: "agent_paused",
      pauseScope: "board",
    });
    const memberPause = await server()
      .post(`/api/v1/boards/${boardId}/agents/pause`)
      .set(auth(memberSession))
      .send({})
      .expect(403);
    expect(memberPause.body.code).toBe("scope_denied");
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
    const pausedRow = await prisma.activity.findFirstOrThrow({
      where: { boardId, type: "agents_paused" },
      orderBy: { createdAt: "desc" },
    });
    expect(pausedRow).toMatchObject({
      actorId: ownerId,
      actorType: "human",
    });
    expect(pausedRow.details).toMatchObject({
      reason: "incident response",
    });
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
    const tokenPausedAudit = await prisma.securityAuditLog.findFirstOrThrow({
      where: { action: "token.paused" },
      orderBy: { createdAt: "desc" },
    });
    expect(tokenPausedAudit).toMatchObject({
      userId: ownerId,
      actorId: ownerId,
    });
    expect(tokenPausedAudit.details).toMatchObject({
      reason: "rotate credentials",
    });
  });

  it("enforces session-only controls and ownership", async () => {
    const agentSession = await start(tokenA, "security-controls");

    const foreignOwner = await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
      .set(auth(outsiderSession))
      .send({})
      .expect(404);
    expect(foreignOwner.body.message).toMatch(/not found/i);

    const patPauseAll = await server()
      .post("/api/v1/agents/pause-all")
      .set(auth(tokenA))
      .send({})
      .expect(403);
    expect(patPauseAll.body.code).toBe("pat_forbidden");

    const memberPat = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/pause`)
      .set(auth(memberToken))
      .send({})
      .expect(403);
    expect(memberPat.body.code).toBe("pat_forbidden");

    const readOnlyPat = await server()
      .post(`/api/v1/boards/${boardId}/agents/pause`)
      .set(auth(readOnlyToken))
      .send({})
      .expect(403);
    expect(readOnlyPat.body.code).toBe("pat_forbidden");

    const crossBoard = await server()
      .post(
        `/api/v1/boards/${otherBoardId}/agent-sessions/${agentSession.id}/pause`,
      )
      .set(auth(session))
      .send({})
      .expect(403);
    expect(crossBoard.body.code).toBe("agent_session_invalid");

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/end`)
      .set(auth(session))
      .send({})
      .expect(200);
  });

  it("cancels sessions, closes SSE and releases token claims on kill", async () => {
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
    // A legacy claim has no token id; revoke must leave it to its lease.
    await command(null, {
      type: "CLAIM_CARD",
      cardId: legacyCardId,
      claimedBy: ownerId,
      leaseUntil: Date.now() + 120_000,
    }).then((res) => expect(res.status).toBe(200));

    const previous = sseTiming.keepAliveMs;
    sseTiming.keepAliveMs = 150;
    const since = await boardSeq();
    const killedStream = await fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
      { headers: { Accept: "text/event-stream", ...auth(tokenB) } },
    );
    expect(killedStream.status).toBe(200);
    try {
      await server()
        .delete(`/api/v1/users/me/tokens/${tokenBId}`)
        .set(auth(session))
        .expect(200);
      await expectStreamEnded(killedStream);
    } finally {
      sseTiming.keepAliveMs = previous;
      await cancelBody(killedStream);
    }

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
    const legacy = await prisma.card.findUniqueOrThrow({
      where: { id: legacyCardId },
    });
    expect(legacy).toMatchObject({
      claimedBy: ownerId,
      claimedByTokenId: null,
      claimedBySessionId: null,
    });
    expect(legacy.leaseUntil).not.toBeNull();

    // Kill is idempotent; pausing a revoked token is an explicit no-op.
    await server()
      .delete(`/api/v1/users/me/tokens/${tokenBId}`)
      .set(auth(session))
      .expect(200);
    const pausedAfterKill = await server()
      .post(`/api/v1/users/me/tokens/${tokenBId}/pause`)
      .set(auth(session))
      .send({ reason: "too late" })
      .expect(200)
      .then((res) => res.body as UserTokenDto);
    expect(pausedAfterKill).toMatchObject({
      revokedAt: expect.any(Number),
      individualPausedAt: null,
      paused: false,
    });
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
    const tokenLevelStream = await fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
      { headers: { Accept: "text/event-stream", ...auth(tokenA) } },
    );
    expect(humanStream.status).toBe(200);
    expect(agentStream.status).toBe(200);
    expect(tokenLevelStream.status).toBe(200);
    try {
      const pausedSession = await server()
        .post(
          `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/pause`,
        )
        .set(auth(session))
        .send({ reason: "sse check" })
        .expect(200)
        .then((res) => res.body as AgentSessionDto);

      const paused = await readFrame(
        agentStream,
        (frame) => frame.op === "paused",
      );
      expect(paused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "session",
        at: pausedSession.pausedAt,
      });
      await expectStreamEnded(agentStream);
      await server()
        .post(
          `/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/resume`,
        )
        .set(auth(session))
        .send({})
        .expect(200);

      // The token-level stream (no `?session`) is not closed by a session
      // pause: after resume it still receives a normal command frame.
      await command(tokenA, { type: "TOUCH_CARD", cardId }).then((res) =>
        expect(res.status).toBe(200),
      );
      const tokenLevelFrame = await readFrame(
        tokenLevelStream,
        (frame) => frame.type === "command",
      );
      expect(tokenLevelFrame.type).toBe("command");

      // A token pause closes a token-level PAT stream and blocks reconnect.
      const tokenSince = await boardSeq();
      const tokenStream = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${tokenSince}&presence=0`,
        { headers: { Accept: "text/event-stream", ...auth(tokenA) } },
      );
      expect(tokenStream.status).toBe(200);
      const tokenPausedState = await server()
        .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
        .set(auth(session))
        .send({ reason: "stream stop" })
        .expect(200)
        .then((res) => res.body as UserTokenDto);
      const tokenPaused = await readFrame(
        tokenStream,
        (frame) => frame.op === "paused",
      );
      expect(tokenPaused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "token",
        at: tokenPausedState.individualPausedAt,
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
      const boardPausedState = await server()
        .post(`/api/v1/boards/${boardId}/agents/pause`)
        .set(auth(session))
        .send({ reason: "stream board stop" })
        .expect(200)
        .then((res) => res.body as BoardAgentPauseDto);
      const boardPaused = await readFrame(
        boardStream,
        (frame) => frame.op === "paused",
      );
      expect(boardPaused).toMatchObject({
        type: "agent",
        op: "paused",
        scope: "board",
        at: boardPausedState.pausedAt,
      });
      await expectStreamEnded(boardStream);
      const boardReconnect = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${boardSince}&presence=0`,
        { headers: { Accept: "text/event-stream", ...auth(tokenA) } },
      );
      expect(boardReconnect.status).toBe(403);
      expect(await boardReconnect.json()).toMatchObject({
        code: "agent_paused",
        pauseScope: "board",
      });
      // Human SSE is unaffected by the board pause: a human write still
      // commits and reaches the open human stream.
      await command(null, { type: "TOUCH_CARD", cardId }).then((res) =>
        expect(res.status).toBe(200),
      );
      const humanFrame = await readFrame(
        humanStream,
        (frame) => frame.type === "command",
      );
      expect(humanFrame.type).toBe("command");
      await server()
        .post(`/api/v1/boards/${boardId}/agents/resume`)
        .set(auth(session))
        .send({})
        .expect(200);
    } finally {
      sseTiming.keepAliveMs = previous;
      await cancelBody(humanStream);
      await cancelBody(agentStream);
      await cancelBody(tokenLevelStream);
      await server()
        .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/end`)
        .set(auth(session))
        .send({})
        .expect(200);
    }
  });

  it("checks pause, revoke and end again under the board lock", async () => {
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

    // A command queued before a pause but not yet holding the lock is
    // refused by the second read.
    const pausedLock = await holdBoardLock();
    try {
      const queued = command(tokenA, { type: "TOUCH_CARD", cardId });
      await waitForWaitingLock();
      await server()
        .post(`/api/v1/users/me/tokens/${tokenAId}/pause`)
        .set(auth(session))
        .send({ reason: "queued" })
        .expect(200);
      pausedLock.release();
      await pausedLock.done;
      const refused = await queued;
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("agent_paused");
    } finally {
      pausedLock.release();
      await pausedLock.done;
    }
    await server()
      .post(`/api/v1/users/me/tokens/${tokenAId}/resume`)
      .set(auth(session))
      .send({})
      .expect(200);

    // Kill before the lock: the queued command is rejected with 401.
    const revokedToken = await createToken("agent-queued-revoked");
    const revokedTokenId = await tokenIdByName("agent-queued-revoked");
    const revokedLock = await holdBoardLock();
    try {
      const queued = command(revokedToken, {
        type: "TOUCH_CARD",
        cardId,
      });
      await waitForWaitingLock();
      await server()
        .delete(`/api/v1/users/me/tokens/${revokedTokenId}`)
        .set(auth(session))
        .expect(200);
      revokedLock.release();
      await revokedLock.done;
      const refused = await queued;
      expect(refused.status).toBe(401);
    } finally {
      revokedLock.release();
      await revokedLock.done;
    }

    // End session before the lock: the queued command sees a closed session.
    const endedSession = await start(tokenA, "queued-end");
    const endedLock = await holdBoardLock();
    try {
      const queued = command(
        tokenA,
        { type: "TOUCH_CARD", cardId },
        endedSession.id,
      );
      await waitForWaitingLock();
      await prisma.agentSession.update({
        where: { id: endedSession.id },
        data: {
          status: "completed",
          endedAt: new Date(),
          endReason: "completed",
        },
      });
      endedLock.release();
      await endedLock.done;
      const refused = await queued;
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("agent_session_closed");
    } finally {
      endedLock.release();
      await endedLock.done;
    }

    // Kill before the lock: a queued CLAIM_CARD cannot resurrect a claim.
    const claimToken = await createToken("agent-queued-claim");
    const claimTokenId = await tokenIdByName("agent-queued-claim");
    const claimLock = await holdBoardLock();
    try {
      const queued = command(
        claimToken,
        {
          type: "CLAIM_CARD",
          cardId,
          claimedBy: ownerId,
          leaseUntil: Date.now() + 120_000,
        },
        undefined,
      );
      await waitForWaitingLock();
      await server()
        .delete(`/api/v1/users/me/tokens/${claimTokenId}`)
        .set(auth(session))
        .expect(200);
      claimLock.release();
      await claimLock.done;
      const refused = await queued;
      expect(refused.status).toBe(401);
    } finally {
      claimLock.release();
      await claimLock.done;
    }
    const resurrected = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
    });
    expect(resurrected.claimedByTokenId).toBeNull();
    expect(resurrected.claimedBySessionId).toBeNull();
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
