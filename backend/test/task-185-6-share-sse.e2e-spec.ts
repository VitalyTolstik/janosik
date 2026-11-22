import { randomUUID } from "node:crypto";
import http from "node:http";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { BoardAction, CommentDto } from "@janosik/shared";

import { AppModule } from "@/app.module";
import { ADMIN_JWT_AUDIENCE, ADMIN_TOKEN_TYPE } from "@/admin/admin.types";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { securityStamp } from "@/auth/security-stamp";
import { env } from "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "1856-share-owner@example.com";
const MASTER_EMAIL = "1856-share-master@example.com";

jest.setTimeout(60_000);

/**
 * TASK-185.6 public-share SSE acceptance (§3.2/§3.6).
 *
 * A live share with `includeComments` announces comment changes by id only:
 * the frame keeps the public allowlist, carries `commentId` and the
 * transitional `detail`, and never text, revisions, actor/token/session/agent
 * attribution or a master id. Commands still travel through the sanitized
 * projection, including catch-up and resync. With comments off, no activity
 * frame crosses at all.
 */
describe("Public share comment SSE (TASK-185.6, e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const jwt = new JwtService({ secret: env.JWT_SECRET });

  let owner: { token: string; id: string };
  let masterToken: string;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    const address = app.getHttpServer().address();
    baseUrl =
      typeof address === "object" && address !== null
        ? `http://127.0.0.1:${address.port}`
        : "http://127.0.0.1";
    await wipeAll(prisma);

    owner = await createUser(OWNER_EMAIL, "Share owner");
    const master = await prisma.adminUser.create({
      data: {
        email: MASTER_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: "unused",
      },
    });
    masterToken = await jwt.signAsync(
      { sub: master.id, typ: ADMIN_TOKEN_TYPE },
      { audience: ADMIN_JWT_AUDIENCE },
    );
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  async function createUser(
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const user = await prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date() },
    });
    const token = await jwt.signAsync(
      {
        sub: user.id,
        authMethod: "password",
        stamp: securityStamp(user),
        sid: randomUUID(),
      },
      { audience: USER_JWT_AUDIENCE },
    );
    return { token, id: user.id };
  }

  async function newBoard(prefix: string): Promise<{
    boardId: string;
    cardId: string;
  }> {
    const board = await server()
      .post("/api/v1/boards")
      .set(auth(owner.token))
      .send({ title: `Share history ${prefix}` })
      .expect(201);
    const boardId = board.body.id as string;
    const columnId = `col-share-${prefix}`;
    const cardId = `card-share-${prefix}`;
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Shared",
    });
    return { boardId, cardId };
  }

  async function command(
    boardId: string,
    action: Record<string, unknown>,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(owner.token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action } as BoardAction,
      })
      .expect(200);
  }

  async function createShare(
    boardId: string,
    body: Record<string, unknown>,
  ): Promise<{ token: string; id: string }> {
    return (
      await server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(owner.token))
        .send(body)
        .expect(201)
    ).body;
  }

  async function createComment(
    cardId: string,
    text: string,
    token = owner.token,
  ): Promise<CommentDto> {
    return (
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(token))
        .send({ text, kind: "note" })
        .expect(201)
    ).body as CommentDto;
  }

  async function createWorkerToken(): Promise<string> {
    return (
      await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(owner.token))
        .send({
          name: `share-worker-${randomUUID()}`,
          expiresAt: null,
          scopePreset: "worker",
          trustedCi: false,
        })
        .expect(201)
    ).body.token as string;
  }

  async function startAgentSession(
    boardId: string,
    token: string,
  ): Promise<string> {
    return (
      await server()
        .post(`/api/v1/boards/${boardId}/agent-sessions`)
        .set(auth(token))
        .send({ name: "history-agent" })
        .expect(201)
    ).body.id as string;
  }

  interface Stream {
    frames: Array<Record<string, unknown> & { type?: string }>;
    waitFor: (
      predicate: (
        frame: Record<string, unknown> & { type?: string },
      ) => boolean,
      timeoutMs?: number,
    ) => Promise<Record<string, unknown> & { type?: string }>;
    close: () => void;
  }

  function openStream(path: string): Stream {
    const frames: Stream["frames"] = [];
    let buffer = "";
    const req = http.get(
      `${baseUrl}${path}`,
      { headers: { Accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          throw new Error(`SSE status ${res.statusCode ?? 0}`);
        }
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          for (;;) {
            const end = buffer.indexOf("\n\n");
            if (end === -1) break;
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "" || data === "ping") continue;
              frames.push(JSON.parse(data) as Record<string, unknown>);
            }
          }
        });
      },
    );
    req.on("error", () => undefined);
    return {
      frames,
      waitFor: async (predicate, timeoutMs = 8_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const found = frames.find(predicate);
          if (found !== undefined) return found;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(
          `frame not seen; got ${JSON.stringify(frames.slice(-5))}`,
        );
      },
      close: () => req.destroy(),
    };
  }

  it("announces add, PAT/agent edit and author/master delete by id only", async () => {
    const { boardId, cardId } = await newBoard("allow");
    const share = await createShare(boardId, {
      mode: "live",
      includeComments: true,
    });
    const payload = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    const worker = await createWorkerToken();
    const sessionId = await startAgentSession(boardId, worker);
    const stream = openStream(
      `/api/v1/share/${share.token}/events?since=${payload.body.seq as number}`,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));

      const comment = await createComment(cardId, "Public secret body");
      const added = await stream.waitFor(
        (frame) => frame.type === "activity" && frame.kind === "comment_added",
      );
      expect(Object.keys(added).sort()).toEqual([
        "at",
        "boardId",
        "cardId",
        "commentId",
        "detail",
        "id",
        "kind",
        "type",
      ]);
      expect(added.commentId).toBe(comment.id);
      expect(added.detail).toBe(comment.id);

      await server()
        .patch(`/api/v1/comments/${comment.id}`)
        .set({ ...auth(worker), "X-Agent-Session": sessionId })
        .send({ text: "Public edited body" })
        .expect(200);
      const updated = await stream.waitFor(
        (frame) =>
          frame.type === "activity" && frame.kind === "comment_updated",
      );
      expect(updated.commentId).toBe(comment.id);
      expect(updated.detail).toBe(comment.id);

      const authorFrames = stream.frames.filter(
        (frame) =>
          frame.type === "activity" && frame.kind === "comment_deleted",
      );
      await server()
        .delete(`/api/v1/comments/${comment.id}`)
        .set(auth(owner.token))
        .expect(200);
      await stream.waitFor(
        (frame) =>
          frame.type === "activity" && frame.kind === "comment_deleted",
      );
      expect(
        stream.frames.filter(
          (frame) =>
            frame.type === "activity" && frame.kind === "comment_deleted",
        ).length,
      ).toBe(authorFrames.length + 1);

      const masterComment = await createComment(cardId, "Master removed");
      await stream.waitFor(
        (frame) =>
          frame.type === "activity" &&
          frame.kind === "comment_added" &&
          frame.commentId === masterComment.id,
      );
      await server()
        .delete(`/api/v1/admin/comments/${masterComment.id}`)
        .set(auth(masterToken))
        .expect(200);
      const masterDeleted = await stream.waitFor(
        (frame) =>
          frame.type === "activity" &&
          frame.kind === "comment_deleted" &&
          frame.commentId === masterComment.id,
      );
      expect(masterDeleted.actorId).toBeUndefined();
      expect(masterDeleted.apiTokenId).toBeUndefined();
      expect(masterDeleted.agentSessionId).toBeUndefined();
      expect(masterDeleted.agentName).toBeUndefined();
      expect(masterDeleted.revisionId).toBeUndefined();

      const wire = JSON.stringify(stream.frames);
      expect(wire).not.toContain("Public secret body");
      expect(wire).not.toContain("Public edited body");
      expect(wire).not.toContain(worker);
      expect(wire).not.toContain(sessionId);
      expect(wire).not.toContain("history-agent");
      expect(wire).not.toContain(owner.id);
      expect(wire).not.toContain("revisionId");
      expect(wire).not.toContain("actorId");
    } finally {
      stream.close();
      await server()
        .delete(`/api/v1/boards/${boardId}/shares/${share.id}`)
        .set(auth(owner.token))
        .expect(200);
      await server()
        .post(`/api/v1/boards/${boardId}/agent-sessions/${sessionId}/end`)
        .set(auth(worker))
        .expect(201)
        .catch(() => undefined);
    }
  });

  it("does not send activity frames when the share has comments off", async () => {
    const { boardId, cardId } = await newBoard("off");
    const share = await createShare(boardId, {
      mode: "live",
      includeComments: false,
    });
    const payload = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    const stream = openStream(
      `/api/v1/share/${share.token}/events?since=${payload.body.seq as number}`,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const comment = await createComment(cardId, "Hidden from the public");
      await command(boardId, { type: "RENAME_BOARD", title: "Renamed share" });
      // A command still proves the stream is live; no comment activity may
      // cross while the flag is off.
      await stream.waitFor(
        (frame) =>
          frame.type === "command" &&
          (frame.action as { type?: string } | undefined)?.type ===
            "RENAME_BOARD",
      );
      expect(comment.id).toBeTruthy();
      expect(stream.frames.some((frame) => frame.type === "activity")).toBe(
        false,
      );
    } finally {
      stream.close();
      await server()
        .delete(`/api/v1/boards/${boardId}/shares/${share.id}`)
        .set(auth(owner.token))
        .expect(200);
    }
  });

  it("projects command catch-up and answers an unknown baseline with resync", async () => {
    const { boardId } = await newBoard("catchup");
    const share = await createShare(boardId, { mode: "live" });
    const payload = await server()
      .get(`/api/v1/share/${share.token}`)
      .expect(200);
    await command(boardId, { type: "RENAME_BOARD", title: "Caught up" });
    const catchup = openStream(
      `/api/v1/share/${share.token}/events?since=${payload.body.seq as number}`,
    );
    try {
      const frame = await catchup.waitFor(
        (entry) =>
          entry.type === "command" &&
          (entry.action as { type?: string } | undefined)?.type ===
            "RENAME_BOARD",
      );
      expect(Object.keys(frame).sort()).toEqual([
        "action",
        "seq",
        "touches",
        "type",
      ]);
      const action = frame.action as Record<string, unknown>;
      expect(action).toMatchObject({
        type: "RENAME_BOARD",
        title: "Caught up",
        boardId,
      });
      expect(JSON.stringify(frame)).not.toContain("actorId");
      expect(JSON.stringify(frame)).not.toContain("commandId");
    } finally {
      catchup.close();
    }

    const resync = openStream(
      `/api/v1/share/${share.token}/events?since=999999999`,
    );
    try {
      expect(await resync.waitFor((frame) => frame.type === "resync")).toEqual({
        type: "resync",
      });
    } finally {
      resync.close();
      await server()
        .delete(`/api/v1/boards/${boardId}/shares/${share.id}`)
        .set(auth(owner.token))
        .expect(200);
    }
  });
});
