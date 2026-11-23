import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  BoardReadyDto,
  BoardsReadyDto,
  ReadyCardDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import {
  READY_POLL_MAX_PER_USER,
  ReadyPollAdmission,
  ReadyService,
} from "@/boards/ready.service";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const ADMIN_EMAIL = "ready-admin@example.com";
const VIEWER_EMAIL = "ready-viewer@example.com";
const OUTSIDER_EMAIL = "ready-outsider@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-200.2 — server-side ready/work endpoint and long-poll.
 *
 * Covers the wire shape, limit/first-column filtering, claim/assignee/archive
 * rules, archived boards and VIEWER access, plus a real long-poll wake, a
 * timeout (`204`) and the `since` change cursor. Query-count proof lives in
 * the unit suite (`ready.service.spec.ts`) where Prisma is observable.
 */
describe("Ready/work endpoint (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let adminId: string;
  let boardId: string;
  let emptyBoardId: string;
  let archivedBoardId: string;
  let holdBoardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    adminToken = await register(ADMIN_EMAIL, "Admin");
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
    outsiderToken = await register(OUTSIDER_EMAIL, "Outsider");
    adminId = await me(adminToken);

    boardId = await createBoard("Ready board");
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: "col-2",
      title: "Doing",
    });
    for (const [id, title] of [
      ["card-blocker", "Blocker task"],
      ["card-high", "High task"],
      ["card-medium", "Medium task"],
      ["card-low", "Low task"],
      ["card-lapsed", "Lapsed claim"],
      ["card-archived", "Archived task"],
      ["card-assigned", "Assigned task"],
      ["card-claimed", "Claimed task"],
      ["card-blocked", "Blocked task"],
      ["card-source", "Blocking source"],
      ["card-other-column", "Not the first column"],
    ] as const) {
      await command(boardId, {
        type: "ADD_CARD",
        newCardId: id,
        columnId: id === "card-other-column" ? "col-2" : "col-1",
        title,
      });
    }

    const now = Date.now();
    await prisma.card.update({
      where: { id: "card-blocker" },
      data: { priority: "blocker" },
    });
    await prisma.card.update({
      where: { id: "card-high" },
      data: {
        priority: "high",
        description: "secret body",
      },
    });
    await prisma.card.update({
      where: { id: "card-low" },
      data: { priority: "low" },
    });
    await prisma.card.update({
      where: { id: "card-archived" },
      data: { archivedAt: new Date() },
    });
    await prisma.card.update({
      where: { id: "card-assigned" },
      data: { assigneeId: adminId },
    });
    await prisma.card.update({
      where: { id: "card-claimed" },
      data: {
        claimedBy: adminId,
        leaseUntil: new Date(now + 60_000),
      },
    });
    await prisma.card.update({
      where: { id: "card-lapsed" },
      data: {
        claimedBy: adminId,
        leaseUntil: new Date(now - 60_000),
      },
    });
    // A live, non-ready source card still blocks its target.
    await prisma.card.update({
      where: { id: "card-source" },
      data: { assigneeId: adminId },
    });
    await prisma.cardLink.create({
      data: {
        id: "link-blocked",
        boardId,
        fromCardId: "card-source",
        toCardId: "card-blocked",
        type: "blocks",
        position: 0,
      },
    });

    await invite(viewerToken, boardId, VIEWER_EMAIL, "VIEWER");

    emptyBoardId = await createBoard("Empty board");
    await command(emptyBoardId, {
      type: "ADD_COLUMN",
      newColumnId: "empty-col",
      title: "Backlog",
    });

    holdBoardId = await createBoard("Hold board");
    await command(holdBoardId, {
      type: "ADD_COLUMN",
      newColumnId: "hold-col",
      title: "Backlog",
    });

    archivedBoardId = await createBoard("Archived board");
    await command(archivedBoardId, {
      type: "ADD_COLUMN",
      newColumnId: "archived-col",
      title: "Todo",
    });
    await command(archivedBoardId, {
      type: "ADD_CARD",
      newCardId: "archived-card",
      columnId: "archived-col",
      title: "Still here",
    });
    await command(archivedBoardId, { type: "ARCHIVE_BOARD" });
  });

  afterAll(async () => {
    await wipe(prisma);
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

  async function me(token: string): Promise<string> {
    const res = await server()
      .get("/api/v1/auth/me")
      .set(auth(token))
      .expect(200);
    return res.body.id as string;
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  async function command(
    targetBoardId: string,
    action: Record<string, unknown>,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoardId}/commands`)
      .set(auth(adminToken))
      .send({
        commandId: randomUUID(),
        action: { boardId: targetBoardId, at: Date.now(), ...action },
      })
      .expect(200);
  }

  async function invite(
    token: string,
    targetBoardId: string,
    email: string,
    role: "VIEWER" | "MEMBER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${targetBoardId}/members`)
      .set(auth(adminToken))
      .send({ email, role })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const invitation = invitations.body.find(
      (row: { boardId: string }) => row.boardId === targetBoardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(token))
      .expect(200);
  }

  it("returns the ready summary shape, limit and first-column scope", async () => {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .query({ limit: 2 })
      .set(auth(adminToken))
      .expect(200)
      .expect("X-Board-Seq", /^\d+$/);

    const body = res.body as BoardReadyDto;
    expect(body).toMatchObject({
      boardId,
      boardTitle: "Ready board",
      archived: false,
      limit: 2,
    });
    expect(body.seq).toEqual(expect.any(Number));
    expect(res.headers["x-board-seq"]).toBe(String(body.seq));
    expect(body.cards.map((card) => card.id)).toEqual([
      "card-blocker",
      "card-high",
    ]);
    expect(body.cards[1]).toEqual({
      id: "card-high",
      title: "High task",
      boardId,
      boardTitle: "Ready board",
      columnId: "col-1",
      columnTitle: "Todo",
      priority: "high",
      claimedBy: null,
      leaseUntil: null,
      version: expect.any(Number),
      descriptionChars: "secret body".length,
    });
    // A summary, not the aggregate: no description body, labels, checklists
    // or links ever leave the endpoint.
    expect(body.cards[1]).not.toHaveProperty("description");
    expect(body.cards[1]).not.toHaveProperty("checklists");
    expect(body.cards[1]).not.toHaveProperty("labelIds");
    expect(body.cards[1]).not.toHaveProperty("links");
    expect(res.headers["x-ready-held"]).toBeUndefined();
  });

  it("excludes archived, assigned, live-claimed, blocked and other-column cards", async () => {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .set(auth(adminToken))
      .expect(200);
    const ids = (res.body as BoardReadyDto).cards.map((card) => card.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "card-blocker",
        "card-high",
        "card-medium",
        "card-low",
        "card-lapsed",
      ]),
    );
    expect(ids).not.toContain("card-archived");
    expect(ids).not.toContain("card-assigned");
    expect(ids).not.toContain("card-claimed");
    expect(ids).not.toContain("card-blocked");
    expect(ids).not.toContain("card-source");
    expect(ids).not.toContain("card-other-column");
    expect(ids).toHaveLength(5);
  });

  it("keeps descriptionChars in sync without returning the description", async () => {
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: "card-length",
      columnId: "col-1",
      title: "Length task",
    });
    const before = await readyCard("card-length");
    expect(before.descriptionChars).toBe(0);

    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: "card-length",
      description: "eight-char",
    });
    const updated = await readyCard("card-length");
    expect(updated.descriptionChars).toBe("eight-char".length);
    expect(updated).not.toHaveProperty("description");

    await prisma.card.create({
      data: {
        id: "card-insert-length",
        columnId: "col-1",
        title: "Inserted length",
        description: "inserted text",
        position: 999,
      },
    });
    try {
      const inserted = await readyCard("card-insert-length");
      expect(inserted.descriptionChars).toBe("inserted text".length);
      expect(inserted).not.toHaveProperty("description");
    } finally {
      await prisma.card.delete({ where: { id: "card-insert-length" } });
    }

    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: "card-length",
      description: "x",
    });
    expect((await readyCard("card-length")).descriptionChars).toBe(1);

    // PostgreSQL char_length counts a single emoji as one code point, unlike
    // JavaScript's UTF-16 `.length` (2). The stored contract follows the DB.
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: "card-length",
      description: "🙂",
    });
    expect((await readyCard("card-length")).descriptionChars).toBe(1);

    // Empty string clears the description to NULL; the trigger stores 0.
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: "card-length",
      description: "",
    });
    expect((await readyCard("card-length")).descriptionChars).toBe(0);
    expect(
      await prisma.card.findUnique({
        where: { id: "card-length" },
        select: { description: true, descriptionLength: true },
      }),
    ).toEqual({ description: null, descriptionLength: 0 });

    // Backfill/trigger integrity: no row lags its stored text.
    const [mismatch] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count"
      FROM "Card"
      WHERE "descriptionLength" <> COALESCE(char_length("description"), 0)
    `;
    expect(mismatch?.count).toBe(0);
  });

  it("lets a VIEWER read the summary and refuses an outsider", async () => {
    const viewer = await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .set(auth(viewerToken))
      .expect(200);
    expect((viewer.body as BoardReadyDto).cards[0]?.id).toBe("card-blocker");

    const viewerAll = await server()
      .get("/api/v1/boards/ready")
      .set(auth(viewerToken))
      .expect(200);
    expect(
      (viewerAll.body as BoardsReadyDto).boards.map((row) => row.id),
    ).toEqual([boardId]);

    await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .set(auth(outsiderToken))
      .expect(403);
    const outsiderAll = await server()
      .get("/api/v1/boards/ready")
      .set(auth(outsiderToken))
      .expect(200);
    expect((outsiderAll.body as BoardsReadyDto).boards).toEqual([]);
    expect((outsiderAll.body as BoardsReadyDto).cards).toEqual([]);
    await server()
      .get(`/api/v1/boards/${randomUUID()}/ready`)
      .set(auth(adminToken))
      .expect(404);
  });

  it("scopes a board-scoped PAT to its own board", async () => {
    const pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(adminToken))
      .send({ name: "ready-scope", boardId, scopePreset: "observer" })
      .expect(201)
      .then((res) => res.body.token as string);

    const own = await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .set(auth(pat))
      .expect(200);
    expect((own.body as BoardReadyDto).cards.map((card) => card.id)).toContain(
      "card-blocker",
    );

    await server()
      .get(`/api/v1/boards/${emptyBoardId}/ready`)
      .set(auth(pat))
      .expect(403);

    const all = await server()
      .get("/api/v1/boards/ready")
      .set(auth(pat))
      .expect(200);
    expect((all.body as BoardsReadyDto).boards.map((row) => row.id)).toEqual([
      boardId,
    ]);
  });

  it("returns archived boards as an empty, explicitly archived summary", async () => {
    const res = await server()
      .get(`/api/v1/boards/${archivedBoardId}/ready`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({
      boardId: archivedBoardId,
      archived: true,
      cards: [],
    });
  });

  it("rejects invalid limit, wait and since bounds", async () => {
    for (const query of [
      { limit: "0" },
      { limit: "101" },
      { limit: "2.5" },
      { wait: "60001" },
      { wait: "-1" },
      { since: "-1" },
    ]) {
      await server()
        .get(`/api/v1/boards/${boardId}/ready`)
        .query(query)
        .set(auth(adminToken))
        .expect(400);
    }
    for (const limit of ["0", "101", "2.5"]) {
      await server()
        .get("/api/v1/boards/ready")
        .query({ limit })
        .set(auth(adminToken))
        .expect(400);
    }
  });

  it("answers 204 after a long-poll timeout with seq and no-store", async () => {
    const started = Date.now();
    const res = await server()
      .get(`/api/v1/boards/${emptyBoardId}/ready`)
      .query({ wait: 40 })
      .set(auth(adminToken))
      .expect(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-ready-held"]).toBe("1");
    expect(Number(res.headers["x-board-seq"])).toBeGreaterThanOrEqual(0);
    expect(res.text).toBe("");
  });

  it("answers held-poll capacity as retryable backpressure", async () => {
    const admission = app.get(ReadyPollAdmission);
    const releases: Array<() => void> = [];
    try {
      for (let index = 0; index < READY_POLL_MAX_PER_USER; index += 1) {
        const release = admission.acquire(adminId, holdBoardId);
        if (release === null) throw new Error("unexpected admission refusal");
        releases.push(release);
      }
      const res = await server()
        .get(`/api/v1/boards/${holdBoardId}/ready`)
        .query({ wait: 5000 })
        .set(auth(adminToken))
        .expect(503);
      expect(res.headers["retry-after"]).toBe("5");
      expect(res.body).toMatchObject({
        code: "ready_poll_capacity",
        retryable: true,
        retryAfter: 5,
      });
    } finally {
      for (const release of releases) release();
    }
    expect(admission.active()).toBe(0);
  });

  it("wakes a long-poll when a ready card is added", async () => {
    const pending = server()
      .get(`/api/v1/boards/${emptyBoardId}/ready`)
      .query({ wait: 5000 })
      .set(auth(adminToken))
      .then((res) => res);

    await new Promise((resolve) => setTimeout(resolve, 100));
    await command(emptyBoardId, {
      type: "ADD_CARD",
      newCardId: "card-woken",
      columnId: "empty-col",
      title: "Woken task",
    });

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.headers["x-ready-held"]).toBe("1");
    const body = res.body as BoardReadyDto;
    expect(res.headers["x-board-seq"]).toBe(String(body.seq));
    expect(body.cards.map((card) => card.id)).toContain("card-woken");
  });

  it("answers immediately when since predates a relevant board change", async () => {
    const current = await server()
      .get(`/api/v1/boards/${emptyBoardId}/ready`)
      .set(auth(adminToken))
      .expect(200)
      .then((res) => res.body as BoardReadyDto);

    // Leave the board without a ready card, then bump its seq with a column
    // command: the change cursor alone must end the hold immediately.
    await prisma.card.update({
      where: { id: "card-woken" },
      data: { assigneeId: adminId },
    });
    await command(emptyBoardId, {
      type: "ADD_COLUMN",
      newColumnId: "empty-col-2",
      title: "Next",
    });

    const started = Date.now();
    const changed = await server()
      .get(`/api/v1/boards/${emptyBoardId}/ready`)
      .query({ wait: 5000, since: current.seq })
      .set(auth(adminToken))
      .expect(200);
    expect(Date.now() - started).toBeLessThan(2000);
    const body = changed.body as BoardReadyDto;
    expect(body.cards).toEqual([]);
    expect(body.seq).toBeGreaterThan(current.seq);
  });

  it("releases a held poll when the client disconnects", async () => {
    const readyService = app.get(ReadyService);
    const held = server()
      .get(`/api/v1/boards/${holdBoardId}/ready`)
      .query({ wait: 5000 })
      .set(auth(adminToken))
      .timeout({ response: 150 })
      .then((res) => res)
      .catch(() => undefined);

    await waitFor(() => readyService.activePolls() === 1);
    await held;
    await waitFor(() => readyService.activePolls() === 0);
  });

  it("answers the cross-board snapshot without per-board reads", async () => {
    const res = await server()
      .get("/api/v1/boards/ready")
      .query({ limit: 3 })
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as BoardsReadyDto;
    expect(body.boards.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([boardId, emptyBoardId, archivedBoardId]),
    );
    expect(
      body.boards.find((entry) => entry.id === archivedBoardId),
    ).toMatchObject({ archived: true });
    expect(body.cards.length).toBeLessThanOrEqual(3);
    expect(body.cards.every((card) => card.boardId !== archivedBoardId)).toBe(
      true,
    );
    // A board-scoped PAT sees only its own board; here the JWT owner sees all
    // three, including the archived summary.
    expect(body.cards.map((card) => card.id)).toContain("card-blocker");
  });

  async function readyCard(cardId: string): Promise<ReadyCardDto> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/ready`)
      .set(auth(adminToken))
      .expect(200);
    const card = (res.body as BoardReadyDto).cards.find(
      (entry) => entry.id === cardId,
    );
    if (card === undefined) throw new Error(`card ${cardId} is not ready`);
    return card;
  }

  async function waitFor(
    check: () => boolean,
    timeoutMs = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("condition not reached");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

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
    await db.apiToken.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
