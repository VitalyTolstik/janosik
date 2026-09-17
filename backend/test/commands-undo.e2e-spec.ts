import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction } from "@janosik/shared";
import { invert } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "commands-undo@example.com";
const PASSWORD = "correct horse battery";

/**
 * The undo half of the command contract (TASK-30.2).
 *
 * No backend test imported `invert` before, so "applying the inverse returns
 * the board to what it was" was never asserted server-side — and the redo of
 * create commands was broken for months because of exactly that gap. For
 * every invertible action: apply it, apply the inverse `invert()` computed
 * from the pristine aggregate, and require the aggregate to deep-equal the
 * board before the command — timestamps included.
 */
describe("Undo contract: command then inverse (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let boardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipe(prisma);

    token = await register();
    const created = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title: "Undo board" })
      .expect(201);
    boardId = created.body.id as string;

    // A board that contains one of everything: two columns, three cards
    // (two in the first column, so sorting has something to reorder), a
    // label attached to a card, a checklist with an item, a due date and a
    // cover — every case below has real state to change and restore.
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-1",
      title: "Todo",
    });
    await command({
      type: "ADD_COLUMN",
      newColumnId: "col-2",
      title: "Doing",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-3",
      columnId: "col-1",
      title: "Zulu",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-1",
      columnId: "col-1",
      title: "Alpha",
    });
    await command({
      type: "ADD_CARD",
      newCardId: "card-2",
      columnId: "col-2",
      title: "Beta",
    });
    await command({
      type: "ADD_LABEL",
      label: { id: "l-1", name: "Bug", color: "red" },
    });
    await command({
      type: "SET_CARD_LABEL",
      cardId: "card-1",
      labelId: "l-1",
      on: true,
    });
    await command({
      type: "ADD_CHECKLIST",
      cardId: "card-1",
      newChecklistId: "cl-1",
      title: "Steps",
    });
    await command({
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-1",
      checklistId: "cl-1",
      newItemId: "it-1",
      text: "one",
    });
    await command({
      type: "SET_CARD_DUE_DATE",
      cardId: "card-1",
      dueDate: 1_700_000_500_000,
    });
    await command({
      type: "SET_CARD_COVER",
      cardId: "card-1",
      cover: { type: "gradient", value: "ocean" },
    });
    await command({
      type: "UPDATE_CARD",
      cardId: "card-1",
      description: "notes",
    });
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let clock = 1_700_000_000_000;
  const tick = () => (clock += 1000);

  function register(): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "Undo" })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  function scoped(body: Record<string, unknown>): BoardAction {
    return { boardId, at: tick(), ...body } as unknown as BoardAction;
  }

  /** `POST /boards/:id/commands` with a fresh idempotency key. */
  async function command(body: Record<string, unknown>): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth())
      .send({ commandId: randomUUID(), action: scoped(body) })
      .expect(200);
  }

  async function getAggregate(): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .expect(200);
    return res.body as Board;
  }

  it("returns the exact aggregate for every invertible action", async () => {
    const before = await getAggregate();

    const cases: Array<[string, Record<string, unknown>]> = [
      ["RENAME_BOARD", { type: "RENAME_BOARD", title: "Renamed" }],
      [
        "RENAME_COLUMN",
        { type: "RENAME_COLUMN", columnId: "col-1", title: "Backlog" },
      ],
      [
        "MOVE_COLUMN",
        { type: "MOVE_COLUMN", columnId: "col-1", fromIndex: 0, toIndex: 1 },
      ],
      [
        "SORT_COLUMN",
        { type: "SORT_COLUMN", columnId: "col-1", sortBy: "title" },
      ],
      [
        "RENAME_LABEL",
        { type: "RENAME_LABEL", labelId: "l-1", name: "Renamed" },
      ],
      [
        "SET_LABEL_COLOR",
        { type: "SET_LABEL_COLOR", labelId: "l-1", color: "brand" },
      ],
      [
        "SET_CARD_LABEL",
        { type: "SET_CARD_LABEL", cardId: "card-1", labelId: "l-1", on: false },
      ],
      [
        "UPDATE_CARD",
        {
          type: "UPDATE_CARD",
          cardId: "card-1",
          title: "Edited",
          description: "new",
        },
      ],
      ["TOUCH_CARD", { type: "TOUCH_CARD", cardId: "card-1" }],
      ["SET_CARD_DUE_DATE", { type: "SET_CARD_DUE_DATE", cardId: "card-1" }],
      [
        "SET_CARD_COVER",
        { type: "SET_CARD_COVER", cardId: "card-1", cover: null },
      ],
      [
        "MOVE_CARD",
        {
          type: "MOVE_CARD",
          cardId: "card-1",
          fromColumnId: "col-1",
          fromIndex: 1,
          toColumnId: "col-2",
          toIndex: 1,
        },
      ],
      [
        "ARCHIVE_CARD",
        { type: "ARCHIVE_CARD", cardId: "card-1", archivedAt: clock + 5000 },
      ],
      [
        "ARCHIVE_COLUMN_CARDS",
        { type: "ARCHIVE_COLUMN_CARDS", columnId: "col-1" },
      ],
      [
        "SET_CHECKLIST_ITEM_DONE",
        {
          type: "SET_CHECKLIST_ITEM_DONE",
          cardId: "card-1",
          checklistId: "cl-1",
          itemId: "it-1",
          done: true,
        },
      ],
      [
        "RENAME_CHECKLIST",
        {
          type: "RENAME_CHECKLIST",
          cardId: "card-1",
          checklistId: "cl-1",
          title: "Renamed",
        },
      ],
      [
        "RENAME_CHECKLIST_ITEM",
        {
          type: "RENAME_CHECKLIST_ITEM",
          cardId: "card-1",
          checklistId: "cl-1",
          itemId: "it-1",
          text: "renamed",
        },
      ],
    ];

    for (const [type, body] of cases) {
      const action = scoped(body);
      const inverse = invert(before, action);
      if (inverse === null) throw new Error(`${type}: no inverse`);

      await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth())
        .send({ commandId: randomUUID(), action })
        .expect(200);
      await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth())
        .send({ commandId: randomUUID(), action: inverse })
        .expect(200);

      const after = await getAggregate();
      try {
        expect(after).toEqual(before);
      } catch (error) {
        throw new Error(
          `${type}: undo did not restore the aggregate\n${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }, 60_000);

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
    await db.board.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
