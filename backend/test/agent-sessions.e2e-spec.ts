import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import type { ReadableStreamReadResult } from "node:stream/web";
import request from "supertest";
import type {
  ActivityFeedPage,
  AgentSessionDto,
  BoardSseEvent,
  CommentDto,
  UserTokenDto,
} from "@janosik/shared";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "agent-sessions@example.com";
const MEMBER_EMAIL = "agent-sessions-member@example.com";
const PASSWORD = "correct horse battery";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);

interface SseFrame {
  type: string;
  seq?: number;
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string | null;
  agentName?: string;
  op?: string;
}

/**
 * TASK-166.1: agent identity, sessions and attribution.
 *
 * The central contract: one account may own several API tokens, and every
 * command/activity/comment/attachment must say which token (and optional
 * agent session) wrote it. Legacy clients without `X-Agent-Session` keep
 * working; another token/board cannot borrow a session.
 */
describe("Agent sessions and attribution (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let session: string;
  let ownerId: string;
  let boardId: string;
  let otherBoardId: string;
  let cardId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenAId: string;
  let tokenBId: string;
  let memberSession: string;
  let memberId: string;
  let memberTokenA: string;
  let memberTokenB: string;
  let memberTokenAId: string;

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
    await wipeAll(prisma);

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    session = registered.body.accessToken as string;
    ownerId = registered.body.user.id as string;

    boardId = await createBoard("Agent board");
    cardId = "card-agent-1";
    await command(session, {
      type: "ADD_COLUMN",
      newColumnId: "col-agent",
      title: "Todo",
    });
    await command(session, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: "col-agent",
      title: "Agent task",
    });
    otherBoardId = await createBoard("Other board");

    tokenA = await createToken("agent-A");
    tokenB = await createToken("agent-B");
    const list = await server()
      .get("/api/v1/users/me/tokens")
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as UserTokenDto[]);
    tokenAId = list.find((token) => token.name === "agent-A")!.id;
    tokenBId = list.find((token) => token.name === "agent-B")!.id;

    // A plain MEMBER proves the two-PAT "own upload/comment" rule; the owner
    // is ADMIN and would be allowed to delete anything by role.
    const memberRegistered = await server()
      .post("/api/v1/auth/register")
      .send({ email: MEMBER_EMAIL, password: PASSWORD, displayName: "Member" })
      .expect(201);
    memberSession = memberRegistered.body.accessToken as string;
    memberId = memberRegistered.body.user.id as string;
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(session))
      .send({ email: MEMBER_EMAIL, role: "MEMBER" })
      .expect(201);
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(memberSession))
      .expect(200)
      .then(
        (res) =>
          (res.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === boardId,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(memberSession))
      .expect(200);
    memberTokenA = await createToken("member-A", memberSession);
    memberTokenB = await createToken("member-B", memberSession);
    const memberList = await server()
      .get("/api/v1/users/me/tokens")
      .set(auth(memberSession))
      .expect(200)
      .then((res) => res.body as UserTokenDto[]);
    memberTokenAId = memberList.find((token) => token.name === "member-A")!.id;
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
      })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  async function command(
    token: string,
    action: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> {
    const commandId = randomUUID();
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(sessionId === undefined ? auth(token) : header(token, sessionId))
      .send({ commandId, action: { boardId, at: Date.now(), ...action } });
    if (res.status !== 200) {
      throw new Error(
        `Command failed (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
  }

  async function start(
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<AgentSessionDto> {
    return server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(token))
      .send(body)
      .expect(201)
      .then((res) => res.body as AgentSessionDto);
  }

  it("exposes the token identity on whoami and the token list", async () => {
    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(tokenA))
      .expect(200);
    expect(me.body.token).toMatchObject({
      id: tokenAId,
      name: "agent-A",
      scopePreset: "worker",
      trustedCi: false,
      effectiveTokenScope: "worker",
      paused: false,
    });

    const tokens = await server()
      .get("/api/v1/users/me/tokens")
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as UserTokenDto[]);
    expect(tokens.find((token) => token.id === tokenAId)).toMatchObject({
      scopePreset: "worker",
      trustedCi: false,
      paused: false,
      effectiveTokenScope: "worker",
      individualPausedAt: null,
      stopAllPausedAt: null,
    });
  });

  it("starts, heartbeats and ends a session (end is idempotent)", async () => {
    const started = await start(tokenA, {
      name: "run-1",
      clientName: "opencode",
      model: "test-model",
    });
    expect(started).toMatchObject({
      userId: ownerId,
      apiTokenId: tokenAId,
      boardId,
      name: "run-1",
      clientName: "opencode",
      model: "test-model",
      status: "active",
      stale: false,
      paused: false,
      pauseScope: null,
      endedAt: null,
    });

    const heartbeat = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${started.id}/heartbeat`)
      .set(auth(tokenA))
      .send({ status: "idle", summary: "reading the board" })
      .expect(200);
    expect(heartbeat.body.status).toBe("idle");
    expect(heartbeat.body.summary).toBe("reading the board");
    expect(heartbeat.body.lastHeartbeatAt).toBeGreaterThanOrEqual(
      started.lastHeartbeatAt,
    );

    const ended = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${started.id}/end`)
      .set(auth(tokenA))
      .send({ status: "completed", summary: "done" })
      .expect(200);
    expect(ended.body).toMatchObject({
      status: "completed",
      endReason: "completed",
      summary: "done",
    });
    expect(ended.body.endedAt).not.toBeNull();

    const again = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${started.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
    expect(again.body.status).toBe("completed");
    expect(again.body.endedAt).toBe(ended.body.endedAt);

    const closed = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${started.id}/heartbeat`)
      .set(auth(tokenA))
      .send({})
      .expect(403);
    expect(closed.body.code).toBe("agent_session_closed");

    const detail = await server()
      .get(`/api/v1/boards/${boardId}/agent-sessions/${started.id}`)
      .set(auth(tokenA))
      .expect(200);
    expect(detail.body.status).toBe("completed");
  });

  it("allows a board ADMIN browser session to end a session", async () => {
    const started = await start(tokenA, { name: "admin-end" });
    const ended = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${started.id}/end`)
      .set(auth(session))
      .send({ status: "completed" })
      .expect(200);
    expect(ended.body).toMatchObject({
      status: "completed",
      endReason: "completed",
    });
    expect(ended.body.endedAt).not.toBeNull();
  });

  it("serializes concurrent end/heartbeat and end/end", async () => {
    const realtime = app.get(RealtimeService);
    const events: BoardSseEvent[] = [];
    const subscription = realtime.watch(boardId).subscribe((event) => {
      events.push(event);
    });

    try {
      const raced = await start(tokenA, { name: "race-heartbeat" });
      const [ended, heartbeat] = await Promise.all([
        server()
          .post(`/api/v1/boards/${boardId}/agent-sessions/${raced.id}/end`)
          .set(auth(tokenA))
          .send({ status: "completed" }),
        server()
          .post(
            `/api/v1/boards/${boardId}/agent-sessions/${raced.id}/heartbeat`,
          )
          .set(auth(tokenA))
          .send({ status: "idle" }),
      ]);
      expect(ended.status).toBe(200);
      // Whichever wins, the heartbeat may not report an open session after
      // the end committed; the conditional update makes that impossible.
      if (heartbeat.status === 200) {
        expect(heartbeat.body.endedAt).toBeNull();
      } else {
        expect(heartbeat.status).toBe(403);
        expect(heartbeat.body.code).toBe("agent_session_closed");
      }
      expect(await endedActivityCount(raced.id)).toBe(1);
      const racedState = await prisma.agentSession.findUniqueOrThrow({
        where: { id: raced.id },
      });
      expect(["completed", "failed", "cancelled"]).toContain(racedState.status);
      expect(racedState.endedAt).not.toBeNull();

      const twice = await start(tokenA, { name: "race-end" });
      const [first, second] = await Promise.all([
        server()
          .post(`/api/v1/boards/${boardId}/agent-sessions/${twice.id}/end`)
          .set(auth(tokenA))
          .send({ status: "completed" }),
        server()
          .post(`/api/v1/boards/${boardId}/agent-sessions/${twice.id}/end`)
          .set(auth(tokenA))
          .send({ status: "completed" }),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await endedActivityCount(twice.id)).toBe(1);
      const twiceState = await prisma.agentSession.findUniqueOrThrow({
        where: { id: twice.id },
      });
      expect(["completed", "failed", "cancelled"]).toContain(twiceState.status);
      expect(twiceState.endedAt).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const sessionId of [raced.id, twice.id]) {
        const frames = events.filter(
          (event) =>
            event.type === "agent" &&
            event.op === "ended" &&
            event.sessionId === sessionId,
        );
        expect(frames).toHaveLength(1);
      }
    } finally {
      subscription.unsubscribe();
    }
  });

  it("lets a stale header start a fresh session and ignores query strings", async () => {
    const old = await start(tokenA, { name: "old" });
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${old.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);

    const fresh = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions?cache=1`)
      .set(header(tokenA, old.id))
      .send({ name: "fresh" })
      .expect(201)
      .then((res) => res.body as AgentSessionDto);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.status).toBe("active");

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${fresh.id}/end?cache=1`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
  });

  it("refuses another token's or another board's session", async () => {
    const owned = await start(tokenA, { name: "owned" });

    const foreignToken = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${owned.id}/heartbeat`)
      .set(auth(tokenB))
      .send({})
      .expect(403);
    expect(foreignToken.body.code).toBe("agent_session_invalid");

    const foreignBoard = await server()
      .post(
        `/api/v1/boards/${otherBoardId}/agent-sessions/${owned.id}/heartbeat`,
      )
      .set(auth(tokenA))
      .send({})
      .expect(403);
    expect(foreignBoard.body.code).toBe("agent_session_invalid");

    const foreignHeader = await server()
      .post(`/api/v1/boards/${otherBoardId}/commands`)
      .set(header(tokenA, owned.id))
      .send({
        commandId: randomUUID(),
        action: {
          boardId: otherBoardId,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: "col-foreign",
          title: "Nope",
        },
      })
      .expect(403);
    expect(foreignHeader.body.code).toBe("agent_session_invalid");

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${owned.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
  });

  it("keeps two PATs of one account distinguishable in DB, API and SSE", async () => {
    const sessionA = await start(tokenA, { name: "A" });
    const sessionB = await start(tokenB, { name: "B" });
    const commandA = randomUUID();
    const commandB = randomUUID();

    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenA, sessionA.id))
      .send({
        commandId: commandA,
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenB, sessionB.id))
      .send({
        commandId: commandB,
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(200);

    const rows = await prisma.command.findMany({
      where: { id: { in: [commandA, commandB] } },
    });
    const rowA = rows.find((row) => row.id === commandA)!;
    const rowB = rows.find((row) => row.id === commandB)!;
    expect(rowA).toMatchObject({
      apiTokenId: tokenAId,
      agentSessionId: sessionA.id,
      agentName: "agent-A",
      actorType: "agent",
      runId: null,
    });
    expect(rowB).toMatchObject({
      apiTokenId: tokenBId,
      agentSessionId: sessionB.id,
      agentName: "agent-B",
      actorType: "agent",
    });
    expect(rowA.apiTokenId).not.toBe(rowB.apiTokenId);

    const feed = await server()
      .get(`/api/v1/boards/${boardId}/activity`)
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as ActivityFeedPage);
    const entries = feed.items.filter(
      (entry) =>
        entry.type === "TOUCH_CARD" &&
        (entry.apiTokenId === tokenAId || entry.apiTokenId === tokenBId),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      apiTokenId: tokenBId,
      agentSessionId: sessionB.id,
      agentName: "agent-B",
    });
    expect(entries[1]).toMatchObject({
      apiTokenId: tokenAId,
      agentSessionId: sessionA.id,
      agentName: "agent-A",
    });

    const delta = await server()
      .get(`/api/v1/boards/${boardId}/commands`)
      .query({ since: 0, apiTokenId: tokenAId })
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as Array<{ apiTokenId?: string }>);
    expect(delta.length).toBeGreaterThan(0);
    expect(delta.every((entry) => entry.apiTokenId === tokenAId)).toBe(true);

    // SSE: a frame carries the same attribution as the stored row.
    const seq = await boardSeq();
    const stream = await fetch(
      `${baseUrl}/boards/${boardId}/events?since=${seq}&presence=0`,
      {
        headers: {
          Accept: "text/event-stream",
          ...auth(session),
        },
      },
    );
    expect(stream.status).toBe(200);
    const commandC = randomUUID();
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenA, sessionA.id))
      .send({
        commandId: commandC,
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(200);
    const frame = await readCommandFrame(stream);
    expect(frame).toMatchObject({
      type: "command",
      apiTokenId: tokenAId,
      agentSessionId: sessionA.id,
      agentName: "agent-A",
      seq: expect.any(Number),
    });

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionA.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionB.id}/end`)
      .set(auth(tokenB))
      .send({})
      .expect(200);
  });

  it("keeps legacy PAT clients working without X-Agent-Session", async () => {
    const commandId = randomUUID();
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(tokenA))
      .send({
        commandId,
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(200);
    const row = await prisma.command.findUnique({ where: { id: commandId } });
    expect(row).toMatchObject({
      apiTokenId: tokenAId,
      agentSessionId: null,
      agentName: "agent-A",
      actorType: "agent",
    });
  });

  it("attributes comments and uploads, and cannot forge a claim holder", async () => {
    const agentSession = await start(tokenA, { name: "writer" });
    const commentId = randomUUID();
    const comment = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(header(tokenA, agentSession.id))
      .send({ text: "from agent A", commandId: commentId })
      .expect(201)
      .then((res) => res.body as CommentDto);
    expect(comment).toMatchObject({
      actorType: "agent",
      apiTokenId: tokenAId,
      agentSessionId: agentSession.id,
      agentName: "agent-A",
    });

    const storedComment = await prisma.comment.findUnique({
      where: { id: commentId },
    });
    expect(storedComment).toMatchObject({
      actorType: "agent",
      apiTokenId: tokenAId,
      agentSessionId: agentSession.id,
      agentName: "agent-A",
    });

    // Another PAT of the same owner must not delete token A's comment.
    const denied = await server()
      .delete(`/api/v1/comments/${commentId}`)
      .set(auth(tokenB))
      .expect(403);
    expect(denied.body.message).toMatch(/author token/i);

    const upload = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(header(tokenA, agentSession.id))
      .attach("file", PNG, { filename: "pixel.png", contentType: "image/png" })
      .expect(201)
      .then((res) => res.body as { uploadedByTokenId?: string });
    expect(upload.uploadedByTokenId).toBe(tokenAId);
    const attachment = await prisma.attachment.findFirst({
      where: { cardId, fileName: "pixel.png", deletedAt: null },
    });
    expect(attachment).toMatchObject({
      uploadedById: ownerId,
      uploadedByTokenId: tokenAId,
      uploadedBySessionId: agentSession.id,
    });

    // A forged claimedBy cannot make the claim belong to someone else.
    const claimed = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenA, agentSession.id))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "CLAIM_CARD",
          cardId,
          claimedBy: "someone-else",
          leaseUntil: Date.now() + 60_000,
        },
      })
      .expect(200);
    expect(claimed.status).toBe(200);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.claimedBy).toBe(ownerId);
    expect(card.claimedByTokenId).toBe(tokenAId);
    expect(card.claimedBySessionId).toBe(agentSession.id);

    // Ending the session releases the claim it owned.
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
  });

  it("enforces a claim across two PATs of one owner", async () => {
    const sessionA = await start(tokenA, { name: "claim-A" });
    const sessionB = await start(tokenB, { name: "claim-B" });
    const lease = Date.now() + 60_000;

    const claim = (token: string, sessionId: string, leaseUntil: number) =>
      server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(header(token, sessionId))
        .send({
          commandId: randomUUID(),
          action: {
            boardId,
            at: Date.now(),
            type: "CLAIM_CARD",
            cardId,
            claimedBy: ownerId,
            leaseUntil,
          },
        });

    await claim(tokenA, sessionA.id, lease).expect(200);
    const blocked = await claim(tokenB, sessionB.id, lease + 1_000).expect(400);
    expect(blocked.body.field).toBe("action.claimedBy");

    // The same session may refresh its own lease.
    await claim(tokenA, sessionA.id, lease + 2_000).expect(200);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(row.claimedByTokenId).toBe(tokenAId);
    expect(row.claimedBySessionId).toBe(sessionA.id);

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionA.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionB.id}/end`)
      .set(auth(tokenB))
      .send({})
      .expect(200);
  });

  it("stops two PATs of a MEMBER from deleting each other's upload", async () => {
    const sessionA = await start(memberTokenA, { name: "upload-A" });
    const sessionB = await start(memberTokenB, { name: "upload-B" });

    const upload = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(header(memberTokenA, sessionA.id))
      .attach("file", PNG, {
        filename: "member-pixel.png",
        contentType: "image/png",
      })
      .expect(201)
      .then(
        (res) =>
          res.body as {
            id: string;
            uploadedByTokenId?: string;
            uploadedBySessionId?: string;
          },
      );
    expect(upload.uploadedByTokenId).toBe(memberTokenAId);
    expect(upload.uploadedBySessionId).toBe(sessionA.id);
    const stored = await prisma.attachment.findUniqueOrThrow({
      where: { id: upload.id },
    });
    expect(stored.uploadedById).toBe(memberId);
    expect(stored.uploadedByTokenId).toBe(memberTokenAId);

    await server()
      .delete(`/api/v1/attachments/${upload.id}`)
      .set(auth(memberTokenB))
      .expect(403);
    await server()
      .delete(`/api/v1/attachments/${upload.id}`)
      .set(auth(memberTokenA))
      .expect(200);

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionA.id}/end`)
      .set(auth(memberTokenA))
      .send({})
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionB.id}/end`)
      .set(auth(memberTokenB))
      .send({})
      .expect(200);
  });

  it("does not leak token or session identity through a public share", async () => {
    const agentSession = await start(tokenA, { name: "shared-run" });
    const sessionB = await start(tokenB, { name: "share-revoke" });
    const lease = Date.now() + 60_000;
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenA, agentSession.id))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "CLAIM_CARD",
          cardId,
          claimedBy: ownerId,
          leaseUntil: lease,
        },
      })
      .expect(200);

    // TASK-166: publishing a share is admin + destructive, so a plain worker
    // token is refused. This test is about share *attribution*, not the
    // destructive gate; grant tokenA the legacy-equivalent capability for the
    // two share calls below (this is the last test in the suite).
    await prisma.apiToken.update({
      where: { id: tokenAId },
      data: { scopePreset: "admin", trustedCi: true },
    });
    const share = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(header(tokenA, agentSession.id))
      .send({
        mode: "live",
        includeComments: true,
        includeAttachments: true,
      })
      .expect(201)
      .then((res) => res.body as { id: string; token: string });
    const audit = await prisma.boardShareAuditLog.findFirst({
      where: { shareId: share.id, action: "created" },
    });
    expect(audit).toMatchObject({
      apiTokenId: tokenAId,
      agentSessionId: agentSession.id,
      agentName: "agent-A",
      actorId: ownerId,
    });
    const forbidden = [
      tokenAId,
      agentSession.id,
      "agent-A",
      "claimedByTokenId",
      "claimedBySessionId",
      "apiTokenId",
      "agentSessionId",
      "uploadedByTokenId",
      "uploadedBySessionId",
    ];
    const board = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(board.body)).not.toContain(value);
    }
    const comments = await server()
      .get(`/api/v1/share/${share.token}/cards/${cardId}/comments`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(comments.body)).not.toContain(value);
    }
    const attachments = await server()
      .get(`/api/v1/share/${share.token}/cards/${cardId}/attachments`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(attachments.body)).not.toContain(value);
    }

    // Snapshot share: capture must apply the same sanitization.
    const snapshot = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(header(tokenA, agentSession.id))
      .send({
        mode: "snapshot",
        includeComments: true,
        includeAttachments: true,
      })
      .expect(201)
      .then((res) => res.body as { token: string });
    const snapshotBoard = await server()
      .get(`/api/v1/share/${snapshot.token}`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(snapshotBoard.body)).not.toContain(value);
    }
    const snapshotComments = await server()
      .get(`/api/v1/share/${snapshot.token}/cards/${cardId}/comments`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(snapshotComments.body)).not.toContain(value);
    }
    const snapshotAttachments = await server()
      .get(`/api/v1/share/${snapshot.token}/cards/${cardId}/attachments`)
      .expect(200);
    for (const value of forbidden) {
      expect(JSON.stringify(snapshotAttachments.body)).not.toContain(value);
    }

    const since = await boardSeq();
    const stream = await fetch(
      `${baseUrl}/share/${share.token}/events?since=${since}`,
      { headers: { Accept: "text/event-stream" } },
    );
    expect(stream.status).toBe(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(header(tokenA, agentSession.id))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), type: "TOUCH_CARD", cardId },
      })
      .expect(200);
    const frame = await readCommandFrame(stream);
    for (const value of forbidden) {
      expect(JSON.stringify(frame)).not.toContain(value);
    }

    // Share audit rows carry the same attribution as the command/activity
    // surfaces; revoke and permanent delete are separate write paths.
    // TASK-166 gates them as admin + destructive, so both PATs are granted
    // the legacy-equivalent capability for this attribution check.
    await prisma.apiToken.update({
      where: { id: tokenBId },
      data: { scopePreset: "admin", trustedCi: true },
    });
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${share.id}`)
      .set(header(tokenA, agentSession.id))
      .expect(200);
    await server()
      .delete(`/api/v1/boards/${boardId}/shares/${share.id}/permanent`)
      .set(header(tokenB, sessionB.id))
      .expect(204);
    const revokedAudit = await prisma.boardShareAuditLog.findFirst({
      where: { shareId: share.id, action: "revoked" },
    });
    expect(revokedAudit).toMatchObject({
      apiTokenId: tokenAId,
      agentSessionId: agentSession.id,
      agentName: "agent-A",
    });
    const deletedAudit = await prisma.boardShareAuditLog.findFirst({
      where: { shareId: share.id, action: "deleted" },
    });
    expect(deletedAudit).toMatchObject({
      apiTokenId: tokenBId,
      agentSessionId: sessionB.id,
      agentName: "agent-B",
    });

    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession.id}/end`)
      .set(auth(tokenA))
      .send({})
      .expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionB.id}/end`)
      .set(auth(tokenB))
      .send({})
      .expect(200);
  });

  async function endedActivityCount(sessionId: string): Promise<number> {
    const rows = await prisma.activity.findMany({
      where: { boardId, type: "agent_session_ended" },
      select: { details: true },
    });
    return rows.filter(
      (row) =>
        (row.details as { sessionId?: string } | null)?.sessionId === sessionId,
    ).length;
  }

  async function boardSeq(): Promise<number> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(session))
      .expect(200);
    return Number(res.headers["x-board-seq"]);
  }

  async function readCommandFrame(response: Response): Promise<SseFrame> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No SSE body");
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 12_000;
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Timed out waiting for SSE");
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) throw new Error("SSE stream ended");
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
            if (frame.type === "command") return frame;
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
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
