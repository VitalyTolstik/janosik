import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  Board,
  BoardAction,
  BoardSummary,
  CommandResponse,
} from "@janosik/shared";
import { boardReducer } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";

const ADMIN_EMAIL = "board-level-admin@example.com";
const MEMBER_EMAIL = "board-level-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * Board-level commands and per-entity preconditions (TASK-29 §7.0).
 *
 * `RENAME_BOARD` stays collaborative (ADMIN/MEMBER), while
 * archive/unarchive are ADMIN-only inside the service; `ifMatchVersions`
 * refuses an undo whose text entity a foreign writer has moved on, and a
 * replayed `commandId` always returns the stored result.
 */
describe("Board-level commands (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;

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
    memberToken = await register(MEMBER_EMAIL, "Member");
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let clock = 1_700_000_000_000;
  const tick = () => (clock += 1000);
  const scoped = (
    boardId: string,
    body: Record<string, unknown>,
  ): BoardAction =>
    ({ boardId, at: tick(), ...body }) as unknown as BoardAction;

  function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function createBoard(
    title: string,
    token = adminToken,
  ): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth(token))
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

  function postCommand(
    boardId: string,
    action: BoardAction,
    token = adminToken,
    extras: {
      commandId?: string;
      ifMatch?: number;
      ifMatchVersions?: Record<string, number>;
    } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: extras.commandId ?? randomUUID(),
        action,
        ...(extras.ifMatch !== undefined ? { ifMatch: extras.ifMatch } : {}),
        ...(extras.ifMatchVersions
          ? { ifMatchVersions: extras.ifMatchVersions }
          : {}),
      });
  }

  async function apply(
    boardId: string,
    action: BoardAction,
    token = adminToken,
    extras: {
      commandId?: string;
      ifMatch?: number;
      ifMatchVersions?: Record<string, number>;
    } = {},
  ): Promise<CommandResponse> {
    const res = await postCommand(boardId, action, token, extras).expect(200);
    return res.body as CommandResponse;
  }

  async function getAggregate(
    boardId: string,
    token = adminToken,
  ): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(token))
      .expect(200);
    return res.body as Board;
  }

  async function listBoards(token: string): Promise<BoardSummary[]> {
    const res = await server()
      .get("/api/v1/boards")
      .set(auth(token))
      .expect(200);
    return res.body as BoardSummary[];
  }

  /** Apply a board-level command and assert `GET /boards/:id` == reducer. */
  async function applyAndAssert(
    boardId: string,
    action: BoardAction,
    token = adminToken,
  ): Promise<Board> {
    const before = await getAggregate(boardId);
    const expected = boardReducer([before], action, {
      withActivity: false,
    })[0];
    await apply(boardId, action, token);
    const after = await getAggregate(boardId);
    expect(stripAttribution(after)).toEqual(stripAttribution(expected));
    return after;
  }

  describe("RENAME_BOARD", () => {
    it("lets a MEMBER rename and reports the caller's role in GET /boards", async () => {
      const boardId = await createBoard("Original title");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);

      const after = await applyAndAssert(
        boardId,
        scoped(boardId, { type: "RENAME_BOARD", title: "Renamed by member" }),
        memberToken,
      );
      expect(after.title).toBe("Renamed by member");

      const adminEntry = (await listBoards(adminToken)).find(
        (board) => board.id === boardId,
      );
      expect(adminEntry).toMatchObject({
        id: boardId,
        title: "Renamed by member",
        role: "ADMIN",
        counters: expect.objectContaining({
          cards: expect.any(Number),
          columns: expect.any(Number),
        }),
      });

      const memberEntry = (await listBoards(memberToken)).find(
        (board) => board.id === boardId,
      );
      expect(memberEntry).toMatchObject({
        id: boardId,
        title: "Renamed by member",
        role: "MEMBER",
      });
    });

    it("rejects a blank title with 400 and field action.title", async () => {
      const boardId = await createBoard("Blank rename board");
      const res = await postCommand(
        boardId,
        scoped(boardId, { type: "RENAME_BOARD", title: "   " }),
      ).expect(400);
      expect(res.body.field).toBe("action.title");
    });
  });

  describe("ARCHIVE_BOARD / UNARCHIVE_BOARD", () => {
    it("is ADMIN-only and toggles archivedAt in GET /boards", async () => {
      const boardId = await createBoard("Archive board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);

      await postCommand(
        boardId,
        scoped(boardId, { type: "ARCHIVE_BOARD" }),
        memberToken,
      ).expect(403);
      await postCommand(
        boardId,
        scoped(boardId, { type: "UNARCHIVE_BOARD" }),
        memberToken,
      ).expect(403);

      const archived = await applyAndAssert(
        boardId,
        scoped(boardId, { type: "ARCHIVE_BOARD" }),
      );
      expect(archived.archivedAt).toEqual(expect.any(Number));

      const archivedEntry = (await listBoards(adminToken)).find(
        (board) => board.id === boardId,
      );
      expect(archivedEntry?.archivedAt).toEqual(archived.archivedAt);

      const row = await prisma.board.findUnique({ where: { id: boardId } });
      expect(row?.archivedAt?.getTime()).toBe(archived.archivedAt);

      const active = await applyAndAssert(
        boardId,
        scoped(boardId, { type: "UNARCHIVE_BOARD" }),
      );
      expect(active.archivedAt).toBeUndefined();

      const activeEntry = (await listBoards(adminToken)).find(
        (board) => board.id === boardId,
      );
      expect(activeEntry?.archivedAt).toBeUndefined();
    });

    it("keeps the board readable and re-archivable after unarchive", async () => {
      const boardId = await createBoard("Toggle board");
      await applyAndAssert(boardId, scoped(boardId, { type: "ARCHIVE_BOARD" }));
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "UNARCHIVE_BOARD" }),
      );
      const again = await applyAndAssert(
        boardId,
        scoped(boardId, { type: "ARCHIVE_BOARD" }),
      );
      expect(again.archivedAt).toEqual(expect.any(Number));
    });
  });

  describe("ifMatchVersions", () => {
    it("refuses a stale text entity, accepts the current one and keeps LWW without the map", async () => {
      const boardId = await createBoard("Preconditions board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-pre",
          title: "Todo",
        }),
      );
      const addedCard = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-pre",
          columnId: "col-pre",
          title: "Draft",
        }),
      );
      const cardVersion = addedCard.versions["card:card-pre"];
      expect(cardVersion).toEqual(expect.any(Number));

      const update = scoped(boardId, {
        type: "UPDATE_CARD",
        cardId: "card-pre",
        title: "Edited",
        description: "sync text",
      });

      const stale = await postCommand(boardId, update, adminToken, {
        ifMatchVersions: { "card:card-pre": cardVersion + 1 },
      }).expect(409);
      expect(stale.body).toEqual({
        conflict: "version",
        currentVersion: addedCard.seq,
      });

      const ok = await apply(boardId, update, adminToken, {
        ifMatchVersions: { "card:card-pre": cardVersion },
      });
      expect(ok.seq).toBeGreaterThan(addedCard.seq);
      expect(ok.versions["card:card-pre"]).toBe(cardVersion + 1);

      // The version now moved: the same precondition is stale again.
      const staleAgain = await postCommand(boardId, update, adminToken, {
        ifMatchVersions: { "card:card-pre": cardVersion },
      }).expect(409);
      expect(staleAgain.body.conflict).toBe("version");

      // Without the map the positional/content change stays last-write-wins.
      const lww = await apply(
        boardId,
        scoped(boardId, {
          type: "UPDATE_CARD",
          cardId: "card-pre",
          title: "LWW title",
        }),
      );
      expect(lww.seq).toBeGreaterThan(ok.seq);
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards["card-pre"].title).toBe("LWW title");
    });

    it("checks a board:<id> precondition and rejects bad keys/values with 400", async () => {
      const boardId = await createBoard("Board version board");
      const added = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-bv",
          title: "Todo",
        }),
      );
      const boardVersion = added.versions[`board:${boardId}`];
      expect(boardVersion).toEqual(expect.any(Number));

      const rename = scoped(boardId, {
        type: "RENAME_BOARD",
        title: "Renamed with precondition",
      });
      const renamed = await apply(boardId, rename, adminToken, {
        ifMatchVersions: { [`board:${boardId}`]: boardVersion },
      });
      expect(renamed.versions[`board:${boardId}`]).toBe(boardVersion + 1);

      const stale = await postCommand(
        boardId,
        scoped(boardId, { type: "RENAME_BOARD", title: "Too late" }),
        adminToken,
        { ifMatchVersions: { [`board:${boardId}`]: boardVersion } },
      ).expect(409);
      expect(stale.body).toEqual({
        conflict: "version",
        currentVersion: renamed.seq,
      });

      const unknown = await postCommand(boardId, rename, adminToken, {
        ifMatchVersions: { "widget:w1": 1 },
      }).expect(400);
      expect(unknown.body.field).toBe("ifMatchVersions");

      const fractional = await postCommand(boardId, rename, adminToken, {
        ifMatchVersions: { "card:whatever": 1.5 },
      }).expect(400);
      expect(fractional.body.field).toBe("ifMatchVersions");
    });
  });

  describe("idempotency", () => {
    it("replays a stored commandId even when the preconditions mismatch", async () => {
      const boardId = await createBoard("Replay board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-replay",
          title: "Todo",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-replay",
          columnId: "col-replay",
          title: "Draft",
        }),
      );

      const commandId = randomUUID();
      const action = scoped(boardId, {
        type: "UPDATE_CARD",
        cardId: "card-replay",
        title: "First edit",
      });
      const first = await apply(boardId, action, adminToken, { commandId });

      const replay = await postCommand(boardId, action, adminToken, {
        commandId,
        ifMatch: 0,
        ifMatchVersions: { "card:card-replay": 999 },
      }).expect(200);
      expect(replay.body).toEqual(first);

      const commands = await prisma.command.findMany({ where: { boardId } });
      expect(commands.filter((row) => row.id === commandId)).toHaveLength(1);
    });
  });

  async function wipe(db: PrismaService): Promise<void> {
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
    await db.apiToken.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
