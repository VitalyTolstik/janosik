import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type {
  Board,
  BoardAction,
  BoardEnvelope,
  CommandDeltaEntry,
  CommandResponse,
} from "@janosik/shared";
import {
  boardReducer,
  duplicateChecklistId,
  duplicateChecklistItemId,
  UNTITLED_CARD_TITLE,
} from "@janosik/shared";
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
    // This suite POSTs far more than the global 100 req/min quota by design
    // (the contract walk alone is a hundred commands); throttling is another
    // suite's subject (auth-rate-limit). Neither `overrideGuard` nor
    // `overrideProvider(APP_GUARD)` reaches a guard Nest registered as an
    // enhancer, so the quota is lifted on the class itself — jest gives each
    // spec file its own module registry, so the patch dies with this file.
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    // Bind the HTTP server before any request. supertest lazily starts a
    // not-yet-listening server and then *closes* it once the request ends, so
    // the concurrent CAS burst below races that close and resets an in-flight
    // socket (`read ECONNRESET`). With the server already listening,
    // supertest reuses it and leaves it open.
    await app.listen(0);
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

  // Near the server clock: commands outside its ±5 min skew window get
  // their `at` replaced (B-5), which would break the reducer contract.
  let clock = Date.now() - 120_000;
  const tick = () => (clock += 100);
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

      // Assignee (TASK-49): only an accepted member passes the server
      // precondition; unassign drops the field. The contract below proves
      // the writer keeps the column in step with the reducer.
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      const assignee = await prisma.user.findUnique({
        where: { email: MEMBER_EMAIL },
        select: { id: true },
      });
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_ASSIGN",
          cardId: "card-1",
          assigneeId: assignee?.id,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_ASSIGN",
          cardId: "card-1",
          assigneeId: null,
        }),
      );

      // Card links (TASK-46): add on card-1 towards card-2, then a second
      // row on a fresh pair; removal goes by link id.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD_LINK",
          cardId: "card-1",
          linkId: "link-1",
          targetCardId: "card-2",
          linkType: "blocks",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD_LINK",
          cardId: "card-2",
          linkId: "link-2",
          targetCardId: "card-3",
          linkType: "relates_to",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "REMOVE_CARD_LINK",
          cardId: "card-1",
          linkId: "link-1",
          targetCardId: "card-2",
          linkType: "blocks",
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
          type: "SET_COLUMN_ACCENT",
          columnId: "col-doing",
          accent: { type: "color", value: "brand" },
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_ACCENT",
          columnId: "col-doing",
          accent: { type: "gradient", value: "ocean" },
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_ACCENT",
          columnId: "col-doing",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_BOARD_COLUMN_STYLE",
          columnStyle: "band",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "SET_BOARD_COLUMN_STYLE" }),
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

  describe("duplicate content (H3)", () => {
    it("writes duplicated card checklists with fresh ids and survives reload", async () => {
      const boardId = await importBoard("Duplicate checklist card", {
        checklists: [
          {
            id: "cl-src",
            title: "Steps",
            items: [{ id: "it-src", text: "One", done: false }],
          },
        ],
      });
      const sourceId = await firstCardId(boardId);
      const before = await getAggregate(boardId);
      const sourceChecklist = before.cards[sourceId].checklists![0];

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_CARD",
          cardId: sourceId,
          newCardId: "card-copy-h3",
        }),
      );
      // Re-read: the copy is not allowed to lose its checklists on reload.
      const after = await getAggregate(boardId);
      const copy = after.cards["card-copy-h3"];
      expect(copy.checklists).toHaveLength(1);
      expect(copy.checklists![0].id).not.toBe(sourceChecklist.id);
      expect(copy.checklists![0].title).toBe("Steps");
      expect(copy.checklists![0].items[0].id).not.toBe(
        sourceChecklist.items[0].id,
      );
      expect(copy.checklists![0].items[0]).toMatchObject({
        text: "One",
        done: false,
      });
      // The source row is still owned by the source card.
      expect(after.cards[sourceId].checklists![0].id).toBe(sourceChecklist.id);
      expect(
        await prisma.checklist.count({
          where: { cardId: "card-copy-h3", deletedAt: null },
        }),
      ).toBe(1);

      const command = await prisma.command.findFirst({
        where: { boardId, type: "DUPLICATE_CARD" },
      });
      expect(command?.touches).toEqual(
        expect.arrayContaining([
          `card:card-copy-h3`,
          `checklist:${copy.checklists![0].id}`,
          `checklistItem:${copy.checklists![0].items[0].id}`,
        ]),
      );

      // Deleting the copy's checklist must leave the original intact.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DELETE_CHECKLIST",
          cardId: "card-copy-h3",
          checklistId: copy.checklists![0].id,
        }),
      );
      const remaining = await getAggregate(boardId);
      expect(remaining.cards["card-copy-h3"].checklists).toBeUndefined();
      expect(remaining.cards[sourceId].checklists![0].id).toBe(
        sourceChecklist.id,
      );
    });

    it("writes duplicated column checklists with fresh ids and survives reload", async () => {
      const boardId = await importBoard("Duplicate checklist column", {
        checklists: [
          {
            id: "cl-src",
            title: "Steps",
            items: [{ id: "it-src", text: "One", done: false }],
          },
        ],
      });
      const before = await getAggregate(boardId);
      const column = before.columns[0];
      const sourceCard = before.cards[column.cardIds[0]];
      const sourceChecklist = sourceCard.checklists![0];

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_COLUMN",
          columnId: column.id,
          newColumnId: "col-copy-h3",
          newCardIds: column.cardIds.map((id) => `${id}-copy`),
        }),
      );
      const after = await getAggregate(boardId);
      const copyColumn = after.columns.find((c) => c.id === "col-copy-h3")!;
      const copy = after.cards[copyColumn.cardIds[0]];
      expect(copy.checklists).toHaveLength(1);
      expect(copy.checklists![0].id).not.toBe(sourceChecklist.id);
      expect(copy.checklists![0].items[0].id).not.toBe(
        sourceChecklist.items[0].id,
      );
      expect(after.cards[sourceCard.id].checklists![0].id).toBe(
        sourceChecklist.id,
      );
      expect(copy.links).toBeUndefined();
      expect(
        await prisma.checklist.count({
          where: { cardId: copy.id, deletedAt: null },
        }),
      ).toBe(1);

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DELETE_CHECKLIST",
          cardId: copy.id,
          checklistId: copy.checklists![0].id,
        }),
      );
      const remaining = await getAggregate(boardId);
      expect(remaining.cards[sourceCard.id].checklists![0].id).toBe(
        sourceChecklist.id,
      );
      expect(remaining.cards[copy.id].checklists).toBeUndefined();
    });

    it("refuses duplicate-card derived ids owned by another card", async () => {
      const boardId = await createBoard("Duplicate id collision card");
      const columnId = `col-${randomUUID()}`;
      const sourceId = `source-${randomUUID()}`;
      const victimId = `victim-${randomUUID()}`;
      const copyId = `copy-${randomUUID()}`;
      const sourceChecklistId = `src-cl-${randomUUID()}`;
      const stolenChecklistId = duplicateChecklistId(copyId, 0);
      const stolenItemId = duplicateChecklistItemId(copyId, 0, 0);

      for (const action of [
        { type: "ADD_COLUMN", newColumnId: columnId, title: "Todo" },
        { type: "ADD_CARD", newCardId: sourceId, columnId, title: "Source" },
        { type: "ADD_CARD", newCardId: victimId, columnId, title: "Victim" },
        {
          type: "ADD_CHECKLIST",
          cardId: sourceId,
          newChecklistId: sourceChecklistId,
          title: "Source steps",
        },
        {
          type: "ADD_CHECKLIST_ITEM",
          cardId: sourceId,
          checklistId: sourceChecklistId,
          newItemId: `src-it-${randomUUID()}`,
          text: "One",
        },
        {
          type: "ADD_CHECKLIST",
          cardId: victimId,
          newChecklistId: stolenChecklistId,
          title: "Victim steps",
        },
        {
          type: "ADD_CHECKLIST_ITEM",
          cardId: victimId,
          checklistId: stolenChecklistId,
          newItemId: stolenItemId,
          text: "Keep me",
        },
      ]) {
        await apply(boardId, scoped(boardId, action));
      }

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_CARD",
          cardId: sourceId,
          newCardId: copyId,
        }),
      ).expect(409);
      expect(res.body).toMatchObject({
        code: "id_conflict",
        conflict: "id",
      });

      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards[copyId]).toBeUndefined();
      expect(aggregate.cards[victimId].checklists?.[0]).toMatchObject({
        id: stolenChecklistId,
        items: [{ id: stolenItemId, text: "Keep me", done: false }],
      });
    });

    it("checks duplicate parentage against the batch state at its position", async () => {
      const boardId = await createBoard("Duplicate batch parentage board");
      const columnId = `col-${randomUUID()}`;
      const sourceId = `source-${randomUUID()}`;
      const victimId = `victim-${randomUUID()}`;
      const copyId = `copy-${randomUUID()}`;
      const stolenChecklistId = duplicateChecklistId(copyId, 0);
      for (const action of [
        { type: "ADD_COLUMN", newColumnId: columnId, title: "Todo" },
        { type: "ADD_CARD", newCardId: sourceId, columnId, title: "Source" },
        { type: "ADD_CARD", newCardId: victimId, columnId, title: "Victim" },
        {
          type: "ADD_CHECKLIST",
          cardId: victimId,
          newChecklistId: stolenChecklistId,
          title: "Victim steps",
        },
      ]) {
        await apply(boardId, scoped(boardId, action));
      }

      // Source initially has no checklist, so a pre-batch parentage pass sees
      // no derived ids. The first batch command creates one; the duplicate at
      // position 1 must derive from that running state and collide with the
      // victim's pre-existing checklist.
      const res = await server()
        .post(`/api/v1/boards/${boardId}/commands/batch`)
        .set(auth(adminToken))
        .send({
          commands: [
            {
              commandId: randomUUID(),
              action: scoped(boardId, {
                type: "ADD_CHECKLIST",
                cardId: sourceId,
                newChecklistId: `src-cl-${randomUUID()}`,
                title: "Source steps",
              }),
            },
            {
              commandId: randomUUID(),
              action: scoped(boardId, {
                type: "DUPLICATE_CARD",
                cardId: sourceId,
                newCardId: copyId,
              }),
            },
          ],
        })
        .expect(409);
      expect(res.body).toMatchObject({
        code: "id_conflict",
        conflict: "id",
      });
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards[sourceId].checklists).toBeUndefined();
      expect(aggregate.cards[victimId].checklists?.[0].id).toBe(
        stolenChecklistId,
      );
      expect(aggregate.cards[copyId]).toBeUndefined();
    });

    it("refuses duplicate-column derived ids owned by another card", async () => {
      const boardId = await createBoard("Duplicate id collision column");
      const columnId = `col-${randomUUID()}`;
      const victimColumnId = `victim-col-${randomUUID()}`;
      const sourceId = `source-${randomUUID()}`;
      const victimId = `victim-${randomUUID()}`;
      const copyCardId = `copy-${randomUUID()}`;
      const stolenChecklistId = duplicateChecklistId(copyCardId, 0);
      const stolenItemId = duplicateChecklistItemId(copyCardId, 0, 0);

      for (const action of [
        { type: "ADD_COLUMN", newColumnId: columnId, title: "Todo" },
        {
          type: "ADD_COLUMN",
          newColumnId: victimColumnId,
          title: "Victim",
        },
        { type: "ADD_CARD", newCardId: sourceId, columnId, title: "Source" },
        {
          type: "ADD_CARD",
          newCardId: victimId,
          columnId: victimColumnId,
          title: "Victim",
        },
        {
          type: "ADD_CHECKLIST",
          cardId: sourceId,
          newChecklistId: `src-cl-${randomUUID()}`,
          title: "Source steps",
        },
        {
          type: "ADD_CHECKLIST",
          cardId: victimId,
          newChecklistId: stolenChecklistId,
          title: "Victim steps",
        },
        {
          type: "ADD_CHECKLIST_ITEM",
          cardId: victimId,
          checklistId: stolenChecklistId,
          newItemId: stolenItemId,
          text: "Keep me",
        },
      ]) {
        await apply(boardId, scoped(boardId, action));
      }

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "DUPLICATE_COLUMN",
          columnId,
          newColumnId: `copy-col-${randomUUID()}`,
          newCardIds: [copyCardId],
        }),
      ).expect(409);
      expect(res.body).toMatchObject({
        code: "id_conflict",
        conflict: "id",
      });
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards[copyCardId]).toBeUndefined();
      expect(aggregate.cards[victimId].checklists?.[0].id).toBe(
        stolenChecklistId,
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

    it("ignores a forged inverse flag on a WIP-limited add (TASK-80)", async () => {
      const boardId = await createBoard("WIP inverse board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-w",
          title: "W",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-w",
          wipLimit: 1,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-w1",
          columnId: "col-w",
          title: "W1",
        }),
      );

      // A client cannot skip the WIP guard by claiming the add is an undo.
      const res = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-w2",
          columnId: "col-w",
          title: "W2",
          inverse: true,
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");

      // A genuine RESTORE_* undo still bypasses the guard: delete the only
      // card (freeing the slot) and restore it with `inverse: true`.
      const snapshot = (await getAggregate(boardId)).cards["card-w1"];
      await apply(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId: "card-w1" }),
      );
      const restored = await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: snapshot,
          columnId: "col-w",
          index: 0,
          inverse: true,
        }),
      );
      expect(restored.columns[0].cardIds).toContain("card-w1");
    });

    it("refuses RESTORE_CARD into a full WIP column (M13)", async () => {
      const boardId = await createBoard("Restore WIP board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-rw-a",
          title: "A",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-rw-b",
          title: "B",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-rw-a",
          wipLimit: 1,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-rw-victim",
          columnId: "col-rw-b",
          title: "Victim",
        }),
      );
      const beforeDelete = await getAggregate(boardId);
      const snapshot = beforeDelete.cards["card-rw-victim"];
      await apply(
        boardId,
        scoped(boardId, { type: "DELETE_CARD", cardId: "card-rw-victim" }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-rw-filler",
          columnId: "col-rw-a",
          title: "Filler",
        }),
      );

      // A forged inverse must not bypass the destination's WIP limit.
      const res = await post(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: snapshot,
          columnId: "col-rw-a",
          index: 0,
          inverse: true,
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards["card-rw-victim"]).toBeUndefined();
      expect(
        aggregate.columns.find((c) => c.id === "col-rw-a")?.cardIds,
      ).toEqual(["card-rw-filler"]);

      // The same restore is still a normal undo when the destination has room.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: snapshot,
          columnId: "col-rw-b",
          index: 0,
          inverse: true,
        }),
      );
    });

    it("refuses RESTORE_COLUMN_CARDS that would exceed WIP (M13)", async () => {
      const boardId = await createBoard("Restore cards WIP board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-rc",
          title: "C",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-rc",
          wipLimit: 2,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-rc-1",
          columnId: "col-rc",
          title: "One",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-rc-2",
          columnId: "col-rc",
          title: "Two",
        }),
      );
      const beforeArchive = await getAggregate(boardId);
      const restoreSnapshot = beforeArchive.cards["card-rc-2"];
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-rc-2" }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-rc",
          wipLimit: 1,
        }),
      );

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN_CARDS",
          columnId: "col-rc",
          cardIds: ["card-rc-1", "card-rc-2"],
          cards: [restoreSnapshot],
          inverse: true,
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards["card-rc-2"].archivedAt).toEqual(
        expect.any(Number),
      );
      expect(aggregate.columns.find((c) => c.id === "col-rc")?.cardIds).toEqual(
        ["card-rc-1"],
      );
    });

    it("counts every card in a RESTORE_COLUMN_CARDS batch against WIP", async () => {
      const boardId = await createBoard("Restore many WIP board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-rm",
          title: "Many",
        }),
      );
      for (const id of ["a", "b", "c", "d"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: `card-rm-${id}`,
            columnId: "col-rm",
            title: id,
          }),
        );
      }
      const beforeArchive = await getAggregate(boardId);
      const snapshots = ["a", "b"].map(
        (id) => beforeArchive.cards[`card-rm-${id}`],
      );
      for (const id of ["a", "b"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ARCHIVE_CARD",
            cardId: `card-rm-${id}`,
          }),
        );
      }
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_WIP_LIMIT",
          columnId: "col-rm",
          wipLimit: 2,
        }),
      );

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN_CARDS",
          columnId: "col-rm",
          cardIds: ["card-rm-a", "card-rm-b"],
          cards: snapshots,
          inverse: true,
        }),
      ).expect(409);
      expect(res.body).toMatchObject({ conflict: "wip", columnId: "col-rm" });
      const aggregate = await getAggregate(boardId);
      expect(aggregate.columns.find((c) => c.id === "col-rm")?.cardIds).toEqual(
        ["card-rm-c", "card-rm-d"],
      );
    });

    it("keeps cards omitted from cardIds out of the restored column", async () => {
      const boardId = await createBoard("Restore mismatch board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-rmx",
          title: "Mix",
        }),
      );
      for (const id of ["a", "b", "c"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: `card-rmx-${id}`,
            columnId: "col-rmx",
            title: id,
          }),
        );
      }
      const beforeArchive = await getAggregate(boardId);
      const snapshots = ["a", "b"].map(
        (id) => beforeArchive.cards[`card-rmx-${id}`],
      );
      for (const id of ["a", "b"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ARCHIVE_CARD",
            cardId: `card-rmx-${id}`,
          }),
        );
      }

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN_CARDS",
          columnId: "col-rmx",
          cardIds: ["card-rmx-a"],
          cards: snapshots,
          inverse: true,
        }),
      );
      const aggregate = await getAggregate(boardId);
      const column = aggregate.columns.find((c) => c.id === "col-rmx");
      expect(column?.cardIds).toContain("card-rmx-a");
      expect(column?.cardIds).not.toContain("card-rmx-b");
      expect(aggregate.cards["card-rmx-b"]).toMatchObject({
        id: "card-rmx-b",
      });
      expect(aggregate.cards["card-rmx-b"].archivedAt).toBeUndefined();
    });

    it("restores one archived card into a column with room", async () => {
      const boardId = await createBoard("Restore one board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-r1",
          title: "One",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-r1",
          columnId: "col-r1",
          title: "One",
        }),
      );
      const before = await getAggregate(boardId);
      const snapshot = before.cards["card-r1"];
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-r1" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_COLUMN_CARDS",
          columnId: "col-r1",
          cardIds: ["card-r1"],
          cards: [snapshot],
          inverse: true,
        }),
      );
      const aggregate = await getAggregate(boardId);
      expect(aggregate.columns[0].cardIds).toEqual(["card-r1"]);
      expect(aggregate.cards["card-r1"].archivedAt).toBeUndefined();
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
      expect(stale.body).toMatchObject({
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

    it("mirrors the reducer's WIP limit as 409", async () => {
      const boardId = await createBoard("WIP limit board");
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

      await post(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_ACCENT",
          columnId: "col-m",
          accent: { type: "color", value: "brand" },
        }),
        memberToken,
      ).expect(200);
      await post(
        boardId,
        scoped(boardId, {
          type: "SET_COLUMN_ACCENT",
          columnId: "col-m",
          accent: { type: "color", value: "red" },
        }),
        viewerToken,
      ).expect(403);
      await post(
        boardId,
        scoped(boardId, {
          type: "SET_BOARD_COLUMN_STYLE",
          columnStyle: "band",
        }),
        memberToken,
      ).expect(200);
      await post(
        boardId,
        scoped(boardId, { type: "SET_BOARD_COLUMN_STYLE" }),
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

    it("repoints an archived card of a deleted column at the orphan column so the column can purge (TASK-156, item 21)", async () => {
      const boardId = await createBoard("Orphan purge board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-oc",
          title: "OC",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-oc1",
          columnId: "col-oc",
          title: "Archived survivor",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, { type: "ARCHIVE_CARD", cardId: "card-oc1" }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "DELETE_COLUMN", columnId: "col-oc" }),
      );

      // The archived card stays live, repointed at the invisible orphan
      // column instead of the soft-deleted one…
      const archived = await prisma.card.findUnique({
        where: { id: "card-oc1" },
      });
      expect(archived?.deletedAt).toBeNull();
      expect(archived?.columnId).toBe(`orphan:${boardId}`);
      // …and the orphan column itself is a soft-deleted parking spot.
      const orphan = await prisma.column.findUnique({
        where: { id: `orphan:${boardId}` },
      });
      expect(orphan?.deletedAt).not.toBeNull();

      // The aggregate still holds the card in `cards` and in no column,
      // and the orphan column never surfaces in it.
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards["card-oc1"]?.archivedAt).toEqual(
        expect.any(Number),
      );
      expect(
        aggregate.columns.every((c) => !c.cardIds.includes("card-oc1")),
      ).toBe(true);
      expect(aggregate.columns.map((c) => c.id)).not.toContain(
        `orphan:${boardId}`,
      );

      // Purgeable (the point of the repoint): no card of any state
      // references the deleted column any more, so once its retention
      // window passes, the sweep's exact condition takes it.
      expect(await prisma.card.count({ where: { columnId: "col-oc" } })).toBe(
        0,
      );
      const cutoff = new Date(Date.now() - 40 * 86_400_000);
      await prisma.column.update({
        where: { id: "col-oc" },
        data: { deletedAt: cutoff },
      });
      const swept = await prisma.column.deleteMany({
        where: { deletedAt: { not: null, lte: cutoff }, cards: { none: {} } },
      });
      expect(swept.count).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.column.findUnique({ where: { id: "col-oc" } }),
      ).toBeNull();
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

  describe("card links: stored order survives a removal (TASK-46)", () => {
    it("renumbers positions so the aggregate reproduces the reducer", async () => {
      const boardId = await createBoard("Link order board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-links",
          title: "Column",
        }),
      );
      for (const n of [1, 2, 3, 4]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: `lc-${n}`,
            columnId: "col-links",
            title: `Link card ${n}`,
          }),
        );
      }
      const link = (linkId: string, target: string) =>
        apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD_LINK",
            cardId: "lc-1",
            linkId,
            targetCardId: target,
            linkType: "relates_to",
          }),
        );

      await link("ln-1", "lc-2");
      await link("ln-2", "lc-3");
      // Removing the first row used to leave a gap that the next add
      // landed in, giving two live rows the same `position`.
      await apply(
        boardId,
        scoped(boardId, {
          type: "REMOVE_CARD_LINK",
          cardId: "lc-1",
          linkId: "ln-1",
          targetCardId: "lc-2",
          linkType: "relates_to",
        }),
      );
      await link("ln-3", "lc-4");

      const rows = await prisma.cardLink.findMany({
        where: { fromCardId: "lc-1", deletedAt: null },
        select: { id: true, position: true },
        orderBy: { position: "asc" },
      });
      expect(rows).toEqual([
        { id: "ln-2", position: 0 },
        { id: "ln-3", position: 1 },
      ]);

      // And the aggregate holds them in the reducer's order.
      const board = await getAggregate(boardId);
      expect(board.cards["lc-1"].links?.map((l) => l.id)).toEqual([
        "ln-2",
        "ln-3",
      ]);
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
      // Since the shared reducer hardening that is only consistent for an
      // *archived* card (archived cards live in the map, in no column); a
      // column-less restore of an active card is a reducer no-op.
      const after = await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CARD",
          card: { ...snapshot, archivedAt: clock },
        }),
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

  it("closes the blank-title bypass in duplicate and restore", async () => {
    const boardId = await createBoard("Blank title guard");
    const columnId = randomUUID();
    const cardId = randomUUID();
    await applyAndAssert(
      boardId,
      scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "Todo",
      }),
    );
    await applyAndAssert(
      boardId,
      scoped(boardId, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Original",
      }),
    );

    const blankDuplicate = await post(
      boardId,
      scoped(boardId, {
        type: "DUPLICATE_CARD",
        cardId,
        newCardId: randomUUID(),
        title: "   ",
      }),
    );
    expect(blankDuplicate.status).toBe(400);
    expect(blankDuplicate.body.field).toBe("action.title");

    const before = await getAggregate(boardId);
    const snapshot = before.cards[cardId];
    await applyAndAssert(
      boardId,
      scoped(boardId, { type: "DELETE_CARD", cardId }),
    );
    await post(
      boardId,
      scoped(boardId, {
        type: "RESTORE_CARD",
        card: { ...snapshot, title: "   " },
        columnId,
        index: 0,
      }),
    ).expect(200);
    const restored = await getAggregate(boardId);
    expect(restored.cards[cardId]?.title).toBe(UNTITLED_CARD_TITLE);
  });

  async function firstCardId(boardId: string): Promise<string> {
    const aggregate = await getAggregate(boardId);
    return Object.keys(aggregate.cards)[0];
  }

  async function wipe(db: PrismaService): Promise<void> {
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
    await db.apiToken.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
