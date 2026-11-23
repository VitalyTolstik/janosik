import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ActivityFeedEntry,
  ActivityFeedPage,
  Board,
  BoardAction,
  BoardSseEvent,
  CommandResponse,
  CommentDto,
  CommentPage,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { LIMITS } from "@janosik/shared";

const ADMIN_EMAIL = "activity-admin@example.com";
const MEMBER_EMAIL = "activity-member@example.com";
const VIEWER_EMAIL = "activity-viewer@example.com";
const STRANGER_EMAIL = "activity-stranger@example.com";
const PASSWORD = "correct horse battery";

/**
 * Activity feeds + comments (TASK-28 §7.4).
 *
 * Feeds merge the Command log with `Activity` rows (membership/comments) by
 * time: every mutating command shows up with the real actor, membership
 * events carry an email/role snapshot, and pagination walks the composite
 * cursor without gaps or repeats. Comments are plain REST with a
 * `LIMITS.comment` bound; only the author deletes.
 */
describe("Activity & comments API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let memberToken: string;
  let memberId: string;
  let viewerToken: string;
  let strangerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    ({ token: adminToken, id: adminId } = await register(ADMIN_EMAIL, "Admin"));
    ({ token: memberToken, id: memberId } = await register(
      MEMBER_EMAIL,
      "Member",
    ));
    ({ token: viewerToken } = await register(VIEWER_EMAIL, "Viewer"));
    ({ token: strangerToken } = await register(STRANGER_EMAIL, "Stranger"));
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Near the server clock: commands outside its ±5 min skew window get
  // their `at` replaced (B-5), which would break the reducer contract.
  let clock = Date.now() - 120_000;
  const tick = () => (clock += 100);
  const scoped = (
    boardId: string,
    body: Record<string, unknown>,
  ): BoardAction =>
    ({ boardId, at: tick(), ...body }) as unknown as BoardAction;

  async function register(
    email: string,
    displayName: string,
  ): Promise<{ token: string; id: string }> {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return {
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
    };
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(adminToken))
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  /**
   * Invite then accept (TASK-35 addendum): invitations are opt-in, so a
   * test that needs a real member must walk through the accept step.
   */
  async function invite(
    boardId: string,
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER",
    inviteeToken: string,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(adminToken))
      .send({ email, role })
      .expect(201);
    const list = await server()
      .get("/api/v1/invitations")
      .set(auth(inviteeToken))
      .expect(200);
    const invitation = list.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(inviteeToken))
      .expect(200);
  }

  async function apply(
    boardId: string,
    action: BoardAction,
    token = adminToken,
  ): Promise<CommandResponse> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId: randomUUID(), action })
      .expect(200);
    return res.body as CommandResponse;
  }

  async function boardFeed(
    boardId: string,
    query = "",
    token = adminToken,
  ): Promise<ActivityFeedPage> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}/activity${query}`)
      .set(auth(token))
      .expect(200);
    return res.body as ActivityFeedPage;
  }

  async function cardFeed(
    cardId: string,
    query = "",
    token = adminToken,
  ): Promise<ActivityFeedPage> {
    const res = await server()
      .get(`/api/v1/cards/${cardId}/activity${query}`)
      .set(auth(token))
      .expect(200);
    return res.body as ActivityFeedPage;
  }

  /** A board with one column and one card, created through commands. */
  async function boardWithCard(title: string, prefix: string) {
    const boardId = await createBoard(title);
    await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
    await invite(boardId, VIEWER_EMAIL, "VIEWER", viewerToken);
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: `col-${prefix}`,
        title: "Todo",
      }),
    );
    await apply(
      boardId,
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: `card-${prefix}`,
        columnId: `col-${prefix}`,
        title: "Card",
      }),
    );
    return { boardId, cardId: `card-${prefix}` };
  }

  /** A live attachment row without writing a blob: search reads metadata. */
  async function addAttachment(
    boardId: string,
    cardId: string,
    fileName: string,
    overrides: { isInline?: boolean; descriptionDetached?: boolean } = {},
  ): Promise<string> {
    const row = await prisma.attachment.create({
      data: {
        cardId,
        boardId,
        fileName,
        storedName: `stored-${randomUUID()}`,
        mimeType: "application/pdf",
        sizeBytes: 12,
        uploadedById: adminId,
        ...overrides,
      },
    });
    return row.id;
  }

  describe("board feed", () => {
    it("shows every mutating command with its actor and merges membership events", async () => {
      const boardId = await createBoard("Feed board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      const first = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-feed",
          title: "Todo",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-feed",
          columnId: "col-feed",
          title: "Card",
        }),
        memberToken,
      );

      const page = await boardFeed(boardId);
      const commands = page.items.filter((entry) => entry.source === "command");
      expect(commands.map((entry) => entry.type)).toEqual([
        "ADD_CARD",
        "ADD_COLUMN",
      ]);
      const addColumn = commands.find((entry) => entry.type === "ADD_COLUMN");
      expect(addColumn?.actorId).toBe(adminId);
      expect(addColumn?.seq).toBe(first.seq);
      expect(addColumn?.cardId).toBeUndefined();
      const addCard = commands.find((entry) => entry.type === "ADD_CARD");
      expect(addCard?.actorId).toBe(memberId);
      expect(addCard?.cardId).toBe("card-feed");

      const invited = page.items.find(
        (entry) => entry.type === "member_invited",
      );
      expect(invited?.source).toBe("activity");
      expect(invited?.actorId).toBe(adminId);
      expect(invited?.details).toMatchObject({
        email: MEMBER_EMAIL,
        role: "MEMBER",
      });

      // Role change and removal are activity rows too.
      const target = await prisma.boardMember.findUniqueOrThrow({
        where: { boardId_userId: { boardId, userId: memberId } },
      });
      await server()
        .patch(`/api/v1/boards/${boardId}/members/${memberId}`)
        .set(auth(adminToken))
        .send({ role: "VIEWER" })
        .expect(200);
      const afterRole = await boardFeed(boardId);
      const roleChanged = afterRole.items.find(
        (entry) => entry.type === "member_role_changed",
      );
      expect(roleChanged?.details).toMatchObject({
        from: "MEMBER",
        to: "VIEWER",
      });

      await server()
        .patch(`/api/v1/boards/${boardId}/members/${memberId}`)
        .set(auth(adminToken))
        .send({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(200);
      const afterExpiry = await boardFeed(boardId);
      expect(
        afterExpiry.items.some(
          (entry) => entry.type === "member_expiry_changed",
        ),
      ).toBe(true);

      await server()
        .delete(`/api/v1/boards/${boardId}/members/${target.userId}`)
        .set(auth(adminToken))
        .expect(200);
      const afterRemove = await boardFeed(boardId);
      const removed = afterRemove.items.find(
        (entry) => entry.type === "member_removed",
      );
      expect(removed?.details).toMatchObject({ email: MEMBER_EMAIL });
    });

    it("paginates with the composite cursor without gaps or repeats", async () => {
      const boardId = await createBoard("Feed pagination board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      for (let index = 0; index < 3; index += 1) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_COLUMN",
            newColumnId: `col-pg-${index}`,
            title: `C${index}`,
          }),
        );
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: `card-pg-${index}`,
            columnId: `col-pg-${index}`,
            title: "Card",
          }),
          memberToken,
        );
      }

      const all = await boardFeed(boardId);
      expect(all.items.length).toBeGreaterThan(5);

      const walked: ActivityFeedEntry[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const query = cursor
          ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
          : "?limit=2";
        const page = await boardFeed(boardId, query);
        walked.push(...page.items);
        cursor = page.nextCursor;
        guard += 1;
        expect(guard).toBeLessThan(20);
      } while (cursor !== null);

      expect(walked.map((entry) => `${entry.source}:${entry.id}`)).toEqual(
        all.items.map((entry) => `${entry.source}:${entry.id}`),
      );
      // Strictly newest-first across page boundaries.
      for (let index = 1; index < walked.length; index += 1) {
        expect(walked[index - 1].at).toBeGreaterThanOrEqual(walked[index].at);
      }
    });

    it("rejects a malformed cursor and an out-of-range limit", async () => {
      const boardId = await createBoard("Feed validation board");
      await server()
        .get(`/api/v1/boards/${boardId}/activity?cursor=nonsense`)
        .set(auth(adminToken))
        .expect(400);
      await server()
        .get(`/api/v1/boards/${boardId}/activity?limit=0`)
        .set(auth(adminToken))
        .expect(400);
      await server()
        .get(`/api/v1/boards/${boardId}/activity?limit=1000`)
        .set(auth(adminToken))
        .expect(400);
      await server()
        .get(`/api/v1/boards/${boardId}/activity?cursor=1:c:1&limit=2`)
        .set(auth(adminToken))
        .expect(200);
      // A command cursor's key is a numeric seq — a text key must be a 400,
      // not a BigInt() SyntaxError surfacing as 500 (TASK-153).
      await server()
        .get(`/api/v1/boards/${boardId}/activity?cursor=1:c:not-a-seq`)
        .set(auth(adminToken))
        .expect(400);
      // TASK-156: `bigint`/Date overflow is a 400 here, never a database 500.
      await server()
        .get(
          `/api/v1/boards/${boardId}/activity?cursor=1:c:9223372036854775808`,
        )
        .set(auth(adminToken))
        .expect(400);
      await server()
        .get(`/api/v1/boards/${boardId}/activity?cursor=8640000000000001:a:x`)
        .set(auth(adminToken))
        .expect(400);
    });
  });

  describe("card feed", () => {
    it("keeps only the commands that touched the card", async () => {
      const { boardId, cardId } = await boardWithCard("Card feed board", "cf");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-cf-2",
          title: "B",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "UPDATE_CARD",
          cardId,
          title: "Edited",
        }),
        memberToken,
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_LABEL",
          label: { id: "l-cf", name: "Bug", color: "red" },
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId,
          labelId: "l-cf",
          on: true,
        }),
        memberToken,
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-cf-2",
          columnId: "col-cf-2",
          title: "Other",
        }),
      );

      const page = await cardFeed(cardId);
      const types = page.items.map((entry) => entry.type);
      expect(types).toContain("ADD_CARD");
      expect(types).toContain("UPDATE_CARD");
      expect(types).toContain("SET_CARD_LABEL");
      expect(types).not.toContain("ADD_LABEL");
      // The second card's ADD_CARD does not touch the first card.
      const cardEntries = page.items.filter(
        (entry) => entry.cardId === "card-cf-2" && entry.type === "ADD_CARD",
      );
      expect(cardEntries).toHaveLength(0);
      const edited = page.items.find((entry) => entry.type === "UPDATE_CARD");
      expect(edited?.actorId).toBe(memberId);
      expect(edited?.cardId).toBe(cardId);
      // The display diff frozen at apply time (TASK-37): the history feed
      // renders "Card → Edited" without replaying anything.
      expect(edited?.changes).toEqual([
        { field: "title", from: "Card", to: "Edited" },
      ]);
      const labelled = page.items.find(
        (entry) => entry.type === "SET_CARD_LABEL",
      );
      expect(labelled?.detail).toBe("Bug");
      expect(labelled?.changes).toEqual([
        { field: "label", from: null, to: "Bug" },
      ]);
    });

    it("403s a stranger, 404s an unknown card and lets a VIEWER read", async () => {
      const { cardId } = await boardWithCard("Card feed access", "ca");
      await cardFeed(cardId, "", viewerToken);
      await server()
        .get(`/api/v1/cards/${cardId}/activity`)
        .set(auth(strangerToken))
        .expect(403);
      await server()
        .get("/api/v1/cards/unknown-card/activity")
        .set(auth(adminToken))
        .expect(404);
    });
  });

  describe("comments", () => {
    it("creates, lists newest-first, paginates and deletes with feed events", async () => {
      const { boardId, cardId } = await boardWithCard("Comments board", "cm");

      const first = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "  First comment  " })
        .expect(201);
      expect(first.body).toMatchObject({
        cardId,
        authorId: memberId,
        text: "First comment",
      });
      expect(first.body.createdAt).toEqual(expect.any(Number));
      const second = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "Second comment" })
        .expect(201);
      const third = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Third comment" })
        .expect(201);

      const all = await server()
        .get(`/api/v1/cards/${cardId}/comments`)
        .set(auth(viewerToken))
        .expect(200);
      const ids = (all.body as CommentPage).items.map(
        (comment: CommentDto) => comment.id,
      );
      expect(ids).toEqual([third.body.id, second.body.id, first.body.id]);

      // Walk page by page with limit=1.
      const walked: string[] = [];
      let cursor: string | null = null;
      do {
        const query = cursor
          ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
          : "?limit=1";
        const res = await server()
          .get(`/api/v1/cards/${cardId}/comments${query}`)
          .set(auth(memberToken))
          .expect(200);
        walked.push(...(res.body.items as CommentDto[]).map((c) => c.id));
        cursor = res.body.nextCursor as string | null;
      } while (cursor !== null);
      expect(new Set(walked).size).toBe(3);

      // Comment events land in the card activity feed, the text riding as
      // the Jira-style diff (added: null → text) with the id in `detail`.
      const feed = await cardFeed(cardId);
      const added = feed.items.filter(
        (entry) => entry.type === "comment_added",
      );
      expect(added).toHaveLength(3);
      expect(added[0].actorId).toBe(memberId);
      expect(added[0].details).toBeUndefined();
      expect(added[0].changes).toEqual([
        { field: "comment", from: null, to: "Third comment" },
      ]);

      // Deleting writes comment_deleted and empties the list for that id.
      await server()
        .delete(`/api/v1/comments/${second.body.id}`)
        .set(auth(adminToken))
        .expect(200);
      const afterDelete = await server()
        .get(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .expect(200);
      expect((afterDelete.body.items as CommentDto[]).map((c) => c.id)).toEqual(
        [third.body.id, first.body.id],
      );
      const afterFeed = await cardFeed(cardId);
      const deleted = afterFeed.items.find(
        (entry) => entry.type === "comment_deleted",
      );
      expect(deleted?.details).toBeUndefined();
      expect(deleted?.detail).toBeUndefined();
      expect(deleted?.changes).toBeUndefined();
      expect(JSON.stringify(deleted)).not.toContain("Second comment");

      // The board feed sees them too, but scoped to the board.
      const boardPage = await boardFeed(boardId);
      expect(
        boardPage.items.filter((entry) => entry.type === "comment_added"),
      ).toHaveLength(3);

      // A comment re-attributes the card face (TASK-36): the commenter
      // becomes Card.lastActorId, matching the live SSE stamp on clients.
      const aggregate = await server()
        .get(`/api/v1/boards/${boardId}`)
        .set(auth(adminToken))
        .expect(200);
      expect((aggregate.body as Board).cards[cardId].lastActorId).toBe(
        memberId,
      );
    });

    it("is idempotent on a repeated commandId (TASK-99)", async () => {
      const { cardId } = await boardWithCard("Idempotent comments", "idem");
      const commandId = randomUUID();

      const first = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Only once", commandId })
        .expect(201);
      const retry = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Only once", commandId })
        .expect(201);
      expect(retry.body.id).toBe(first.body.id);

      const page = await server()
        .get(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .expect(200);
      expect((page.body as CommentPage).items).toHaveLength(1);
    });

    it("refuses another author's commandId (TASK-153)", async () => {
      const { cardId } = await boardWithCard("Comment key scope", "ck");
      const commandId = randomUUID();
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Mine", commandId })
        .expect(201);

      // The key belongs to that author alone; a probe by another member is a
      // conflict, not a replay of someone else's comment.
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "Mine", commandId })
        .expect(409);
    });

    it("refuses a commandId already used on another card (TASK-156)", async () => {
      const { boardId, cardId } = await boardWithCard(
        "Comment card scope",
        "cc",
      );
      const otherCardId = "card-cc-other";
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: otherCardId,
          columnId: "col-cc",
          title: "Other card",
          atIndex: 1,
        }),
      );
      const commandId = randomUUID();
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Only here", commandId })
        .expect(201);

      // Same author, same key, different card: a collision, not a replay.
      await server()
        .post(`/api/v1/cards/${otherCardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Only here", commandId })
        .expect(409);
    });

    it("lets only the author delete and only writers comment", async () => {
      const { cardId } = await boardWithCard("Comment roles board", "cr");
      const created = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Mine" })
        .expect(201);

      // A VIEWER cannot write, another writer cannot delete.
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(viewerToken))
        .send({ text: "Nope" })
        .expect(403);
      await server()
        .delete(`/api/v1/comments/${created.body.id}`)
        .set(auth(adminToken))
        .expect(403);

      await server()
        .delete(`/api/v1/comments/${created.body.id}`)
        .set(auth(memberToken))
        .expect(200);
      await server()
        .delete(`/api/v1/comments/${created.body.id}`)
        .set(auth(memberToken))
        .expect(404);
    });

    it("guards the plain-text bound", async () => {
      const { cardId } = await boardWithCard("Comment limits board", "cl");
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "   " })
        .expect(400);
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "x".repeat(LIMITS.comment + 1) })
        .expect(400);
      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "x".repeat(LIMITS.comment) })
        .expect(201);
    });
  });

  describe("comment editing (TASK-176.2)", () => {
    it("lets the author edit the text, keeps the kind and records activity + SSE", async () => {
      const { boardId, cardId } = await boardWithCard("Edit comments", "ed");
      const created = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "First draft", kind: "blocker" })
        .expect(201);
      expect(created.body.editedAt).toBeUndefined();

      const realtime = app.get(RealtimeService);
      const events: BoardSseEvent[] = [];
      const subscription = realtime.watch(boardId).subscribe((event) => {
        events.push(event);
      });
      try {
        const edited = await server()
          .patch(`/api/v1/comments/${created.body.id as string}`)
          .set(auth(memberToken))
          .send({ text: "  Edited text  " })
          .expect(200);

        expect(edited.body).toMatchObject({
          id: created.body.id,
          cardId,
          authorId: memberId,
          text: "Edited text",
          kind: "blocker",
          actorType: "human",
          createdAt: created.body.createdAt,
        });
        expect(edited.body.editedAt).toEqual(expect.any(Number));

        const page = await server()
          .get(`/api/v1/cards/${cardId}/comments`)
          .set(auth(viewerToken))
          .expect(200);
        expect((page.body as CommentPage).items[0]).toMatchObject({
          id: created.body.id,
          text: "Edited text",
          kind: "blocker",
          editedAt: edited.body.editedAt,
        });

        const feed = await cardFeed(cardId);
        const updated = feed.items.find(
          (entry) => entry.type === "comment_updated",
        );
        expect(updated?.actorId).toBe(memberId);
        expect(updated?.details).toBeUndefined();
        expect(updated?.detail).toBeUndefined();
        expect(updated?.changes).toEqual([
          { field: "comment", from: "First draft", to: "Edited text" },
        ]);

        // The live stream carries the ids; the body comes from the list.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const frame = events.find(
          (event) =>
            event.type === "activity" &&
            event.kind === "comment_updated" &&
            event.commentId === created.body.id,
        );
        expect(frame).toMatchObject({
          boardId,
          cardId,
          actorId: memberId,
          kind: "comment_updated",
          commentId: created.body.id,
          revisionId: expect.any(String),
          detail: created.body.id,
        });
      } finally {
        subscription.unsubscribe();
      }
    });

    it("lets the author retype the kind without a text revision and filters by it", async () => {
      const { cardId } = await boardWithCard("Edit comment kind", "ek");
      const created = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Needs a decision", kind: "note" })
        .expect(201);
      expect(created.body.kind).toBe("note");

      const edited = await server()
        .patch(`/api/v1/comments/${created.body.id as string}`)
        .set(auth(memberToken))
        .send({ kind: "question" })
        .expect(200);
      expect(edited.body).toMatchObject({
        id: created.body.id,
        text: "Needs a decision",
        kind: "question",
      });
      // TASK-185.1: `editedAt` belongs to a text edit, not to a kind change.
      expect(edited.body.editedAt).toBeUndefined();

      const filtered = await server()
        .get(`/api/v1/cards/${cardId}/comments?kind=question`)
        .set(auth(memberToken))
        .expect(200);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0]).toMatchObject({
        id: created.body.id,
        kind: "question",
      });
      const notes = await server()
        .get(`/api/v1/cards/${cardId}/comments?kind=note`)
        .set(auth(memberToken))
        .expect(200);
      expect(notes.body.items).toEqual([]);

      const feed = await cardFeed(cardId);
      const updated = feed.items.find(
        (entry) => entry.type === "comment_updated",
      );
      expect(updated?.details).toBeUndefined();
      expect(updated?.detail).toBeUndefined();
      expect(updated?.changes).toBeUndefined();
      const revisions = await prisma.commentRevision.count({
        where: { commentId: created.body.id as string },
      });
      expect(revisions).toBe(0);
    });

    it("updates text and kind together and keeps an omitted field", async () => {
      const { cardId } = await boardWithCard("Edit both fields", "eb");
      const created = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Original", kind: "note" })
        .expect(201);
      const commentId = created.body.id as string;

      const both = await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: "Now blocked", kind: "blocker" })
        .expect(200);
      expect(both.body).toMatchObject({
        text: "Now blocked",
        kind: "blocker",
        editedAt: expect.any(Number),
      });

      const textOnly = await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: "Still blocked" })
        .expect(200);
      expect(textOnly.body).toMatchObject({
        text: "Still blocked",
        kind: "blocker",
      });

      const kindOnly = await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ kind: "evidence" })
        .expect(200);
      expect(kindOnly.body).toMatchObject({
        text: "Still blocked",
        kind: "evidence",
      });
    });

    it("rejects a non-author, a deleted comment and invalid text", async () => {
      const { cardId } = await boardWithCard("Edit guards", "eg");
      const created = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(memberToken))
        .send({ text: "Mine" })
        .expect(201);
      const commentId = created.body.id as string;

      // Another writer (even an ADMIN) cannot edit someone else's comment.
      const forbidden = await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(adminToken))
        .send({ text: "Hijacked" })
        .expect(403);
      expect(forbidden.body.code).toBe("scope_denied");

      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(viewerToken))
        .send({ text: "Viewer edit" })
        .expect(403);

      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: "   " })
        .expect(400);
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: "x".repeat(LIMITS.comment + 1) })
        .expect(400);
      // TASK-177.11: at least one field is required, and the kind is checked.
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({})
        .expect(400);
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ kind: "nonsense" })
        .expect(400);
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: null })
        .expect(400);
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ kind: null })
        .expect(400);
      // A non-author cannot retype the kind either.
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(adminToken))
        .send({ kind: "blocker" })
        .expect(403);

      await server()
        .delete(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .expect(200);
      await server()
        .patch(`/api/v1/comments/${commentId}`)
        .set(auth(memberToken))
        .send({ text: "After delete" })
        .expect(404);
    });
  });

  describe("comment kinds and board search (TASK-157)", () => {
    it("defaults to note, stores a kind, filters by it and rejects an unknown one", async () => {
      const { cardId } = await boardWithCard("Kind board", "kd");
      const note = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "just a note" })
        .expect(201);
      expect(note.body.kind).toBe("note");

      const blocker = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "stuck", kind: "blocker" })
        .expect(201);
      expect(blocker.body.kind).toBe("blocker");

      const onlyBlockers = await server()
        .get(`/api/v1/cards/${cardId}/comments?kind=blocker`)
        .set(auth(adminToken))
        .expect(200);
      expect(onlyBlockers.body.items).toHaveLength(1);
      expect(onlyBlockers.body.items[0].kind).toBe("blocker");

      await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "huh", kind: "nonsense" })
        .expect(400);
      await server()
        .get(`/api/v1/cards/${cardId}/comments?kind=nonsense`)
        .set(auth(adminToken))
        .expect(400);
    });

    it("searches a board across title, checklist item, comment text and attachment names", async () => {
      const { boardId, cardId } = await boardWithCard("Search board", "sr");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId,
          newChecklistId: "cl-sr",
          title: "DoD",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId,
          checklistId: "cl-sr",
          newItemId: "item-sr",
          text: "run the widget migration",
        }),
      );
      const comment = await server()
        .post(`/api/v1/cards/${cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "the widget is flaky" })
        .expect(201);
      const attachmentId = await addAttachment(
        boardId,
        cardId,
        "quarterly-report.pdf",
      );

      const byTitle = await server()
        .get(`/api/v1/boards/${boardId}/search?q=card`)
        .set(auth(memberToken))
        .expect(200);
      expect(byTitle.body.cardIds).toContain(cardId);
      expect(byTitle.body.matches).toContainEqual({
        cardId,
        matchIn: "title",
      });

      const byChecklist = await server()
        .get(`/api/v1/boards/${boardId}/search?q=widget%20migration`)
        .set(auth(memberToken))
        .expect(200);
      expect(byChecklist.body.cardIds).toContain(cardId);
      expect(byChecklist.body.matches).toContainEqual(
        expect.objectContaining({
          cardId,
          matchIn: "checklist",
          text: expect.stringContaining("widget migration"),
        }),
      );

      const byComment = await server()
        .get(`/api/v1/boards/${boardId}/search?q=flaky`)
        .set(auth(memberToken))
        .expect(200);
      expect(byComment.body.cardIds).toContain(cardId);
      expect(byComment.body.matches).toEqual([
        {
          cardId,
          matchIn: "comment",
          commentId: comment.body.id,
          text: expect.stringContaining("flaky"),
        },
      ]);

      const byAttachment = await server()
        .get(`/api/v1/boards/${boardId}/search?q=quarterly`)
        .set(auth(memberToken))
        .expect(200);
      expect(byAttachment.body.cardIds).toContain(cardId);
      expect(byAttachment.body.matches).toEqual([
        {
          cardId,
          matchIn: "attachment",
          attachmentId,
          text: "quarterly-report.pdf",
        },
      ]);

      // The board filter asks for ids only; cardIds stays complete.
      const idsOnly = await server()
        .get(`/api/v1/boards/${boardId}/search?q=flaky&includeMatches=0`)
        .set(auth(memberToken))
        .expect(200);
      expect(idsOnly.body.cardIds).toContain(cardId);
      expect(idsOnly.body.matches).toEqual([]);

      // Hidden uploads cannot be revealed in the card's attachment list.
      await addAttachment(boardId, cardId, "hidden-inline.pdf", {
        isInline: true,
      });
      await addAttachment(boardId, cardId, "hidden-detached.pdf", {
        descriptionDetached: true,
      });
      const hidden = await server()
        .get(`/api/v1/boards/${boardId}/search?q=hidden`)
        .set(auth(memberToken))
        .expect(200);
      expect(hidden.body.cardIds).toEqual([]);
      const hiddenWorkspace = await server()
        .get("/api/v1/boards/search?q=hidden")
        .set(auth(memberToken))
        .expect(200);
      expect(hiddenWorkspace.body.matches).toEqual([]);

      // Cross-board palette endpoint: comment/attachment rows only, scoped
      // to live memberships.
      const workspace = await server()
        .get("/api/v1/boards/search?q=flaky")
        .set(auth(memberToken))
        .expect(200);
      expect(workspace.body.matches).toEqual([
        expect.objectContaining({
          boardId,
          boardTitle: "Search board",
          cardId,
          cardTitle: "Card",
          matchIn: "comment",
          commentId: comment.body.id,
        }),
      ]);
      expect(workspace.body.total).toBe(1);
      expect(workspace.body.truncated).toBe(false);
      const outsider = await server()
        .get("/api/v1/boards/search?q=flaky")
        .set(auth(strangerToken))
        .expect(200);
      expect(outsider.body).toEqual({
        matches: [],
        total: 0,
        truncated: false,
      });

      // TASK-200.9: the read model hides description/checklist text, so the
      // palette's single cross-board request also matches those fields.
      const content = await boardWithCard("Palette content", "content");
      await apply(
        content.boardId,
        scoped(content.boardId, {
          type: "UPDATE_CARD",
          cardId: content.cardId,
          description: "The hero mockups are ready",
        }),
      );
      await apply(
        content.boardId,
        scoped(content.boardId, {
          type: "ADD_CHECKLIST",
          cardId: content.cardId,
          newChecklistId: "cl-content",
          title: "DoD",
        }),
      );
      await apply(
        content.boardId,
        scoped(content.boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: content.cardId,
          checklistId: "cl-content",
          newItemId: "item-content",
          text: "run the widget migration",
        }),
      );
      const byDescription = await server()
        .get("/api/v1/boards/search?q=mockups")
        .set(auth(memberToken))
        .expect(200);
      expect(byDescription.body.matches).toContainEqual(
        expect.objectContaining({
          boardId: content.boardId,
          cardId: content.cardId,
          matchIn: "description",
          text: expect.stringContaining("mockups"),
        }),
      );
      expect(byDescription.body.total).toBeGreaterThanOrEqual(1);
      const byChecklistText = await server()
        .get("/api/v1/boards/search?q=widget%20migration")
        .set(auth(memberToken))
        .expect(200);
      expect(byChecklistText.body.matches).toContainEqual(
        expect.objectContaining({
          boardId: content.boardId,
          cardId: content.cardId,
          matchIn: "checklist",
          text: expect.stringContaining("widget migration"),
        }),
      );
      expect(byChecklistText.body.total).toBeGreaterThanOrEqual(1);

      // Repeated query parameters are ambiguous, not a single string.
      await server()
        .get(`/api/v1/boards/${boardId}/search?q=a&q=b`)
        .set(auth(memberToken))
        .expect(400);
      await server()
        .get("/api/v1/boards/search?q=a&q=b")
        .set(auth(memberToken))
        .expect(400);

      const miss = await server()
        .get(`/api/v1/boards/${boardId}/search?q=zzzznope`)
        .set(auth(memberToken))
        .expect(200);
      expect(miss.body.cardIds).toEqual([]);
      expect(miss.body.matches).toEqual([]);

      // A deleted comment and a deleted attachment stop matching.
      await server()
        .delete(`/api/v1/comments/${comment.body.id}`)
        .set(auth(adminToken))
        .expect(200);
      await prisma.attachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });
      const afterDelete = await server()
        .get(`/api/v1/boards/${boardId}/search?q=flaky`)
        .set(auth(memberToken))
        .expect(200);
      expect(afterDelete.body.cardIds).toEqual([]);
      const attachmentGone = await server()
        .get(`/api/v1/boards/${boardId}/search?q=quarterly`)
        .set(auth(memberToken))
        .expect(200);
      expect(attachmentGone.body.cardIds).toEqual([]);

      // A soft-deleted card disappears with its outside-the-aggregate text.
      const deleted = await boardWithCard("Search deletes", "sdel");
      await server()
        .post(`/api/v1/cards/${deleted.cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "vanishing needle" })
        .expect(201);
      await apply(
        deleted.boardId,
        scoped(deleted.boardId, {
          type: "DELETE_CARD",
          cardId: deleted.cardId,
        }),
      );
      const cardGone = await server()
        .get(`/api/v1/boards/${deleted.boardId}/search?q=vanishing`)
        .set(auth(adminToken))
        .expect(200);
      expect(cardGone.body.cardIds).toEqual([]);

      await server()
        .get(`/api/v1/boards/${boardId}/search?q=card`)
        .set(auth(strangerToken))
        .expect(403);
    });

    it("marks a saturated board match list incomplete without losing cardIds", async () => {
      const { boardId, cardId } = await boardWithCard(
        "Saturated explanation",
        "expl",
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-expl-2",
          columnId: "col-expl",
          title: "Second card",
        }),
      );
      await prisma.comment.createMany({
        data: Array.from({ length: 200 }, (_, index) => ({
          cardId,
          authorId: adminId,
          text: `explainneedle ${index}`,
        })),
      });
      const older = new Date(Date.now() - 60_000);
      await prisma.comment.create({
        data: {
          cardId: "card-expl-2",
          authorId: adminId,
          text: "explainneedle second card",
          createdAt: older,
          updatedAt: older,
        },
      });
      const attachmentId = await addAttachment(
        boardId,
        "card-expl-2",
        "explainneedle-proof.pdf",
      );

      const detailed = await server()
        .get(`/api/v1/boards/${boardId}/search?q=explainneedle`)
        .set(auth(adminToken))
        .expect(200);
      expect(detailed.body.cardIds).toEqual(
        expect.arrayContaining([cardId, "card-expl-2"]),
      );
      expect(detailed.body.matchesTotal).toBe(3);
      expect(detailed.body.matchesTruncated).toBe(true);
      expect(detailed.body.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cardId: "card-expl-2",
            matchIn: "attachment",
            attachmentId,
          }),
        ]),
      );

      const idsOnly = await server()
        .get(
          `/api/v1/boards/${boardId}/search?q=explainneedle&includeMatches=0`,
        )
        .set(auth(adminToken))
        .expect(200);
      expect(idsOnly.body.cardIds).toEqual(
        expect.arrayContaining([cardId, "card-expl-2"]),
      );
      expect(idsOnly.body.matches).toEqual([]);
      expect(idsOnly.body.matchesTotal).toBe(0);
      expect(idsOnly.body.matchesTruncated).toBe(false);
    });

    it("scopes the workspace search to a board-scoped PAT", async () => {
      const first = await boardWithCard("Pat scope A", "pat-a");
      const second = await boardWithCard("Pat scope B", "pat-b");
      for (const board of [first, second]) {
        await server()
          .post(`/api/v1/cards/${board.cardId}/comments`)
          .set(auth(adminToken))
          .send({ text: "patneedle in a comment" })
          .expect(201);
      }
      const created = await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(adminToken))
        .send({
          name: "search-scope",
          boardId: first.boardId,
          scopePreset: "admin",
          expiresAt: null,
        })
        .expect(201);
      const scopedToken = created.body.token as string;

      const result = await server()
        .get("/api/v1/boards/search?q=patneedle")
        .set(auth(scopedToken))
        .expect(200);
      expect(result.body.matches).toHaveLength(1);
      expect(result.body.matches[0].boardId).toBe(first.boardId);
    });

    it("omits a soft-deleted board from the workspace search", async () => {
      const gone = await boardWithCard("Deleted search board", "gone");
      await server()
        .post(`/api/v1/cards/${gone.cardId}/comments`)
        .set(auth(adminToken))
        .send({ text: "goneboardneedle" })
        .expect(201);
      await server()
        .delete(`/api/v1/boards/${gone.boardId}`)
        .set(auth(adminToken))
        .expect(200);

      const result = await server()
        .get("/api/v1/boards/search?q=goneboardneedle")
        .set(auth(adminToken))
        .expect(200);
      expect(result.body).toEqual({
        matches: [],
        total: 0,
        truncated: false,
      });
    });

    it("dedupes comments per card before the workspace cap", async () => {
      const { boardId, cardId } = await boardWithCard("Saturated", "sat");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-sat-2",
          columnId: "col-sat",
          title: "Second card",
        }),
      );
      await prisma.comment.createMany({
        data: Array.from({ length: 200 }, (_, index) => ({
          cardId,
          authorId: adminId,
          text: `saturneedle ${index}`,
        })),
      });
      const older = new Date(Date.now() - 60_000);
      await prisma.comment.create({
        data: {
          cardId: "card-sat-2",
          authorId: adminId,
          text: "saturneedle older",
          createdAt: older,
          updatedAt: older,
        },
      });

      const result = await server()
        .get("/api/v1/boards/search?q=saturneedle")
        .set(auth(adminToken))
        .expect(200);
      expect(result.body.total).toBe(2);
      expect(result.body.truncated).toBe(false);
      expect(
        new Set(
          (result.body.matches as Array<{ cardId: string }>).map(
            (match) => match.cardId,
          ),
        ),
      ).toEqual(new Set([cardId, "card-sat-2"]));
    });

    it("caps the workspace matches and reports the complete total", async () => {
      const { boardId } = await boardWithCard("Cap board", "cap");
      const cardIds = Array.from(
        { length: 201 },
        (_, index) => `cap-card-${index}`,
      );
      await prisma.card.createMany({
        data: cardIds.map((id, index) => ({
          id,
          columnId: "col-cap",
          title: `Cap card ${index}`,
          position: index + 1,
        })),
      });
      await prisma.attachment.createMany({
        data: cardIds.map((cardId, index) => ({
          cardId,
          boardId,
          fileName: `capneedle-${index}.pdf`,
          storedName: `cap-stored-${index}-${randomUUID()}`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          uploadedById: adminId,
        })),
      });

      const result = await server()
        .get("/api/v1/boards/search?q=capneedle")
        .set(auth(adminToken))
        .expect(200);
      expect(result.body.matches).toHaveLength(200);
      expect(result.body.total).toBe(201);
      expect(result.body.truncated).toBe(true);
    });
  });

  describe("watch feed (TASK-157)", () => {
    it("omits a command that changed nothing from the board feed", async () => {
      const { boardId, cardId } = await boardWithCard("No-op board", "no");
      // Renaming the card to its own title changes nothing: the reducer is a
      // no-op, so the command writes no `touches` and must not appear.
      await apply(
        boardId,
        scoped(boardId, { type: "UPDATE_CARD", cardId, title: "Card" }),
      );
      const quiet = await boardFeed(boardId);
      expect(
        quiet.items.some(
          (entry) => entry.type === "UPDATE_CARD" && entry.source === "command",
        ),
      ).toBe(false);

      // A real change still lands.
      await apply(
        boardId,
        scoped(boardId, { type: "UPDATE_CARD", cardId, title: "Renamed" }),
      );
      const loud = await boardFeed(boardId);
      expect(loud.items.some((entry) => entry.type === "UPDATE_CARD")).toBe(
        true,
      );
    });

    it("gives a membership change a diff, not a bare line", async () => {
      const boardId = await createBoard("Membership feed board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      const invited = await boardFeed(boardId);
      const inviteEntry = invited.items.find(
        (entry) => entry.type === "member_invited",
      );
      expect(inviteEntry?.detail).toBe(MEMBER_EMAIL);

      await server()
        .patch(`/api/v1/boards/${boardId}/members/${memberId}`)
        .set(auth(adminToken))
        .send({ role: "ADMIN" })
        .expect(200);
      const after = await boardFeed(boardId);
      const roleChange = after.items.find(
        (entry) => entry.type === "member_role_changed",
      );
      expect(roleChange?.changes?.[0]).toMatchObject({
        field: "role",
        from: "MEMBER",
        to: "ADMIN",
      });
    });
  });

  describe("delta catch-up", () => {
    it("returns only commands newer than since — no aggregate refetch needed", async () => {
      const { boardId } = await boardWithCard("Delta board", "dl");
      const applied = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-dl-extra",
          title: "Extra",
        }),
      );
      const res = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${applied.seq - 1}`)
        .set(auth(memberToken))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].seq).toBe(applied.seq);
      expect(res.body[0].action.type).toBe("ADD_COLUMN");
    });
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
    await db.apiToken.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
