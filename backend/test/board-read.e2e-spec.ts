import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { rm } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import type { BoardAggregate } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import {
  BOARD_READ_LIMITS,
  type BoardReadLimits,
} from "@/common/board-read.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardsService } from "@/boards/boards.service";
import { MaintenanceService } from "@/ops/maintenance.service";

const OWNER_EMAIL = "board-read-owner@example.com";
const MEMBER_EMAIL = "board-read-member@example.com";
const VIEWER_EMAIL = "board-read-viewer@example.com";
const OUTSIDER_EMAIL = "board-read-outsider@example.com";
const PASSWORD = "correct horse battery";

const TEST_LIMITS: BoardReadLimits = {
  maxConcurrent: 1,
  queueMax: 0,
  waitMs: 1_000,
  timeoutMs: 5_000,
  retryAfterSeconds: 1,
  compressMinBytes: 1024,
};

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * TASK-200.6: the full board read's transport and concurrency contract.
 *
 * Only one application instance is used. Its semaphore is deliberately
 * configured to one slot and zero waiters: identical requests still coalesce
 * in single-flight, while the backpressure spec can hold the slot with one
 * representation and prove a different representation gets a polite 503.
 */
describe("Board read: compression, ETag, single-flight (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let boards: BoardsService;
  let maintenance: MaintenanceService;
  let baseUrl: string;
  let ownerToken: string;
  let memberToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let ownerId: string;
  let memberId: string;
  let boardId: string;
  let cardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BOARD_READ_LIMITS)
      .useValue(TEST_LIMITS)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    boards = app.get(BoardsService);
    maintenance = app.get(MaintenanceService);
    await wipe(prisma);

    ownerToken = await register(OWNER_EMAIL, "Owner");
    memberToken = await register(MEMBER_EMAIL, "Member");
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");
    ownerId = await userIdOf(OWNER_EMAIL);
    memberId = await userIdOf(MEMBER_EMAIL);

    const created = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Board reads", template: "starter" })
      .expect(201);
    boardId = created.body.id as string;
    const starter = created.body as BoardAggregate;
    cardId =
      Object.values(starter.cards).find((card) => card.archivedAt === undefined)
        ?.id ?? "";
    if (cardId === "") {
      const columnId = starter.columns[0]?.id;
      if (columnId === undefined) throw new Error("Starter has no column");
      cardId = "read-card";
      await command({
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Read card",
      });
    }

    await invite(boardId, MEMBER_EMAIL, "MEMBER");
    await accept(await invitationId(memberToken), memberToken);
    await invite(boardId, VIEWER_EMAIL, "VIEWER");
    await accept(await invitationId(viewerToken), viewerToken);
  });

  afterAll(async () => {
    await wipe(prisma);
    // Attachment blobs bypass the DB wipe; this suite uploads one file.
    await rm(path.join(process.cwd(), "data"), {
      recursive: true,
      force: true,
    });
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function invite(
    board: string,
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${board}/members`)
      .set(auth(ownerToken))
      .send({ email, role })
      .expect(201);
  }

  async function invitationId(token: string): Promise<string> {
    const res = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const row = (res.body as Array<{ id: string; boardId: string }>).find(
      (entry) => entry.boardId === boardId,
    );
    if (!row) throw new Error("No invitation found");
    return row.id;
  }

  async function accept(id: string, token: string): Promise<void> {
    await server()
      .post(`/api/v1/invitations/${id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  async function userIdOf(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return user.id;
  }

  async function command(
    action: Record<string, unknown>,
    token = ownerToken,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  function identity(ifNoneMatch?: string): Promise<RawResponse> {
    return rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
      ...(ifNoneMatch === undefined ? {} : { "If-None-Match": ifNoneMatch }),
    });
  }

  function bodyOf(response: RawResponse): BoardAggregate {
    return JSON.parse(response.body.toString("utf8")) as BoardAggregate;
  }

  async function revision(): Promise<bigint> {
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { aggregateRevision: true },
    });
    return board.aggregateRevision;
  }

  /** One raw GET so compressed bytes and hop-by-hop headers stay observable. */
  function rawGet(
    path: string,
    token: string,
    headers: Record<string, string> = {},
  ): Promise<RawResponse> {
    const url = new URL(`${baseUrl}${path}`);
    return new Promise<RawResponse>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("negotiates gzip and Brotli, keeps one weak ETag and Vary", async () => {
    const plain = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
    });
    expect(plain.status).toBe(200);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]{32}"$/);
    expect(plain.headers.vary).toMatch(/Accept-Encoding/i);
    expect(plain.headers["cache-control"]).toBe("private, no-store");
    expect(Number(plain.headers["x-board-seq"])).toBeGreaterThan(0);

    const gzip = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "gzip",
    });
    expect(gzip.status).toBe(200);
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gzip.headers.etag).toBe(plain.headers.etag);
    expect(Number(gzip.headers["content-length"])).toBe(gzip.body.byteLength);
    expect(gunzipSync(gzip.body).equals(plain.body)).toBe(true);

    const brotli = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "br, gzip",
    });
    expect(brotli.status).toBe(200);
    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(brotli.headers.etag).toBe(plain.headers.etag);
    expect(brotliDecompressSync(brotli.body).equals(plain.body)).toBe(true);
  });

  it("does not compress a tiny board response but still sets Vary", async () => {
    const tiny = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Tiny" })
      .expect(201);
    const response = await rawGet(
      `/boards/${tiny.body.id as string}`,
      ownerToken,
      {
        "Accept-Encoding": "gzip, br",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers.vary).toMatch(/Accept-Encoding/i);
    expect(Number(response.headers["content-length"])).toBe(
      response.body.byteLength,
    );
  });

  it("never compresses the streaming SSE route", async () => {
    const url = new URL(`${baseUrl}/boards/${boardId}/events`);
    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
              Authorization: `Bearer ${ownerToken}`,
              Accept: "text/event-stream",
              "Accept-Encoding": "gzip, br",
            },
          },
          resolve,
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(response.headers["content-encoding"]).toBeUndefined();
    response.destroy();
  });

  it("answers 304 with no body from an unchanged ETag", async () => {
    const first = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "gzip",
    });
    const etag = String(first.headers.etag);

    const unchanged = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "gzip",
      "If-None-Match": etag,
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.body.byteLength).toBe(0);
    expect(unchanged.headers.etag).toBe(etag);
    expect(unchanged.headers["x-board-seq"]).toBe(first.headers["x-board-seq"]);
    expect(unchanged.headers.vary).toMatch(/Accept-Encoding/i);
    expect(unchanged.headers["cache-control"]).toBe("private, no-store");
    expect(unchanged.headers["content-encoding"]).toBeUndefined();
  });

  it("scopes the ETag by role and never answers a foreign caller", async () => {
    const admin = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
    });
    const member = await rawGet(`/boards/${boardId}`, memberToken, {
      "Accept-Encoding": "identity",
    });
    const viewer = await rawGet(`/boards/${boardId}`, viewerToken, {
      "Accept-Encoding": "identity",
    });
    expect(member.status).toBe(200);
    expect(viewer.status).toBe(200);
    expect(
      new Set([admin.headers.etag, member.headers.etag, viewer.headers.etag])
        .size,
    ).toBe(3);

    // The guard answers before the validator: no 304 oracle for an outsider.
    const outsider = await rawGet(`/boards/${boardId}`, outsiderToken, {
      "If-None-Match": "*",
    });
    expect(outsider.status).toBe(403);
    // Express may put its own ETag on the JSON error envelope; what must not
    // exist is the board read's seq or any board content.
    expect(outsider.headers["x-board-seq"]).toBeUndefined();
    expect(outsider.body.toString("utf8")).not.toContain("Board reads");

    // A role change must invalidate the old role-scoped validator even though
    // the board bytes are the same.
    const before = await rawGet(`/boards/${boardId}`, memberToken, {
      "Accept-Encoding": "identity",
    });
    await server()
      .patch(`/api/v1/boards/${boardId}/members/${memberId}`)
      .set(auth(ownerToken))
      .send({ role: "VIEWER" })
      .expect(200);
    const after = await rawGet(`/boards/${boardId}`, memberToken, {
      "Accept-Encoding": "identity",
      "If-None-Match": String(before.headers.etag),
    });
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });

  it("rejects a stale ETag after a command (no stale CAS read)", async () => {
    const before = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
    });
    const beforeSeq = Number(before.headers["x-board-seq"]);

    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "RENAME_BOARD",
          title: "Renamed by the read suite",
        },
      })
      .expect(200);

    const after = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
      "If-None-Match": String(before.headers.etag),
    });
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(Number(after.headers["x-board-seq"])).toBeGreaterThan(beforeSeq);
    expect(
      (JSON.parse(after.body.toString("utf8")) as BoardAggregate).title,
    ).toBe("Renamed by the read suite");

    const revalidated = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
      "If-None-Match": String(after.headers.etag),
    });
    expect(revalidated.status).toBe(304);
  });

  it("invalidates the ETag on a board metadata write that does not move seq", async () => {
    const policy = await server()
      .get(`/api/v1/boards/${boardId}/agent-policy`)
      .set(auth(ownerToken))
      .expect(200);
    const before = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
    });

    await server()
      .patch(`/api/v1/boards/${boardId}/agent-policy`)
      .set(auth(ownerToken))
      .send({ policy: null, version: policy.body.version })
      .expect(200);

    const after = await rawGet(`/boards/${boardId}`, ownerToken, {
      "Accept-Encoding": "identity",
      "If-None-Match": String(before.headers.etag),
    });
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(after.headers["x-board-seq"]).toBe(before.headers["x-board-seq"]);
  });

  it("maintains one monotonic revision per Card statement and Board update", async () => {
    const cards = await prisma.card.findMany({
      where: { column: { boardId }, deletedAt: null },
      take: 2,
      select: { id: true, columnId: true },
    });
    expect(cards.length).toBeGreaterThan(0);
    const before = await revision();

    await prisma.card.updateMany({
      where: { id: { in: cards.map((card) => card.id) } },
      data: { title: "Trigger probe" },
    });
    expect(await revision()).toBe(before + 1n);

    await prisma.board.update({
      where: { id: boardId },
      data: { title: "Board reads" },
    });
    expect(await revision()).toBe(before + 2n);

    const tempId = `trigger-temp-${randomUUID()}`;
    await prisma.card.create({
      data: {
        id: tempId,
        columnId: cards[0]!.columnId,
        title: "Temporary trigger card",
        position: 99_999,
        acceptanceCriteria: [],
        definitionOfDone: [],
      },
    });
    expect(await revision()).toBe(before + 3n);

    await prisma.card.delete({ where: { id: tempId } });
    expect(await revision()).toBe(before + 4n);
  });

  it("invalidates the ETag on attachment add and delete", async () => {
    const png = readFileSync(
      path.join(__dirname, "fixtures", "sample-image.png"),
    );
    const before = await identity();
    const beforeCount = bodyOf(before).cards[cardId]?.attachmentCount ?? 0;

    const uploaded = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(ownerToken))
      .attach("file", png, { filename: "read.png", contentType: "image/png" })
      .expect(201);

    const added = await identity(String(before.headers.etag));
    expect(added.status).toBe(200);
    expect(added.headers.etag).not.toBe(before.headers.etag);
    expect(bodyOf(added).cards[cardId]?.attachmentCount).toBe(beforeCount + 1);
    expect((await identity(String(added.headers.etag))).status).toBe(304);

    await server()
      .delete(`/api/v1/attachments/${uploaded.body.id as string}`)
      .set(auth(ownerToken))
      .expect(200);

    const removed = await identity(String(added.headers.etag));
    expect(removed.status).toBe(200);
    expect(removed.headers.etag).not.toBe(added.headers.etag);
    expect(bodyOf(removed).cards[cardId]?.attachmentCount ?? 0).toBe(
      beforeCount,
    );
  });

  it("invalidates the ETag on a comment (lastActorId changes without seq)", async () => {
    const before = await identity();
    await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(ownerToken))
      .send({ text: "A comment changes the card face" })
      .expect(201);

    const after = await identity(String(before.headers.etag));
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(bodyOf(after).cards[cardId]?.lastActorId).toBe(ownerId);
    expect((await identity(String(after.headers.etag))).status).toBe(304);
  });

  it("invalidates the ETag on a direct claim release", async () => {
    await command({
      type: "CLAIM_CARD",
      cardId,
      claimedBy: ownerId,
      leaseUntil: Date.now() + 900_000,
    });
    const before = await identity();
    expect(bodyOf(before).cards[cardId]?.claimedBy).toBe(ownerId);

    // A TOKEN_REVOKED/session-end path clears the Card claim outside the
    // command loop; the Card trigger must still advance the revision.
    await prisma.card.update({
      where: { id: cardId },
      data: {
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
      },
    });

    const after = await identity(String(before.headers.etag));
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(bodyOf(after).cards[cardId]?.claimedBy).toBeUndefined();
    expect((await identity(String(after.headers.etag))).status).toBe(304);
  });

  it("invalidates the ETag when a lapsed claim is swept", async () => {
    await command({
      type: "CLAIM_CARD",
      cardId,
      claimedBy: ownerId,
      leaseUntil: Date.now() - 1_000,
    });
    const before = await identity();
    expect(bodyOf(before).cards[cardId]?.claimedBy).toBe(ownerId);

    expect(await maintenance.sweepClaims()).toBeGreaterThan(0);

    const after = await identity(String(before.headers.etag));
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(bodyOf(after).cards[cardId]?.claimedBy).toBeUndefined();
    expect(bodyOf(after).cards[cardId]?.leaseUntil).toBeUndefined();
    expect((await identity(String(after.headers.etag))).status).toBe(304);
  });

  it("invalidates the ETag on a direct admin-style card edit", async () => {
    const before = await identity();
    await prisma.card.update({
      where: { id: cardId },
      data: { title: "Admin edited card" },
    });
    const after = await identity(String(before.headers.etag));
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(bodyOf(after).cards[cardId]?.title).toBe("Admin edited card");
    expect((await identity(String(after.headers.etag))).status).toBe(304);
  });

  it("never matches an old ETag after a command-log sweep", async () => {
    const before = await identity();
    await command({ type: "RENAME_BOARD", title: "After sweep rename" });
    const changed = await identity(String(before.headers.etag));
    expect(changed.status).toBe(200);

    await prisma.command.deleteMany({ where: { boardId } });

    // The content changed since `before`, so deleting commands must not make
    // the old validator match again.
    const afterSweep = await identity(String(before.headers.etag));
    expect(afterSweep.status).toBe(200);
    expect(afterSweep.headers.etag).toBe(changed.headers.etag);
    expect(afterSweep.headers["x-board-seq"]).toBe("0");
    expect(bodyOf(afterSweep).title).toBe("After sweep rename");

    // The current revision still revalidates after the seq moved backwards.
    const unchanged = await identity(String(changed.headers.etag));
    expect(unchanged.status).toBe(304);
  });

  it("coalesces identical concurrent reads into one aggregate transaction", async () => {
    const realTransaction = prisma.$transaction.bind(prisma);
    let transactions = 0;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation((async (
      arg: unknown,
      options?: unknown,
    ) => {
      transactions += 1;
      // Keep the build open long enough for all twelve callers to join.
      await delay(150);
      return (realTransaction as (...args: unknown[]) => unknown)(arg, options);
    }) as typeof prisma.$transaction);

    try {
      const responses = await Promise.all(
        Array.from({ length: 12 }, () =>
          rawGet(`/boards/${boardId}`, ownerToken, {
            "Accept-Encoding": "identity",
          }),
        ),
      );
      expect(responses.every((response) => response.status === 200)).toBe(true);
      for (const response of responses) {
        expect(
          (JSON.parse(response.body.toString("utf8")) as BoardAggregate).id,
        ).toBe(boardId);
      }
      expect(transactions).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("answers a polite 503 with Retry-After when the read slot is busy", async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    const real = boards.getAggregateWithSeq.bind(boards);
    const spy = jest
      .spyOn(boards, "getAggregateWithSeq")
      .mockImplementation(async (id: string, tx?: Prisma.TransactionClient) => {
        started.resolve();
        await gate.promise;
        return real(id, tx);
      });

    try {
      const first = rawGet(`/boards/${boardId}`, ownerToken, {
        "Accept-Encoding": "identity",
      });
      await started.promise;

      const refused = await rawGet(`/boards/${boardId}`, ownerToken, {
        "Accept-Encoding": "gzip",
      });
      expect(refused.status).toBe(503);
      expect(refused.headers["retry-after"]).toBe("1");
      expect(
        (JSON.parse(refused.body.toString("utf8")) as { code: string }).code,
      ).toBe("board_read_busy");

      gate.resolve();
      const completed = await first;
      expect(completed.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.commentRevision.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.apiToken.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
