import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  Board,
  BoardAction,
  BoardEnvelope,
  CommandDeltaEntry,
  CommandResponse,
} from "@janosik/shared";
import { boardReducer } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";

const ADMIN_EMAIL = "commands-admin@example.com";
const MEMBER_EMAIL = "commands-member@example.com";
const VIEWER_EMAIL = "commands-viewer@example.com";
const PASSWORD = "correct horse battery";

/**
 * Command log for column/card actions (TASK-26 §7.4/§7.4.1).
 *
 * The core assertion is the contract test: after every command,
 * `GET /boards/:id` must deep-equal `boardReducer(before, action,
 * { withActivity: false })` — this is what keeps the per-action writers and
 * the reducer from drifting apart.
 */
describe("Commands API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;

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
    viewerToken = await register(VIEWER_EMAIL, "Viewer");
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

  function post(
    boardId: string,
    action: BoardAction,
    token = adminToken,
    commandId = randomUUID(),
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId, action });
  }

  async function apply(
    boardId: string,
    action: BoardAction,
    token = adminToken,
    commandId = randomUUID(),
  ): Promise<CommandResponse> {
    const res = await post(boardId, action, token, commandId).expect(200);
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

  /** Apply a command and assert the aggregate matches the reducer exactly. */
  async function applyAndAssert(
    boardId: string,
    action: BoardAction,
    token = adminToken,
  ): Promise<Board> {
    const before = await getAggregate(boardId, token);
    const expected = boardReducer([before], action, {
      withActivity: false,
    })[0];
    await apply(boardId, action, token).then((res) =>
      expect(res.seq).toEqual(expect.any(Number)),
    );
    const after = await getAggregate(boardId, token);
    expect(stripAttribution(after)).toEqual(stripAttribution(expected));
    return after;
  }

  describe("contract: aggregate == boardReducer", () => {
    it("walks the column and card action set", async () => {
      const boardId = await createBoard("Contract board");

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-todo",
          title: "Todo",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-doing",
          title: "Doing",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RENAME_COLUMN",
          columnId: "col-todo",
          title: "Backlog",
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-1",
          columnId: "col-todo",
          title: "First",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-2",
          columnId: "col-todo",
          title: "Second",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-3",
          columnId: "col-todo",
          title: "Third",
          atIndex: 1,
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "UPDATE_CARD",
          cardId: "card-1",
          title: "First edited",
          description: "notes",
        }),
      );
      // Quiet live edits keep `updatedAt` until TOUCH_CARD stamps it.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "UPDATE_CARD",
          cardId: "card-1",
          description: "notes live",
          quiet: true,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "TOUCH_CARD", cardId: "card-1" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_DUE_DATE",
          cardId: "card-1",
          dueDate: 1_700_500_000_000,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_PRIORITY",
          cardId: "card-1",
          priority: "blocker",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_COVER",
          cardId: "card-1",
          cover: { type: "color", value: "blue" },
        }),
      );

      // Cross-column move (WIP-free), then a same-column reorder.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "MOVE_CARD",
          cardId: "card-2",
          fromColumnId: "col-todo",
          fromIndex: 1,
          toColumnId: "col-doing",
          toIndex: 0,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "MOVE_CARD",
          cardId: "card-3",
          fromColumnId: "col-todo",
          fromIndex: 0,
          toColumnId: "col-todo",
          toIndex: 2,
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SORT_COLUMN",
          columnId: "col-todo",
          sortBy: "title",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SORT_COLUMN",
          columnId: "col-todo",
          sortBy: "createdAt",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SORT_COLUMN",
          columnId: "col-todo",
          sortBy: "dueDate",
        }),
      );

      const todo = (await getAggregate(boardId)).columns.find(
        (column) => column.id === "col-todo",
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_CARD_ORDER",
          columnId: "col-todo",
          cardIds: [...(todo?.cardIds ?? [])].reverse(),
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-doing",
          wipLimit: 3,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-doing",
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_CARD",
          cardId: "card-1",
          newCardId: "card-copy",
        }),
      );
      const duplicated = await getAggregate(boardId);
      expect(duplicated.cards["card-copy"]).toMatchObject({
        id: "card-copy",
        title: duplicated.cards["card-1"].title,
      });

      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-1" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "UNARCHIVE_CARD",
          cardId: "card-1",
          columnId: "col-todo",
          index: 0,
        }),
      );

      // RESTORE_CARD: delete then put it back (inverse, same payload shape).
      const beforeDelete = await getAggregate(boardId);
      const deletedCard = beforeDelete.cards["card-1"];
      const deleteColumn = beforeDelete.columns.find((column) =>
        column.cardIds.includes("card-1"),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId: "card-1" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: deletedCard,
          columnId: deleteColumn?.id,
          index: 0,
        }),
      );

      // RESTORE_COLUMN_CARDS: undo a bulk archive.
      const beforeBulk = await getAggregate(boardId);
      const bulkColumn = beforeBulk.columns.find(
        (column) => column.id === "col-doing",
      );
      const bulkCards = (bulkColumn?.cardIds ?? []).map(
        (id) => beforeBulk.cards[id],
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ARCHIVE_COLUMN_CARDS",
          columnId: "col-doing",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN_CARDS",
          columnId: "col-doing",
          cardIds: bulkColumn?.cardIds ?? [],
          cards: bulkCards,
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_COLUMN",
          columnId: "col-todo",
          newColumnId: "col-todo-copy",
          newCardIds: (
            beforeBulk.columns.find((c) => c.id === "col-todo")?.cardIds ?? []
          ).map((id) => `${id}-copy`),
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "MOVE_COLUMN",
          columnId: "col-todo-copy",
          fromIndex: 2,
          toIndex: 0,
        }),
      );

      // RESTORE_COLUMN: delete a column (one active + one archived card)
      // and put both back.
      const beforeColumnDelete = await getAggregate(boardId);
      const doomedColumn = beforeColumnDelete.columns.find(
        (column) => column.id === "col-doing",
      );
      const doomedCards = (doomedColumn?.cardIds ?? []).map(
        (id) => beforeColumnDelete.cards[id],
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "DELETE_COLUMN", columnId: "col-doing" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN",
          column: doomedColumn,
          index: beforeColumnDelete.columns.findIndex(
            (column) => column.id === "col-doing",
          ),
          cards: doomedCards,
        }),
      );
    });

    it("redoes a create command after its soft-delete undo", async () => {
      const boardId = await createBoard("Redo board");
      const initial = await getAggregate(boardId);

      const addColumn = scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: "col-redo",
        title: "Redo",
      });
      const deleteColumn = scoped(boardId, {
        type: "DELETE_COLUMN",
        columnId: "col-redo",
      });
      const addCard = scoped(boardId, {
        type: "ADD_CARD",
        newCardId: "card-redo",
        columnId: "col-redo",
        title: "Card",
      });
      const deleteCard = scoped(boardId, {
        type: "DELETE_CARD",
        cardId: "card-redo",
      });
      const duplicateCard = scoped(boardId, {
        type: "DUPLICATE_CARD",
        cardId: "card-redo",
        newCardId: "card-redo-dup",
      });
      const deleteCopy = scoped(boardId, {
        type: "DELETE_CARD",
        cardId: "card-redo-dup",
      });
      const duplicateColumn = scoped(boardId, {
        type: "DUPLICATE_COLUMN",
        columnId: "col-redo",
        newColumnId: "col-redo-copy",
        newCardIds: ["card-redo-copy", "card-redo-dup-copy"],
      });
      const deleteColumnCopy = scoped(boardId, {
        type: "DELETE_COLUMN",
        columnId: "col-redo-copy",
      });

      // The redo re-sends the original action verbatim with a fresh
      // commandId: the soft-deleted row must be revived, not inserted again
      // (undo of a create is a soft delete — the unique id used to 500).
      const timeline = [
        addColumn,
        deleteColumn,
        addColumn,
        addCard,
        deleteCard,
        addCard,
        duplicateCard,
        deleteCopy,
        duplicateCard,
        duplicateColumn,
        deleteColumnCopy,
        duplicateColumn,
      ];
      for (const action of timeline) await apply(boardId, action);

      let expected = initial;
      for (const action of timeline) {
        expected = boardReducer([expected], action, {
          withActivity: false,
        })[0]!;
      }
      expect(stripAttribution(await getAggregate(boardId))).toEqual(
        stripAttribution(expected),
      );
    });
  });

  describe("attribution: lastActorId follows the writer", () => {
    it("stamps card writes, follows a member edit, skips reorders", async () => {
      const boardId = await createBoard("Attribution board");
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "attr-col",
          title: "A",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "attr-card-a",
          columnId: "attr-col",
          title: "First",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "attr-card-b",
          columnId: "attr-col",
          title: "Second",
        }),
      );

      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN_EMAIL },
      });
      const member = await prisma.user.findUniqueOrThrow({
        where: { email: MEMBER_EMAIL },
      });
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);

      let board = await getAggregate(boardId);
      expect(board.cards["attr-card-a"].lastActorId).toBe(admin.id);

      // A checklist command bumps the card: the stamp follows the writer
      // even though the action itself names no title.
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId: "attr-card-a",
          newChecklistId: "attr-cl",
          title: "Steps",
        }),
      );
      board = await getAggregate(boardId);
      expect(board.cards["attr-card-a"].lastActorId).toBe(admin.id);

      // A member's edit takes the stamp over.
      await apply(
        boardId,
        scoped(boardId, {
          type: "UPDATE_CARD",
          cardId: "attr-card-a",
          title: "Member edit",
        }),
        memberToken,
      );
      board = await getAggregate(boardId);
      expect(board.cards["attr-card-a"].lastActorId).toBe(member.id);

      // A pure reorder writes positions only: no stamp, no updatedAt bump.
      const stamped = { ...board.cards["attr-card-a"] };
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_CARD_ORDER",
          columnId: "attr-col",
          cardIds: ["attr-card-b", "attr-card-a"],
        }),
      );
      board = await getAggregate(boardId);
      expect(board.columns[0].cardIds).toEqual(["attr-card-b", "attr-card-a"]);
      expect(board.cards["attr-card-a"].lastActorId).toBe(stamped.lastActorId);
      expect(board.cards["attr-card-a"].updatedAt).toBe(stamped.updatedAt);

      // Undo of a delete restores the card and stamps the undoer.
      await apply(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId: "attr-card-b" }),
        memberToken,
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: { ...board.cards["attr-card-b"] },
          columnId: "attr-col",
        }),
        memberToken,
      );
      board = await getAggregate(boardId);
      expect(board.cards["attr-card-b"].lastActorId).toBe(member.id);
    });
  });

  describe("idempotency and validation", () => {
    it("replays a commandId without a second entity or seq bump", async () => {
      const boardId = await createBoard("Idempotency board");
      const commandId = randomUUID();
      const action = scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: "col-only",
        title: "Only",
      });

      const first = await apply(boardId, action, adminToken, commandId);
      const second = await apply(boardId, action, adminToken, commandId);
      expect(second).toEqual(first);

      const commands = await prisma.command.findMany({ where: { boardId } });
      expect(commands).toHaveLength(1);
      const columns = await prisma.column.findMany({ where: { boardId } });
      expect(columns).toHaveLength(1);

      // A different command advances seq.
      const third = await apply(
        boardId,
        scoped(boardId, {
          type: "RENAME_COLUMN",
          columnId: "col-only",
          title: "Renamed",
        }),
      );
      expect(third.seq).toBeGreaterThan(first.seq);
    });

    it("rejects an unsupported or unknown action with 400", async () => {
      const boardId = await createBoard("Validation board");
      for (const type of ["ADD_BOARD", "IMPORT_BOARDS", "MOVE_LABEL"]) {
        const res = await post(
          boardId,
          scoped(boardId, { type, title: "x" } as unknown as Record<
            string,
            unknown
          >),
        ).expect(400);
        expect(res.body.field).toBe("action.type");
      }
    });

    it("rejects a malformed action with 400 and the offending field", async () => {
      const boardId = await createBoard("Malformed board");
      const res = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-x",
          title: "   ",
        }),
      ).expect(400);
      expect(res.body.field).toBe("action.title");
    });
  });

  describe("conflicts", () => {
    it("409s a WIP-limited add and move-in with conflict 'wip'", async () => {
      const boardId = await createBoard("WIP board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-a",
          title: "A",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-b",
          title: "B",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-a",
          wipLimit: 1,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-a1",
          columnId: "col-a",
          title: "A1",
        }),
      );
      const res = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-a2",
          columnId: "col-a",
          title: "A2",
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");

      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-b1",
          columnId: "col-b",
          title: "B1",
        }),
      );
      const move = await post(
        boardId,
        scoped(boardId, {
          type: "MOVE_CARD",
          cardId: "card-b1",
          fromColumnId: "col-b",
          fromIndex: 0,
          toColumnId: "col-a",
          toIndex: 1,
        }),
      ).expect(409);
      expect(move.body.conflict).toBe("wip");
    });

    it("409s a stale ifMatch with conflict 'version' and currentVersion", async () => {
      const boardId = await createBoard("ifMatch board");
      const first = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-if",
          title: "One",
        }),
      );

      const stale = await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth(adminToken))
        .send({
          commandId: randomUUID(),
          action: scoped(boardId, {
            type: "RENAME_COLUMN",
            columnId: "col-if",
            title: "Two",
          }),
          ifMatch: first.seq - 1,
        })
        .expect(409);
      expect(stale.body).toEqual({
        conflict: "version",
        currentVersion: first.seq,
      });

      const ok = await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth(adminToken))
        .send({
          commandId: randomUUID(),
          action: scoped(boardId, {
            type: "RENAME_COLUMN",
            columnId: "col-if",
            title: "Two",
          }),
          ifMatch: first.seq,
        })
        .expect(200);
      expect(ok.body.seq).toBeGreaterThan(first.seq);
    });

    it("serializes concurrent commands: same ifMatch yields one 200, one 409", async () => {
      const boardId = await createBoard("ifMatch race board");
      const first = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-race",
          title: "Race",
        }),
      );

      const fire = (title: string) =>
        server()
          .post(`/api/v1/boards/${boardId}/commands`)
          .set(auth(adminToken))
          .send({
            commandId: randomUUID(),
            action: scoped(boardId, {
              type: "RENAME_COLUMN",
              columnId: "col-race",
              title,
            }),
            ifMatch: first.seq,
          });

      const [a, b] = await Promise.all([fire("A"), fire("B")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.conflict).toBe("version");
    });

    it("mirrors the reducer's hard cardsPerColumn cap as 409", async () => {
      const boardId = await createBoard("Hard cap board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-c",
          title: "C",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-c1",
          columnId: "col-c",
          title: "C1",
        }),
      );
      // WIP limit below the current count refuses further adds too.
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-c",
          wipLimit: 1,
        }),
      );
      await post(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_CARD",
          cardId: "card-c1",
          newCardId: "card-c2",
        }),
      ).expect(409);
    });
  });

  describe("roles", () => {
    it("lets MEMBER mutate, and 403s VIEWER mutations", async () => {
      const boardId = await createBoard("Roles board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      await invite(boardId, VIEWER_EMAIL, "VIEWER", viewerToken);

      await post(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-m",
          title: "Member column",
        }),
        memberToken,
      ).expect(200);

      await post(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-v",
          title: "Viewer column",
        }),
        viewerToken,
      ).expect(403);

      // VIEWER can still read the delta feed.
      await server()
        .get(`/api/v1/boards/${boardId}/commands`)
        .set(auth(viewerToken))
        .expect(200);
    });
  });

  describe("soft-delete cascade", () => {
    it("DELETE_COLUMN flags active cards while archived cards stay in the aggregate", async () => {
      const boardId = await createBoard("Cascade board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-d",
          title: "D",
        }),
      );
      for (const id of ["card-d1", "card-d2", "card-d3"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: id,
            columnId: "col-d",
            title: id,
          }),
        );
      }
      // Archive one card so it survives the column deletion.
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-d3" }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "DELETE_COLUMN", columnId: "col-d" }),
      );

      const column = await prisma.column.findUnique({ where: { id: "col-d" } });
      expect(column?.deletedAt).not.toBeNull();
      for (const id of ["card-d1", "card-d2"]) {
        const card = await prisma.card.findUnique({ where: { id } });
        expect(card?.deletedAt).not.toBeNull();
      }
      const archived = await prisma.card.findUnique({
        where: { id: "card-d3" },
      });
      expect(archived?.deletedAt).toBeNull();

      const aggregate = await getAggregate(boardId);
      expect(aggregate.columns.map((c) => c.id)).not.toContain("col-d");
      expect(aggregate.cards["card-d1"]).toBeUndefined();
      expect(aggregate.cards["card-d3"]?.archivedAt).toEqual(
        expect.any(Number),
      );
    });

    it("blocks unarchive on a WIP-limited column and honours UNARCHIVE_CARD.index", async () => {
      const boardId = await createBoard("Unarchive board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-u",
          title: "U",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-u",
          wipLimit: 1,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-u1",
          columnId: "col-u",
          title: "U1",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-u1" }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-u2",
          columnId: "col-u",
          title: "U2",
        }),
      );

      // The column is full: restoring the archived card is refused.
      await post(
        boardId,
        scoped(boardId, { type: "UNARCHIVE_CARD", cardId: "card-u1" }),
      ).expect(409);

      // Free a slot, then restore at index 0.
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-u2" }),
      );
      const after = await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "UNARCHIVE_CARD",
          cardId: "card-u1",
          columnId: "col-u",
          index: 0,
        }),
      );
      expect(after.columns[0].cardIds).toEqual(["card-u1"]);
    });
  });

  describe("restore commands for checklists", () => {
    it("restores a soft-deleted checklist and item from their snapshots", async () => {
      const boardId = await importBoard("Checklist restore", {
        checklists: [
          {
            id: "cl-1",
            title: "Steps",
            items: [
              { id: "item-1", text: "one", done: false },
              { id: "item-2", text: "two", done: true },
            ],
          },
        ],
      });
      const cardId = await firstCardId(boardId);
      const imported = (await getAggregate(boardId)).cards[cardId];
      const checklistId = imported.checklists![0].id;
      const [item1, item2] = imported.checklists![0].items;

      // Soft-delete the checklist subtree the way TASK-27's DELETE would.
      await prisma.checklistItem.updateMany({
        where: { checklistId },
        data: { deletedAt: new Date() },
      });
      await prisma.checklist.update({
        where: { id: checklistId },
        data: { deletedAt: new Date() },
      });

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CHECKLIST",
          cardId,
          checklist: {
            id: checklistId,
            title: "Steps",
            items: [item1, item2],
          },
          index: 0,
        }),
      );

      await prisma.checklistItem.update({
        where: { id: item1.id },
        data: { deletedAt: new Date() },
      });
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CHECKLIST_ITEM",
          cardId,
          checklistId,
          item: item1,
          index: 0,
        }),
      );
    });

    it("reports the soft-deleted checklists/items in versions and touches", async () => {
      const boardId = await importBoard("Version fields", {
        checklists: [
          {
            id: "cl-1",
            title: "Steps",
            items: [{ id: "item-1", text: "one", done: false }],
          },
        ],
      });
      const aggregate = await getAggregate(boardId);
      const cardId = Object.keys(aggregate.cards)[0];
      const checklist = aggregate.cards[cardId].checklists![0];
      const item = checklist.items[0];

      const res = await post(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId }),
      ).expect(200);

      const versions = res.body.versions as Record<string, number>;
      expect(versions[`card:${cardId}`]).toEqual(expect.any(Number));
      expect(versions[`checklist:${checklist.id}`]).toEqual(expect.any(Number));
      expect(versions[`checklistItem:${item.id}`]).toEqual(expect.any(Number));

      const command = await prisma.command.findFirst({ where: { boardId } });
      expect(command?.touches).toEqual(
        expect.arrayContaining([
          `card:${cardId}`,
          `checklist:${checklist.id}`,
          `checklistItem:${item.id}`,
        ]),
      );
    });
  });

  describe("RESTORE_CARD without a column", () => {
    it("restores the card into the map without touching any column", async () => {
      const boardId = await createBoard("Orphan restore board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-orphan",
          title: "Column",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-orphan",
          columnId: "col-orphan",
          title: "Orphan",
        }),
      );

      const before = await getAggregate(boardId);
      const snapshot = before.cards["card-orphan"];
      await apply(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId: "card-orphan" }),
      );

      // No columnId: the reducer only puts the card back into the cards map.
      const after = await applyAndAssert(
        boardId,
        scoped(boardId, { type: "RESTORE_CARD", card: snapshot }),
      );
      expect(after.cards["card-orphan"]).toMatchObject({
        id: "card-orphan",
        title: "Orphan",
      });
      expect(
        after.columns.every(
          (column) => !column.cardIds.includes("card-orphan"),
        ),
      ).toBe(true);
    });
  });

  describe("delta catch-up", () => {
    it("returns only commands newer than since, ordered by seq", async () => {
      const boardId = await createBoard("Delta board");
      await invite(boardId, VIEWER_EMAIL, "VIEWER", viewerToken);
      const first = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-dl1",
          title: "One",
        }),
      );
      const second = await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-dl2",
          title: "Two",
        }),
      );

      const all = await server()
        .get(`/api/v1/boards/${boardId}/commands`)
        .set(auth(viewerToken))
        .expect(200);
      expect(
        (all.body as CommandDeltaEntry[]).map((entry) => entry.seq),
      ).toEqual([first.seq, second.seq]);
      expect(all.body[0].action).toMatchObject({
        type: "ADD_COLUMN",
        newColumnId: "col-dl1",
      });
      expect(all.body[0].actorId).toEqual(expect.any(String));
      expect(all.body[0].touches).toContain("column:col-dl1");

      const delta = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${first.seq}`)
        .set(auth(adminToken))
        .expect(200);
      expect(delta.body).toHaveLength(1);
      expect(delta.body[0].seq).toBe(second.seq);

      await server()
        .get(`/api/v1/boards/${boardId}/commands?since=not-a-number`)
        .set(auth(adminToken))
        .expect(400);
    });
  });

  /** Import a one-card board with the given checklists to seed a checklist. */
  async function importBoard(
    title: string,
    card: { checklists?: Board["cards"][string]["checklists"] },
  ): Promise<string> {
    const envelope: BoardEnvelope = {
      app: "janosik",
      schemaVersion: 1,
      exportedAt: Date.now(),
      boards: [
        {
          id: "src",
          title,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          labels: [],
          columns: [
            {
              id: "col-src",
              title: "Todo",
              cardIds: ["card-src"],
              createdAt: 1_700_000_000_000,
            },
          ],
          cards: {
            "card-src": {
              id: "card-src",
              title: "Card",
              labelIds: [],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
              ...(card.checklists ? { checklists: card.checklists } : {}),
            },
          },
        },
      ],
    };
    const res = await server()
      .post("/api/v1/boards/import")
      .set(auth(adminToken))
      .send(envelope)
      .expect(201);
    return res.body[0].id as string;
  }

  async function firstCardId(boardId: string): Promise<string> {
    const aggregate = await getAggregate(boardId);
    return Object.keys(aggregate.cards)[0];
  }

  async function wipe(db: PrismaService): Promise<void> {
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
