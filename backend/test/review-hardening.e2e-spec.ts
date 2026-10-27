import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { sseTiming } from "@/realtime/sse-timing";

const PASSWORD = "correct horse battery";

interface Frame {
  type: string;
  seq?: number;
  commandId?: string;
  prevSeq?: number;
  action?: Record<string, unknown>;
}

/**
 * Backend review hardening (FINAL_REVIEW §2): the trust boundaries a swarm
 * of untrusted agents leans on, over real HTTP.
 *
 * - B-2 a personal API token is not the whole account;
 * - B-1 invitations need a verified mailbox; invites do not enumerate users;
 * - B-5 a forged `at` cannot backdate server timestamps or 500;
 * - idempotency: a reused commandId with another body is a 409;
 * - `ifMatchVersions` is no cross-board version oracle;
 * - B-3/commandId: the delta and the stream carry the key, and a gap that
 *   cannot be replayed is announced (`X-Delta-Resync`, `{type:"resync"}`);
 * - B-6 open streams die when access does (PAT revoked, VIEWER expired,
 *   share revoked);
 * - snapshot shares freeze comments at capture time;
 * - non-import routes no longer parse multi-megabyte JSON.
 */
describe("Review hardening (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let ownerToken: string;
  let ownerId: string;
  let boardId: string;
  const column = `col-${randomUUID()}`;
  const card = `card-${randomUUID()}`;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(
    email: string,
  ): Promise<{ token: string; id: string }> {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD })
      .expect(201);
    return { token: res.body.accessToken as string, id: res.body.user.id };
  }

  function command(
    token: string,
    board: string,
    action: Record<string, unknown>,
    commandId: string = randomUUID(),
    extra: Record<string, unknown> = {},
  ): request.Test {
    return server()
      .post(`/api/v1/boards/${board}/commands`)
      .set(auth(token))
      .send({ commandId, action, ...extra });
  }

  async function newBoard(token: string, title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(token))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function createPat(token: string, name: string): Promise<string> {
    const res = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(token))
      .send({ name, expiresAt: null })
      .expect(201);
    return res.body.token as string;
  }

  async function inviteAndAccept(
    email: string,
    token: string,
    role: "MEMBER" | "VIEWER",
    expiresAt?: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email, role, ...(expiresAt ? { expiresAt } : {}) })
      .expect(201);
    const list = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const row = (list.body as Array<{ id: string; boardId: string }>).find(
      (entry) => entry.boardId === boardId,
    );
    if (!row) throw new Error("no invitation");
    await server()
      .post(`/api/v1/invitations/${row.id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  /** Minimal SSE reader: frames by type, and "did the server end it". */
  function sse(path: string, token: string | null) {
    const controller = new AbortController();
    const opened = fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    const frames: Frame[] = [];
    let ended = false;
    const done = opened.then(async (res) => {
      if (res.status !== 200) throw new Error(`SSE status ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader
          .read()
          .catch(() => ({ done: true }) as const);
        if (chunk.done) {
          ended = true;
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut !== -1) {
          for (const line of buffer.slice(0, cut).split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload !== "ping") frames.push(JSON.parse(payload) as Frame);
          }
          buffer = buffer.slice(cut + 2);
          cut = buffer.indexOf("\n\n");
        }
      }
    });
    done.catch(() => undefined);
    const waitFor = async (
      predicate: () => boolean,
      what: string,
      timeoutMs = 8_000,
    ) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${what}: ${JSON.stringify(frames)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    return {
      frames,
      isEnded: () => ended,
      waitFor,
      close: () => controller.abort(),
    };
  }

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
    await wipe(prisma);

    const owner = await register("hardening-owner@example.com");
    ownerToken = owner.token;
    ownerId = owner.id;
    boardId = await newBoard(ownerToken, "Hardening");
    await command(ownerToken, boardId, {
      type: "ADD_COLUMN",
      newColumnId: column,
      title: "Todo",
      at: Date.now(),
    }).expect(200);
    await command(ownerToken, boardId, {
      type: "ADD_CARD",
      newCardId: card,
      columnId: column,
      title: "Card",
      at: Date.now(),
    }).expect(200);
  });

  afterAll(async () => {
    sseTiming.keepAliveMs = 25_000;
    await wipe(prisma);
    await app.close();
  });

  describe("B-2: a PAT is not the whole account", () => {
    let pat: string;

    beforeAll(async () => {
      pat = await createPat(ownerToken, "agent");
    });

    it("refuses a PAT on every credential route with a clear 403", async () => {
      const refused = [
        server().get("/api/v1/users/me/tokens").set(auth(pat)),
        server()
          .post("/api/v1/users/me/tokens")
          .set(auth(pat))
          .send({ name: "escalated", expiresAt: null }),
        server().delete("/api/v1/users/me/tokens/anything").set(auth(pat)),
        server()
          .post("/api/v1/auth/password")
          .set(auth(pat))
          .send({ currentPassword: PASSWORD, newPassword: "new password 123" }),
        server()
          .post("/api/v1/auth/email/change/request")
          .set(auth(pat))
          .send({ newEmail: "evil@example.com", currentPassword: PASSWORD }),
        server()
          .post("/api/v1/auth/email/change/confirm")
          .set(auth(pat))
          .send({ code: "123456" }),
      ];
      for (const pending of refused) {
        const res = await pending;
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("pat_forbidden");
      }
      // No key was minted through the PAT.
      const tokens = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(ownerToken))
        .expect(200);
      expect(tokens.body).toHaveLength(1);
    });

    it("still lets the PAT do board work (boards, commands, members, shares)", async () => {
      const me = await server()
        .get("/api/v1/auth/me")
        .set(auth(pat))
        .expect(200);
      expect(me.body.impersonatedBy).toBeNull();
      await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(pat))
        .expect(200);
      await command(pat, boardId, {
        type: "RENAME_COLUMN",
        columnId: column,
        title: "Todo (agent)",
        at: Date.now(),
      }).expect(200);
      await server()
        .get(`/api/v1/boards/${boardId}/members`)
        .set(auth(pat))
        .expect(200);
      await server()
        .get(`/api/v1/boards/${boardId}/shares`)
        .set(auth(pat))
        .expect(200);
    });

    it("revokes every PAT when the password changes", async () => {
      await server()
        .post("/api/v1/auth/password")
        .set(auth(ownerToken))
        .send({ currentPassword: PASSWORD, newPassword: `${PASSWORD} 2` })
        .expect(200);
      await server().get("/api/v1/auth/me").set(auth(pat)).expect(401);
      // Restore for the rest of the suite.
      await server()
        .post("/api/v1/auth/password")
        .set(auth(ownerToken))
        .send({ currentPassword: `${PASSWORD} 2`, newPassword: PASSWORD })
        .expect(200);
    });

    it("bounds a token created without expiresAt (default TTL)", async () => {
      const res = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(ownerToken))
        .send({ name: "forgetful" })
        .expect(201);
      expect(res.body.apiToken.expiresAt).toEqual(expect.any(Number));
      expect(res.body.apiToken.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("B-1 / invites", () => {
    it("answers an unknown and a known address identically, normalizing case", async () => {
      await register("hardening-known@example.com");
      const unknown = await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(ownerToken))
        .send({ email: "Nobody-Here@Example.com", role: "MEMBER" })
        .expect(201);
      const known = await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(ownerToken))
        .send({ email: "  HARDENING-KNOWN@example.com ", role: "MEMBER" })
        .expect(201);
      const shape = (body: Record<string, unknown>) => ({
        ...body,
        email: "x",
      });
      expect(shape(unknown.body)).toEqual(shape(known.body));
      expect(known.body).toMatchObject({
        userId: "",
        email: "hardening-known@example.com",
        displayName: null,
      });
      // A repeat invite of a pending invitee is not a tell-tale 409 either.
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(ownerToken))
        .send({ email: "hardening-known@example.com", role: "MEMBER" })
        .expect(201);
      const pending = await prisma.boardMember.count({
        where: { boardId, user: { email: "hardening-known@example.com" } },
      });
      expect(pending).toBe(1);
    });

    it("hides invitations from an unverified account and refuses the accept", async () => {
      const squatter = await register("hardening-unverified@example.com");
      await prisma.user.update({
        where: { id: squatter.id },
        data: { emailVerifiedAt: null },
      });
      await server()
        .post(`/api/v1/boards/${boardId}/members`)
        .set(auth(ownerToken))
        .send({ email: "hardening-unverified@example.com", role: "ADMIN" })
        .expect(201);
      const feed = await server()
        .get("/api/v1/invitations")
        .set(auth(squatter.token))
        .expect(200);
      expect(feed.body).toEqual([]);
      const row = await prisma.boardMember.findFirstOrThrow({
        where: { boardId, userId: squatter.id },
      });
      await server()
        .post(`/api/v1/invitations/${row.id}/accept`)
        .set(auth(squatter.token))
        .expect(403);
    });
  });

  describe("command endpoint", () => {
    it("B-5: clamps a forged `at` to server time (no 1970 deletedAt, no 500)", async () => {
      const victim = `card-${randomUUID()}`;
      await command(ownerToken, boardId, {
        type: "ADD_CARD",
        newCardId: victim,
        columnId: column,
        title: "Backdated",
        at: 0,
      }).expect(200);
      await command(ownerToken, boardId, {
        type: "DELETE_CARD",
        cardId: victim,
        at: 0,
      }).expect(200);
      const row = await prisma.card.findUniqueOrThrow({
        where: { id: victim },
      });
      const skew = 5 * 60 * 1000;
      expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - skew);
      expect(row.deletedAt?.getTime()).toBeGreaterThan(Date.now() - skew);

      // Far future / beyond the Date range: never an Invalid Date 500.
      await command(ownerToken, boardId, {
        type: "RENAME_COLUMN",
        columnId: column,
        title: "Future",
        at: 1e300,
      }).expect((res: request.Response) =>
        expect([200, 400]).toContain(res.status),
      );
      await command(ownerToken, boardId, {
        type: "SET_CARD_DUE_DATE",
        cardId: card,
        dueDate: 1e300,
        at: Date.now(),
      }).expect(400);
    });

    it("answers a reused commandId with a different payload with 409", async () => {
      const id = randomUUID();
      const action = {
        type: "RENAME_COLUMN",
        columnId: column,
        title: "Idempotent",
        at: Date.now(),
      };
      const first = await command(ownerToken, boardId, action, id).expect(200);
      // An honest retry (same body, later clock) replays the stored result.
      const retry = await command(
        ownerToken,
        boardId,
        { ...action, at: Date.now() + 1_000 },
        id,
      ).expect(200);
      expect(retry.body).toEqual(first.body);
      const reused = await command(
        ownerToken,
        boardId,
        { ...action, title: "Something else" },
        id,
      ).expect(409);
      expect(reused.body.field).toBe("commandId");
    });

    it("scopes ifMatchVersions to the target board (no version oracle)", async () => {
      const other = await register("hardening-other@example.com");
      const otherBoard = await newBoard(other.token, "Foreign");
      const foreign = `col-${randomUUID()}`;
      await command(other.token, otherBoard, {
        type: "ADD_COLUMN",
        newColumnId: foreign,
        title: "Secret",
        at: Date.now(),
      }).expect(200);
      // The foreign column has version 0; asking with the right value must
      // not succeed (that would confirm its version) — it reads as absent.
      const res = await command(
        ownerToken,
        boardId,
        {
          type: "RENAME_COLUMN",
          columnId: column,
          title: "Probe",
          at: Date.now(),
        },
        randomUUID(),
        { ifMatchVersions: { [`column:${foreign}`]: 0 } },
      ).expect(409);
      expect(res.body.conflict).toBe("version");
    });
  });

  describe("B-3: delta and stream carry commandId and announce gaps", () => {
    it("puts the commandId on delta entries and live SSE frames", async () => {
      const since = Number(
        (
          await server()
            .get(`/api/v1/boards/${boardId}`)
            .set(auth(ownerToken))
            .expect(200)
        ).headers["x-board-seq"],
      );
      const stream = sse(
        `/boards/${boardId}/events?since=${since}`,
        ownerToken,
      );
      // Give the stream a moment to subscribe before committing.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const id = randomUUID();
      await command(
        ownerToken,
        boardId,
        {
          type: "RENAME_COLUMN",
          columnId: column,
          title: "Live",
          at: Date.now(),
        },
        id,
      ).expect(200);
      await stream.waitFor(
        () => stream.frames.some((f) => f.type === "command"),
        "command frame",
      );
      const frame = stream.frames.find((f) => f.type === "command") as Frame;
      expect(frame.commandId).toBe(id);
      expect(frame).not.toHaveProperty("prevSeq");
      stream.close();

      const delta = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${since}`)
        .set(auth(ownerToken))
        .expect(200);
      expect(delta.headers["x-delta-resync"]).toBeUndefined();
      expect(delta.body.at(-1).commandId).toBe(id);
    });

    it("flags a baseline trimmed from the log: header on the delta, resync frame on the stream", async () => {
      const rows = await prisma.command.findMany({
        where: { boardId },
        orderBy: { seq: "asc" },
        select: { seq: true },
      });
      const trimmed = Number(rows[1].seq);
      // The retention sweep removed the client's baseline (and older rows).
      await prisma.command.deleteMany({
        where: { boardId, seq: { lte: BigInt(trimmed) } },
      });

      const delta = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${trimmed}`)
        .set(auth(ownerToken))
        .expect(200);
      expect(delta.headers["x-delta-resync"]).toBe("1");
      expect(delta.body).toEqual([]);

      const stream = sse(
        `/boards/${boardId}/events?since=${trimmed}`,
        ownerToken,
      );
      await stream.waitFor(
        () => stream.frames.some((f) => f.type === "resync"),
        "resync frame",
      );
      // …and the stream keeps going from the board's head afterwards.
      await command(ownerToken, boardId, {
        type: "RENAME_COLUMN",
        columnId: column,
        title: "After resync",
        at: Date.now(),
      }).expect(200);
      await stream.waitFor(
        () => stream.frames.some((f) => f.type === "command"),
        "command after resync",
      );
      expect(stream.frames.filter((f) => f.type === "command")).toHaveLength(1);
      stream.close();
    });
  });

  describe("B-6: open streams re-check access on the keep-alive tick", () => {
    beforeAll(() => {
      sseTiming.keepAliveMs = 300;
    });
    afterAll(() => {
      sseTiming.keepAliveMs = 25_000;
    });

    it("closes a PAT stream once the key is revoked", async () => {
      const pat = await createPat(ownerToken, "streamer");
      const stream = sse(`/boards/${boardId}/events`, pat);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(stream.isEnded()).toBe(false);
      const tokens = await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(ownerToken))
        .expect(200);
      const row = (tokens.body as Array<{ id: string; name: string }>).find(
        (t) => t.name === "streamer",
      );
      await server()
        .delete(`/api/v1/users/me/tokens/${row!.id}`)
        .set(auth(ownerToken))
        .expect(200);
      await stream.waitFor(() => stream.isEnded(), "stream end");
    });

    it("closes a time-limited VIEWER's stream when the membership expires", async () => {
      const viewer = await register("hardening-viewer@example.com");
      await inviteAndAccept(
        "hardening-viewer@example.com",
        viewer.token,
        "VIEWER",
        new Date(Date.now() + 60_000).toISOString(),
      );
      const stream = sse(`/boards/${boardId}/events`, viewer.token);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(stream.isEnded()).toBe(false);
      await prisma.boardMember.updateMany({
        where: { boardId, userId: viewer.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await stream.waitFor(() => stream.isEnded(), "stream end");
    });

    it("closes a public live-share stream once the share is revoked", async () => {
      const share = await server()
        .post(`/api/v1/boards/${boardId}/shares`)
        .set(auth(ownerToken))
        .send({ mode: "live" })
        .expect(201);
      const stream = sse(`/share/${share.body.token as string}/events`, null);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(stream.isEnded()).toBe(false);
      await prisma.boardShare.update({
        where: { id: share.body.id as string },
        data: { revokedAt: new Date() },
      });
      await stream.waitFor(() => stream.isEnded(), "stream end");
    });
  });

  it("serves a snapshot share's comments only up to the capture time", async () => {
    await server()
      .post(`/api/v1/cards/${card}/comments`)
      .set(auth(ownerToken))
      .send({ text: "before the snapshot" })
      .expect(201);
    const share = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(ownerToken))
      .send({ mode: "snapshot", includeComments: true })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await server()
      .post(`/api/v1/cards/${card}/comments`)
      .set(auth(ownerToken))
      .send({ text: "after the snapshot" })
      .expect(201);
    const page = await server()
      .get(`/api/v1/share/${share.body.token as string}/cards/${card}/comments`)
      .expect(200);
    expect(
      (page.body.items as Array<{ text: string }>).map((c) => c.text),
    ).toEqual(["before the snapshot"]);
  });

  it("caps JSON bodies outside import/commands", async () => {
    const huge = "x".repeat(400 * 1024);
    await server()
      .post("/api/v1/auth/login")
      .send({ email: "a@example.com", password: huge })
      .expect(413);
    // The command endpoint still accepts a body above the default cap (it
    // reaches validation and the per-command byte limit instead).
    const res = await command(ownerToken, boardId, {
      type: "UPDATE_CARD",
      cardId: card,
      description: "d".repeat(300 * 1024),
      at: Date.now(),
    });
    expect(res.status).not.toBe(413);
    void ownerId;
  });
});

async function wipe(db: PrismaService): Promise<void> {
  await db.boardShare.deleteMany();
  await db.attachment.deleteMany();
  await db.cardLink.deleteMany();
  await db.cardLabel.deleteMany();
  await db.checklistItem.deleteMany();
  await db.checklist.deleteMany();
  await db.comment.deleteMany();
  await db.activity.deleteMany();
  await db.command.deleteMany();
  await db.card.deleteMany();
  await db.column.deleteMany();
  await db.label.deleteMany();
  await db.boardMember.deleteMany();
  await db.board.deleteMany();
  await db.apiToken.deleteMany();
  await db.refreshToken.deleteMany();
  await db.emailVerificationCode.deleteMany();
  await db.emailChangeCode.deleteMany();
  await db.user.deleteMany();
}
