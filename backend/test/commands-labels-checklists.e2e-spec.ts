import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  Board,
  BoardAction,
  BoardEnvelope,
  CommandResponse,
  Label,
} from "@janosik/shared";
import { boardReducer, LIMITS } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";

const ADMIN_EMAIL = "labels-admin@example.com";
const MEMBER_EMAIL = "labels-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * Command log for labels and checklists (TASK-27 §7.4/§7.4.1).
 *
 * Same contract as TASK-26: after every command `GET /boards/:id` must
 * deep-equal `boardReducer(before, action, { withActivity: false })`, which
 * is what keeps the per-action writers and the reducer from drifting apart.
 * On top of that: the m2m label order round-trips, a deleted label cascades
 * out of every card and comes back on restore, collection limits answer
 * `409 { conflict: "wip" }` and inverse commands are never refused.
 */
describe("Commands API — labels & checklists (e2e)", () => {
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

  async function getAggregate(boardId: string): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(adminToken))
      .expect(200);
    return res.body as Board;
  }

  /** Apply a command and assert the aggregate matches the reducer exactly. */
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

  describe("contract: aggregate == boardReducer", () => {
    it("walks the label and checklist action set", async () => {
      const boardId = await createBoard("Labels contract board");
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-1",
          title: "Todo",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-1",
          columnId: "col-1",
          title: "Card",
        }),
      );

      for (const label of [
        { id: "l-1", name: "Bug", color: "red" },
        { id: "l-2", name: "Design", color: "blue" },
        { id: "l-3", name: "Docs", color: "green" },
      ]) {
        await applyAndAssert(
          boardId,
          scoped(boardId, { type: "ADD_LABEL", label }),
        );
      }
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RENAME_LABEL",
          labelId: "l-1",
          name: "Defect",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_LABEL_COLOR",
          labelId: "l-2",
          color: "brand",
        }),
      );

      // Attach order: l-2 first, then l-1 inserted at the head, then l-2
      // moves to index 1 (position is part of the m2m contract).
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "l-2",
          on: true,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "l-1",
          on: true,
          index: 0,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "l-2",
          on: false,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-1",
          labelId: "l-2",
          on: true,
          index: 1,
        }),
      );

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId: "card-1",
          newChecklistId: "cl-1",
          title: "Steps",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId: "card-1",
          newChecklistId: "cl-2",
          title: "Later",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RENAME_CHECKLIST",
          cardId: "card-1",
          checklistId: "cl-1",
          title: "Release steps",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          newItemId: "it-1",
          text: "One",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          newItemId: "it-2",
          text: "Two",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CHECKLIST_ITEM_DONE",
          cardId: "card-1",
          checklistId: "cl-1",
          itemId: "it-1",
          done: true,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RENAME_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          itemId: "it-2",
          text: "Second",
        }),
      );

      // Delete an item and put it back at its old position.
      const beforeItemDelete = await getAggregate(boardId);
      const itemSnapshot = beforeItemDelete.cards["card-1"].checklists?.find(
        (checklist) => checklist.id === "cl-1",
      )?.items[1];
      expect(itemSnapshot?.id).toBe("it-2");
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DELETE_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          itemId: "it-2",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          item: itemSnapshot!,
          index: 1,
        }),
      );

      // Delete the whole checklist and restore it at its old index (0),
      // which must renumber the one that stayed.
      const beforeChecklistDelete = await getAggregate(boardId);
      const checklistSnapshot = beforeChecklistDelete.cards[
        "card-1"
      ].checklists?.find((checklist) => checklist.id === "cl-1");
      expect(checklistSnapshot).toBeDefined();
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DELETE_CHECKLIST",
          cardId: "card-1",
          checklistId: "cl-1",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CHECKLIST",
          cardId: "card-1",
          checklist: checklistSnapshot!,
          index: 0,
        }),
      );

      // Delete a label that sits on the card and restore it with its
      // assignments — the m2m rows must come back in order.
      const beforeLabelDelete = await getAggregate(boardId);
      const labelSnapshot = beforeLabelDelete.labels.find(
        (label) => label.id === "l-2",
      );
      expect(labelSnapshot).toBeDefined();
      const assignments = Object.values(beforeLabelDelete.cards)
        .map((card) => ({
          cardId: card.id,
          index: card.labelIds.indexOf("l-2"),
        }))
        .filter((assignment) => assignment.index !== -1);
      expect(assignments).toHaveLength(1);
      await applyAndAssert(
        boardId,
        scoped(boardId, { type: "DELETE_LABEL", labelId: "l-2" }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_LABEL",
          label: labelSnapshot!,
          index: beforeLabelDelete.labels.findIndex(
            (label) => label.id === "l-2",
          ),
          assignments,
        }),
      );

      const final = await getAggregate(boardId);
      expect(final.labels.map((label: Label) => label.id)).toEqual([
        "l-1",
        "l-2",
        "l-3",
      ]);
      expect(final.cards["card-1"].labelIds).toEqual(["l-1", "l-2"]);
      expect(
        final.cards["card-1"].checklists?.map((checklist) => checklist.id),
      ).toEqual(["cl-1", "cl-2"]);
      expect(final.cards["card-1"].checklists?.[0].items).toEqual([
        { id: "it-1", text: "One", done: true },
        { id: "it-2", text: "Second", done: false },
      ]);
    });

    it("redoes a create command after its soft-delete undo", async () => {
      const boardId = await createBoard("Redo labels board");
      const initial = await getAggregate(boardId);

      const addColumn = scoped(boardId, {
        type: "ADD_COLUMN",
        newColumnId: "col-r",
        title: "R",
      });
      const addCard = scoped(boardId, {
        type: "ADD_CARD",
        newCardId: "card-r",
        columnId: "col-r",
        title: "R",
      });
      const addLabel = scoped(boardId, {
        type: "ADD_LABEL",
        label: { id: "l-r", name: "R", color: "red" },
      });
      const deleteLabel = scoped(boardId, {
        type: "DELETE_LABEL",
        labelId: "l-r",
      });
      const addChecklist = scoped(boardId, {
        type: "ADD_CHECKLIST",
        cardId: "card-r",
        newChecklistId: "cl-r",
        title: "Steps",
      });
      const deleteChecklist = scoped(boardId, {
        type: "DELETE_CHECKLIST",
        cardId: "card-r",
        checklistId: "cl-r",
      });
      const addItem = scoped(boardId, {
        type: "ADD_CHECKLIST_ITEM",
        cardId: "card-r",
        checklistId: "cl-r",
        newItemId: "it-r",
        text: "One",
      });
      const deleteItem = scoped(boardId, {
        type: "DELETE_CHECKLIST_ITEM",
        cardId: "card-r",
        checklistId: "cl-r",
        itemId: "it-r",
      });

      // Redo re-sends the original action verbatim: the soft-deleted row
      // must be revived, not inserted again (unique id → 500).
      const timeline = [
        addColumn,
        addCard,
        addLabel,
        deleteLabel,
        addLabel,
        addChecklist,
        deleteChecklist,
        addChecklist,
        addItem,
        deleteItem,
        addItem,
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

    it("ignores unknown labels and checklists exactly like the reducer", async () => {
      const boardId = await createBoard("No-op board");
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-x",
          title: "X",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-x",
          columnId: "col-x",
          title: "X",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-x",
          labelId: "missing",
          on: true,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "missing-card",
          labelId: "missing",
          on: true,
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "DELETE_LABEL",
          labelId: "missing",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-x",
          checklistId: "missing",
          newItemId: "it-x",
          text: "orphan",
        }),
      );
      const aggregate = await getAggregate(boardId);
      expect(aggregate.labels).toEqual([]);
      expect(aggregate.cards["card-x"].labelIds).toEqual([]);
      expect(aggregate.cards["card-x"].checklists).toBeUndefined();
    });
  });

  describe("card labels", () => {
    it("persists the m2m order with positions in the database", async () => {
      const boardId = await createBoard("M2M board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-m2m",
          title: "Todo",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-m2m",
          columnId: "col-m2m",
          title: "Card",
        }),
      );
      for (const id of ["lm-1", "lm-2", "lm-3"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_LABEL",
            label: { id, name: id, color: "red" },
          }),
        );
      }
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-m2m",
          labelId: "lm-1",
          on: true,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-m2m",
          labelId: "lm-3",
          on: true,
          index: 0,
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-m2m",
          labelId: "lm-2",
          on: true,
          index: 1,
        }),
      );

      const links = await prisma.cardLabel.findMany({
        where: { cardId: "card-m2m" },
        orderBy: { position: "asc" },
      });
      expect(links.map((link) => [link.labelId, link.position])).toEqual([
        ["lm-3", 0],
        ["lm-2", 1],
        ["lm-1", 2],
      ]);
      expect((await getAggregate(boardId)).cards["card-m2m"].labelIds).toEqual([
        "lm-3",
        "lm-2",
        "lm-1",
      ]);
    });

    it("cascades a deleted label out of every card and restores it", async () => {
      const boardId = await createBoard("Cascade board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-cas",
          title: "Todo",
        }),
      );
      for (const cardId of ["card-cas-1", "card-cas-2"]) {
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_CARD",
            newCardId: cardId,
            columnId: "col-cas",
            title: cardId,
          }),
        );
        await apply(
          boardId,
          scoped(boardId, {
            type: "ADD_LABEL",
            label: {
              id: `l-cas-${cardId.slice(-1)}`,
              name: cardId,
              color: "blue",
            },
          }),
        );
        await apply(
          boardId,
          scoped(boardId, {
            type: "SET_CARD_LABEL",
            cardId,
            labelId: `l-cas-${cardId.slice(-1)}`,
            on: true,
          }),
        );
      }

      const before = await getAggregate(boardId);
      const label = before.labels.find((entry) => entry.id === "l-cas-1");
      const assignments = Object.values(before.cards)
        .map((card) => ({
          cardId: card.id,
          index: card.labelIds.indexOf("l-cas-1"),
        }))
        .filter((assignment) => assignment.index !== -1);

      await apply(
        boardId,
        scoped(boardId, { type: "DELETE_LABEL", labelId: "l-cas-1" }),
      );

      const afterDelete = await getAggregate(boardId);
      expect(afterDelete.labels.map((entry) => entry.id)).toEqual(["l-cas-2"]);
      expect(afterDelete.cards["card-cas-1"].labelIds).toEqual([]);
      const labelRow = await prisma.label.findUnique({
        where: { id: "l-cas-1" },
      });
      expect(labelRow?.deletedAt).not.toBeNull();
      expect(
        await prisma.cardLabel.count({ where: { labelId: "l-cas-1" } }),
      ).toBe(0);

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_LABEL",
          label: label!,
          index: 0,
          assignments,
        }),
      );
      const links = await prisma.cardLabel.findMany({
        where: { labelId: "l-cas-1" },
      });
      expect(links).toHaveLength(1);
      expect(links[0].cardId).toBe("card-cas-1");
    });
  });

  describe("collection limits", () => {
    it("409s the 21st label on a card and survives the retry", async () => {
      const boardId = await importBoard("Card label limit", {
        labels: Array.from({ length: LIMITS.labelsPerCard }, (_, index) => ({
          id: `l-${index}`,
          name: `L${index}`,
          color: "red" as const,
        })),
        card: {
          labelIds: Array.from(
            { length: LIMITS.labelsPerCard },
            (_, index) => `l-${index}`,
          ),
        },
      });
      const cardId = await firstCardId(boardId);
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_LABEL",
          label: { id: "l-extra-card", name: "Extra", color: "blue" },
        }),
      );

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId,
          labelId: "l-extra-card",
          on: true,
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");

      // Detaching is always allowed.
      const labelId = (await getAggregate(boardId)).cards[cardId].labelIds[0];
      await apply(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId,
          labelId,
          on: false,
        }),
      );
    });

    it("409s the 51st label on the board but never an inverse", async () => {
      const boardId = await importBoard("Board label limit", {
        labels: Array.from({ length: LIMITS.labelsPerBoard }, (_, index) => ({
          id: `l-${index}`,
          name: `L${index}`,
          color: "red" as const,
        })),
        card: {},
      });

      const res = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_LABEL",
          label: { id: "l-extra-board", name: "Extra", color: "blue" },
        }),
      ).expect(409);
      expect(res.body.conflict).toBe("wip");

      // An inverse adds nothing new (undo of a delete): always allowed.
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_LABEL",
          label: { id: "l-restored", name: "Restored", color: "green" },
          index: 0,
          inverse: true,
        }),
      );
      const aggregate = await getAggregate(boardId);
      expect(aggregate.labels).toHaveLength(LIMITS.labelsPerBoard + 1);
      expect(aggregate.labels[0].id).toBe("l-restored");
    });

    it("409s the 21st checklist and the 101st item, but never an inverse", async () => {
      const boardId = await importBoard("Checklist limits", {
        card: {
          checklists: Array.from(
            { length: LIMITS.checklistsPerCard },
            (_, index) => ({
              id: `cl-${index}`,
              title: `C${index}`,
              // Only the first checklist is full: the item limit needs a
              // hundred rows, not two thousand.
              items:
                index === 0
                  ? Array.from(
                      { length: LIMITS.itemsPerChecklist },
                      (_, itemIndex) => ({
                        id: `it-${itemIndex}`,
                        text: "x",
                        done: false,
                      }),
                    )
                  : [],
            }),
          ),
        },
      });
      const cardId = await firstCardId(boardId);

      const checklist = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId,
          newChecklistId: "cl-extra",
          title: "Extra",
        }),
      ).expect(409);
      expect(checklist.body.conflict).toBe("wip");

      // Import remaps ids, so the full checklist is taken from the aggregate.
      const imported = await getAggregate(boardId);
      const fullChecklistId = imported.cards[cardId].checklists![0].id;
      const item = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId,
          checklistId: fullChecklistId,
          newItemId: "it-extra",
          text: "Extra",
        }),
      ).expect(409);
      expect(item.body.conflict).toBe("wip");

      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "RESTORE_CHECKLIST",
          cardId,
          checklist: { id: "cl-restored", title: "Restored", items: [] },
          index: 0,
          inverse: true,
        }),
      );
      const aggregate = await getAggregate(boardId);
      expect(aggregate.cards[cardId].checklists).toHaveLength(
        LIMITS.checklistsPerCard + 1,
      );
      expect(aggregate.cards[cardId].checklists?.[0].id).toBe("cl-restored");
    });

    it("lets a non-admin member attach labels and check checklists", async () => {
      const boardId = await createBoard("Member board");
      await invite(boardId, MEMBER_EMAIL, "MEMBER", memberToken);
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-mem",
          title: "Todo",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-mem",
          columnId: "col-mem",
          title: "Card",
        }),
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_LABEL",
          label: { id: "l-mem", name: "Bug", color: "red" },
        }),
        memberToken,
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CARD_LABEL",
          cardId: "card-mem",
          labelId: "l-mem",
          on: true,
        }),
        memberToken,
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId: "card-mem",
          newChecklistId: "cl-mem",
          title: "Steps",
        }),
        memberToken,
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-mem",
          checklistId: "cl-mem",
          newItemId: "it-mem",
          text: "One",
        }),
        memberToken,
      );
      await applyAndAssert(
        boardId,
        scoped(boardId, {
          type: "SET_CHECKLIST_ITEM_DONE",
          cardId: "card-mem",
          checklistId: "cl-mem",
          itemId: "it-mem",
          done: true,
        }),
        memberToken,
      );
    });
  });

  describe("validation and versions", () => {
    it("rejects malformed label/checklist actions with the offending field", async () => {
      const boardId = await createBoard("Label validation board");
      for (const [body, field] of [
        [
          { type: "ADD_LABEL", label: { id: "l", name: "", color: "red" } },
          "action.label.name",
        ],
        [
          { type: "SET_LABEL_COLOR", labelId: "l", color: "mauve" },
          "action.color",
        ],
        [
          {
            type: "SET_CARD_LABEL",
            cardId: "c",
            labelId: "l",
            on: "yes",
          },
          "action.on",
        ],
        [
          {
            type: "ADD_CHECKLIST",
            cardId: "c",
            newChecklistId: "cl",
            title: " ",
          },
          "action.title",
        ],
        [
          {
            type: "SET_CHECKLIST_ITEM_DONE",
            cardId: "c",
            checklistId: "cl",
            itemId: "i",
            done: 1,
          },
          "action.done",
        ],
      ] as const) {
        const res = await post(boardId, scoped(boardId, body)).expect(400);
        expect(res.body.field).toBe(field);
      }
    });

    it("reports versions and touches for label and checklist rows", async () => {
      const boardId = await createBoard("Label versions board");
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_COLUMN",
          newColumnId: "col-ver",
          title: "Todo",
        }),
      );
      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CARD",
          newCardId: "card-ver",
          columnId: "col-ver",
          title: "Card",
        }),
      );
      const labelRes = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_LABEL",
          label: { id: "l-ver", name: "Bug", color: "red" },
        }),
      ).expect(200);
      expect(labelRes.body.versions["label:l-ver"]).toEqual(expect.any(Number));

      await apply(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST",
          cardId: "card-ver",
          newChecklistId: "cl-ver",
          title: "Steps",
        }),
      );
      const itemRes = await post(
        boardId,
        scoped(boardId, {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-ver",
          checklistId: "cl-ver",
          newItemId: "it-ver",
          text: "One",
        }),
      ).expect(200);
      expect(itemRes.body.versions["checklist:cl-ver"]).toEqual(
        expect.any(Number),
      );
      expect(itemRes.body.versions["checklistItem:it-ver"]).toEqual(
        expect.any(Number),
      );
      expect(itemRes.body.versions["card:card-ver"]).toEqual(
        expect.any(Number),
      );

      const command = await prisma.command.findFirst({
        where: { boardId, type: "ADD_CHECKLIST_ITEM" },
      });
      expect(command?.touches).toEqual(
        expect.arrayContaining([
          "card:card-ver",
          "checklist:cl-ver",
          "checklistItem:it-ver",
        ]),
      );
    });
  });

  /** Import a one-card board with optional labels and card content. */
  async function importBoard(
    title: string,
    input: {
      labels?: Board["labels"];
      card?: {
        labelIds?: string[];
        checklists?: Board["cards"][string]["checklists"];
      };
    },
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
          labels: input.labels ?? [],
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
              labelIds: input.card?.labelIds ?? [],
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
              ...(input.card?.checklists
                ? { checklists: input.card.checklists }
                : {}),
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
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
