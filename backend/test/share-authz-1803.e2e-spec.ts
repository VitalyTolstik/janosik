import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { sseTiming } from "@/realtime/sse-timing";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "share-owner-1803@example.com";
const PASSWORD = "correct horse battery";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
  "hex",
);

/** One captured public SSE frame. */
interface Frame {
  type?: string;
  [key: string]: unknown;
}

/**
 * M4/M9/M10/M11/L26 (TASK-180.3):
 *
 * - the public-sharing flag gates creation, not only resolution;
 * - refreshing a snapshot is `share.update` (approval + audit);
 * - archiving a live board revokes nested comments/attachments;
 * - the open public stream re-reads `includeComments`;
 * - the public board payload never exposes `agentPolicy`.
 */
describe("Share authz (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: () => ReturnType<typeof request>;
  let ownerToken: string;
  let ownerId: string;
  let baseUrl: string;
  let boardId: string;
  let cardId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    server = () => request(app.getHttpServer());
    await wipeAll(prisma);

    const registration = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    ownerToken = registration.body.accessToken as string;
    ownerId = registration.body.user.id as string;

    boardId = await createBoard("Share board");
    await addColumn(boardId, "col-1", "Todo");
    cardId = "card-1";
    await addCard(boardId, cardId, "col-1", "Card");
  });

  afterAll(async () => {
    sseTiming.keepAliveMs = 25_000;
    await wipeAll(prisma);
    await app.close();
  });

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function addColumn(
    board: string,
    columnId: string,
    title: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${board}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: {
          type: "ADD_COLUMN",
          boardId: board,
          newColumnId: columnId,
          title,
          at: Date.now(),
        },
      })
      .expect(200);
  }

  async function addCard(
    board: string,
    newCardId: string,
    columnId: string,
    title: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${board}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: {
          type: "ADD_CARD",
          boardId: board,
          newCardId,
          columnId,
          title,
          at: Date.now(),
        },
      })
      .expect(200);
  }

  async function createShare(
    board: string,
    body: Record<string, unknown> = { mode: "live" },
  ): Promise<{ id: string; token: string }> {
    const res = await server()
      .post(`/api/v1/boards/${board}/shares`)
      .set(auth(ownerToken))
      .send(body)
      .expect(201);
    return { id: res.body.id as string, token: res.body.token as string };
  }

  it("M4: the public-sharing flag gates creation and the runtime config", async () => {
    const snapshot = await createShare(boardId, { mode: "snapshot" });
    const pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerToken))
      .send({ name: "flag-agent", scopePreset: "admin", expiresAt: null })
      .expect(201);
    const token = pat.body.token as string;

    await prisma.featureFlag.upsert({
      where: { key: "public_shares" },
      create: { key: "public_shares", enabled: false },
      update: { enabled: false },
    });
    try {
      const config = await server().get("/api/v1/auth/config").expect(200);
      expect(config.body.allowPublicShares).toBe(false);
      const approvalsBefore = await prisma.approvalRequest.count({
        where: { boardId },
      });
      const idempotencyBefore = await prisma.idempotencyRecord.count();

      // A PAT on an approval-policy board and a retry key must still get the
      // feature 404 first — no approval row, no in-progress idempotency.
      await server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(token))
        .set("Idempotency-Key", "flag-off-create")
        .send({ mode: "live" })
        .expect(404);
      await server()
        .post(`/api/v1/boards/${boardId}/shares/${snapshot.id}/refresh`)
        .set(auth(token))
        .expect(404);

      expect(await prisma.approvalRequest.count({ where: { boardId } })).toBe(
        approvalsBefore,
      );
      expect(await prisma.idempotencyRecord.count()).toBe(idempotencyBefore);
    } finally {
      await prisma.featureFlag.update({
        where: { key: "public_shares" },
        data: { enabled: true },
      });
    }
  });

  it("M5: the realtime flag disables the public share stream too", async () => {
    sseTiming.keepAliveMs = 150;
    const live = await createShare(boardId, { mode: "live" });
    try {
      await prisma.featureFlag.upsert({
        where: { key: "realtime_sse" },
        create: { key: "realtime_sse", enabled: false },
        update: { enabled: false },
      });
      await server().get(`/api/v1/share/${live.token}/events`).expect(404);

      await prisma.featureFlag.update({
        where: { key: "realtime_sse" },
        data: { enabled: true },
      });
      const open = await fetch(
        `${baseUrl}/api/v1/share/${live.token}/events?since=0`,
        { headers: { Accept: "text/event-stream" } },
      );
      expect(open.status).toBe(200);
      expect(open.body).not.toBeNull();
      const reader = sseReader(open.body!);

      // Kill switch for an already-open public stream, not only for new ones.
      await prisma.featureFlag.update({
        where: { key: "realtime_sse" },
        data: { enabled: false },
      });
      expect(await reader.waitClosed(5_000)).toBe(true);
      await reader.close();
    } finally {
      sseTiming.keepAliveMs = 25_000;
      await prisma.featureFlag.update({
        where: { key: "realtime_sse" },
        data: { enabled: true },
      });
    }
  });

  it("M9: snapshot refresh uses the share.update approval and audits it", async () => {
    const snapshot = await createShare(boardId, { mode: "snapshot" });
    const token = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerToken))
      .send({ name: "refresh-agent", scopePreset: "admin", expiresAt: null })
      .expect(201);
    const pat = token.body.token as string;

    // A live share is not refreshable. The 400 must happen before the
    // approval gate creates a request.
    const live = await createShare(boardId, { mode: "live" });
    const approvalsBefore = await prisma.approvalRequest.count({
      where: { boardId },
    });
    await server()
      .post(`/api/v1/boards/${boardId}/shares/${live.id}/refresh`)
      .set(auth(pat))
      .expect(400);
    expect(await prisma.approvalRequest.count({ where: { boardId } })).toBe(
      approvalsBefore,
    );

    const refused = await server()
      .post(`/api/v1/boards/${boardId}/shares/${snapshot.id}/refresh`)
      .set(auth(pat))
      .expect(409);
    expect(refused.body.code).toBe("approval_required");
    expect(refused.body.action).toBe("share.update");

    await server()
      .post(
        `/api/v1/boards/${boardId}/approvals/${refused.body.approvalId as string}/decision`,
      )
      .set(auth(ownerToken))
      .send({
        decision: "approve",
        planHash: refused.body.planHash,
      })
      .expect(200);

    await server()
      .post(`/api/v1/boards/${boardId}/shares/${snapshot.id}/refresh`)
      .set(auth(pat))
      .set("X-Approval-Id", String(refused.body.approvalId))
      .expect(201);

    // The approval is one-shot: a replay must not refresh again.
    const replay = await server()
      .post(`/api/v1/boards/${boardId}/shares/${snapshot.id}/refresh`)
      .set(auth(pat))
      .set("X-Approval-Id", String(refused.body.approvalId))
      .expect(409);
    expect(replay.body.code).toBe("approval_consumed");

    const audit = await prisma.boardShareAuditLog.findFirst({
      where: { shareId: snapshot.id, action: "refreshed" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(ownerId);
    expect(audit?.apiTokenId).toEqual(expect.any(String));
  });

  it("M10: archiving a live board revokes nested comment and attachment reads", async () => {
    const archiveBoard = await createBoard("Archive share board");
    const column = "archive-col";
    const card = "archive-card";
    await addColumn(archiveBoard, column, "Todo");
    await addCard(archiveBoard, card, column, "Nested content");
    await server()
      .post(`/api/v1/cards/${card}/comments`)
      .set(auth(ownerToken))
      .send({ text: "private comment" })
      .expect(201);
    const uploaded = await server()
      .post(`/api/v1/cards/${card}/attachments`)
      .set(auth(ownerToken))
      .attach("file", PNG, { filename: "pixel.png", contentType: "image/png" })
      .expect(201);
    const attachmentId = uploaded.body.id as string;
    const live = await createShare(archiveBoard, {
      mode: "live",
      includeAttachments: true,
    });

    await server()
      .get(`/api/v1/share/${live.token}/cards/${card}/comments`)
      .expect(200);
    await server()
      .get(`/api/v1/share/${live.token}/cards/${card}/attachments`)
      .expect(200);

    await server()
      .post(`/api/v1/boards/${archiveBoard}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: {
          type: "ARCHIVE_BOARD",
          boardId: archiveBoard,
          at: Date.now(),
        },
      })
      .expect(200);

    await server()
      .get(`/api/v1/share/${live.token}/cards/${card}/comments`)
      .expect(410);
    await server()
      .get(`/api/v1/share/${live.token}/cards/${card}/attachments`)
      .expect(410);
    await server()
      .get(`/api/v1/share/${live.token}/attachments/${attachmentId}/content`)
      .expect(410);
    await server().get(`/api/v1/share/${live.token}`).expect(410);
  });

  it("M11: an open public stream stops forwarding new comments after includeComments=false", async () => {
    sseTiming.keepAliveMs = 150;
    const commentBoard = await createBoard("Comment stream board");
    await addColumn(commentBoard, "stream-col", "Todo");
    const streamCard = "stream-card";
    await addCard(commentBoard, streamCard, "stream-col", "Stream card");
    const live = await createShare(commentBoard, { mode: "live" });

    const response = await fetch(
      `${baseUrl}/api/v1/share/${live.token}/events?since=0`,
      { headers: { Accept: "text/event-stream" } },
    );
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    const reader = sseReader(response.body!);

    await server()
      .post(`/api/v1/cards/${streamCard}/comments`)
      .set(auth(ownerToken))
      .send({ text: "visible comment" })
      .expect(201);
    const before = await reader.drain(1_500);
    expect(before.some((frame) => frame.type === "activity")).toBe(true);

    await server()
      .patch(`/api/v1/boards/${commentBoard}/shares/${live.id}`)
      .set(auth(ownerToken))
      .send({ includeComments: false })
      .expect(200);
    const patched = await prisma.boardShareAuditLog.findFirst({
      where: { shareId: live.id, action: "updated" },
    });
    expect(patched).not.toBeNull();
    await server()
      .get(`/api/v1/share/${live.token}/cards/${streamCard}/comments`)
      .expect(404);
    // Let the keep-alive tick pick up the new flag.
    await new Promise((resolve) => setTimeout(resolve, 400));

    await server()
      .post(`/api/v1/cards/${streamCard}/comments`)
      .set(auth(ownerToken))
      .send({ text: "hidden comment" })
      .expect(201);
    const after = await reader.drain(1_200);
    expect(after.some((frame) => frame.type === "activity")).toBe(false);
    await reader.close();
  });

  it("L26: public live and snapshot payloads omit agentPolicy", async () => {
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentPolicy: {
          schemaVersion: 1,
          destructive: "deny",
          requireApprovalFor: ["delete_card"],
          approverRoles: ["ADMIN"],
          maxCommandsPerRun: 1,
          maxCardsPerRun: 1,
          approvalTtlMinutes: 5,
        },
      },
    });
    const live = await createShare(boardId, { mode: "live" });
    const snapshot = await createShare(boardId, { mode: "snapshot" });

    for (const token of [live.token, snapshot.token]) {
      const res = await server().get(`/api/v1/share/${token}`).expect(200);
      expect(res.body.board.agentPolicy).toBeUndefined();
    }
  });
});

/** Incremental public-SSE frame reader used by the includeComments test. */
function sseReader(stream: ReadableStream<Uint8Array>): {
  drain: (ms: number) => Promise<Frame[]>;
  waitClosed: (ms: number) => Promise<boolean>;
  close: () => Promise<void>;
} {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  const drain = async (ms: number): Promise<Frame[]> => {
    const frames: Frame[] = [];
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), remaining),
        ),
      ]);
      if (chunk === null) break;
      if (chunk.done) {
        closed = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const separator = buffer.indexOf("\n\n");
        if (separator === -1) break;
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data === "" || data === "ping") continue;
        try {
          frames.push(JSON.parse(data) as Frame);
        } catch {
          // Ignore a malformed frame; the assertion is about activity.
        }
      }
    }
    return frames;
  };

  const waitClosed = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (!closed && Date.now() < deadline) {
      await drain(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    return closed;
  };

  return {
    drain,
    waitClosed,
    close: async () => {
      await reader.cancel().catch(() => undefined);
    },
  };
}
