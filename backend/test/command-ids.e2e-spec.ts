import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Board } from "@janosik/shared";
import { LIMITS, MAX_COMMAND_BYTES } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const EMAIL = "commands-ids@example.com";
const PASSWORD = "correct horse battery";

/**
 * Entity id ownership and command payload limits (TASK-30.2).
 *
 * Entity ids are global primary keys while commands are board-scoped: an id
 * that already lives on another board must be refused (409) instead of
 * being rewritten by the upserts; oversize commands are refused (413) and
 * the json body limit is explicit instead of Express's implicit 100 KB.
 */
describe("Command ids and payload limits (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let boardA: string;
  let boardB: string;

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
    boardA = await createBoard("Ids A");
    boardB = await createBoard("Ids B");

    // Board A owns one of everything, so every id below is foreign on B.
    await apply(boardA, {
      type: "ADD_COLUMN",
      newColumnId: "col-a",
      title: "A column",
    });
    await apply(boardA, {
      type: "ADD_CARD",
      newCardId: "card-a",
      columnId: "col-a",
      title: "A card",
    });
    await apply(boardA, {
      type: "ADD_CARD",
      newCardId: "card-a2",
      columnId: "col-a",
      title: "A second card",
    });
    await apply(boardA, {
      type: "ADD_CARD_LINK",
      cardId: "card-a",
      linkId: "link-a",
      targetCardId: "card-a2",
      linkType: "blocks",
    });
    await apply(boardA, {
      type: "ADD_LABEL",
      label: { id: "l-a", name: "A label", color: "red" },
    });
    await apply(boardA, {
      type: "ADD_CHECKLIST",
      cardId: "card-a",
      newChecklistId: "cl-a",
      title: "A checklist",
    });
    await apply(boardA, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: "card-a",
      checklistId: "cl-a",
      newItemId: "it-a",
      text: "A item",
    });

    // Board B gets its own column, card and empty checklist.
    await apply(boardB, {
      type: "ADD_COLUMN",
      newColumnId: "col-b",
      title: "B column",
    });
    await apply(boardB, {
      type: "ADD_CARD",
      newCardId: "card-b",
      columnId: "col-b",
      title: "B card",
    });
    await apply(boardB, {
      type: "ADD_CARD",
      newCardId: "card-b2",
      columnId: "col-b",
      title: "B second card",
    });
    await apply(boardB, {
      type: "ADD_CHECKLIST",
      cardId: "card-b",
      newChecklistId: "cl-b",
      title: "B checklist",
    });
  });

  afterAll(async () => {
    await wipe(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Near the server clock: commands outside its ±5 min skew window get
  // their `at` replaced (B-5), which would break the reducer contract.
  let clock = Date.now() - 120_000;
  const scoped = (boardId: string, body: Record<string, unknown>) => ({
    boardId,
    at: (clock += 100),
    ...body,
  });

  function register(): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email: EMAIL, password: PASSWORD, displayName: "Ids" })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title })
      .expect(201);
    return res.body.id as string;
  }

  function post(boardId: string, action: Record<string, unknown>) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth())
      .send({ commandId: randomUUID(), action: scoped(boardId, action) });
  }

  async function apply(
    boardId: string,
    action: Record<string, unknown>,
  ): Promise<void> {
    await post(boardId, action).expect(200);
  }

  async function getAggregate(boardId: string): Promise<Board> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth())
      .expect(200);
    return res.body as Board;
  }

  it("rejects a foreign entity id in every create-shaped action", async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        "ADD_COLUMN",
        { type: "ADD_COLUMN", newColumnId: "col-a", title: "Stolen" },
        "column:col-a",
      ],
      [
        "ADD_CARD",
        {
          type: "ADD_CARD",
          newCardId: "card-a",
          columnId: "col-b",
          title: "Stolen",
        },
        "card:card-a",
      ],
      [
        "ADD_LABEL",
        {
          type: "ADD_LABEL",
          label: { id: "l-a", name: "Stolen", color: "red" },
        },
        "label:l-a",
      ],
      [
        "DUPLICATE_COLUMN",
        {
          type: "DUPLICATE_COLUMN",
          columnId: "col-b",
          newColumnId: "col-a",
          newCardIds: [],
        },
        "column:col-a",
      ],
      [
        "ADD_CHECKLIST_ITEM",
        {
          type: "ADD_CHECKLIST_ITEM",
          cardId: "card-b",
          checklistId: "cl-b",
          newItemId: "it-a",
          text: "Stolen",
        },
        "checklistItem:it-a",
      ],
      [
        "RESTORE_CARD",
        {
          type: "RESTORE_CARD",
          card: {
            id: "card-a",
            title: "Stolen",
            labelIds: [],
            createdAt: clock,
            updatedAt: clock,
          },
          columnId: "col-b",
          index: 0,
        },
        "card:card-a",
      ],
      [
        "RESTORE_LABEL",
        {
          type: "RESTORE_LABEL",
          label: { id: "l-a", name: "Stolen", color: "red" },
          index: 0,
        },
        "label:l-a",
      ],
      // TASK-46: the writer upserts the link row by this id, so a foreign
      // one would repoint another board's row at this board's cards.
      [
        "ADD_CARD_LINK",
        {
          type: "ADD_CARD_LINK",
          cardId: "card-b",
          linkId: "link-a",
          targetCardId: "card-b2",
          linkType: "relates_to",
        },
        "cardLink:link-a",
      ],
    ];

    for (const [, action, expected] of cases) {
      const res = await post(boardB, action).expect(409);
      expect(res.body.field).toBe("action");
      expect(String(res.body.message)).toContain(expected);
      expect(String(res.body.message)).toContain("another board");
    }
  });

  it("leaves both boards untouched by the rejected commands", async () => {
    const beforeA = await getAggregate(boardA);
    const beforeB = await getAggregate(boardB);

    await post(boardB, {
      type: "ADD_COLUMN",
      newColumnId: "col-a",
      title: "Stolen",
    }).expect(409);
    await post(boardB, {
      type: "RESTORE_CARD",
      card: {
        id: "card-a",
        title: "Stolen",
        labelIds: [],
        createdAt: clock,
        updatedAt: clock,
      },
      columnId: "col-b",
      index: 0,
    }).expect(409);

    expect(await getAggregate(boardA)).toEqual(beforeA);
    expect(await getAggregate(boardB)).toEqual(beforeB);
  });

  it("leaves the other board's link row untouched (TASK-46)", async () => {
    const before = await prisma.cardLink.findUnique({
      where: { id: "link-a" },
    });
    expect(before).toMatchObject({ fromCardId: "card-a", type: "blocks" });

    await post(boardB, {
      type: "ADD_CARD_LINK",
      cardId: "card-b",
      linkId: "link-a",
      targetCardId: "card-b2",
      linkType: "relates_to",
    }).expect(409);
    await post(boardB, {
      type: "REMOVE_CARD_LINK",
      cardId: "card-b",
      linkId: "link-a",
      targetCardId: "card-b2",
      linkType: "relates_to",
    }).expect(409);

    expect(
      await prisma.cardLink.findUnique({ where: { id: "link-a" } }),
    ).toEqual(before);
    const a = await getAggregate(boardA);
    expect(a.cards["card-a"].links).toEqual([
      { id: "link-a", type: "blocks", targetCardId: "card-a2" },
    ]);
  });

  it("still revives its own soft-deleted entities (redo path)", async () => {
    await apply(boardB, { type: "DELETE_COLUMN", columnId: "col-b" });
    await apply(boardB, {
      type: "ADD_COLUMN",
      newColumnId: "col-b",
      title: "B column",
    });
    const board = await getAggregate(boardB);
    expect(board.columns.map((column) => column.id)).toContain("col-b");
  });

  it("rejects an oversized command with 413", async () => {
    const huge = Array.from({ length: 120_000 }, (_, index) =>
      String(index).padStart(30, "0"),
    );
    const res = await post(boardB, {
      type: "RENAME_BOARD",
      title: "Huge",
      activityIds: huge,
    }).expect(413);
    expect(res.body.field).toBe("action");
    expect(String(res.body.message)).toContain(String(MAX_COMMAND_BYTES));
  });

  it("accepts a large RESTORE_CARD that used to die in the body parser", async () => {
    const bigCard = {
      id: "card-big",
      title: "Big",
      description: "d".repeat(LIMITS.description),
      labelIds: [],
      createdAt: clock,
      updatedAt: clock,
      checklists: Array.from({ length: LIMITS.checklistsPerCard }, (_, c) => ({
        id: `cl-big-${c}`,
        title: "C",
        items: Array.from({ length: LIMITS.itemsPerChecklist }, (_, i) => ({
          id: `it-big-${c}-${i}`,
          text: "t".repeat(LIMITS.checklistItem),
          done: false,
        })),
      })),
    };
    // Well over Express's implicit 100 KB, well under MAX_COMMAND_BYTES.
    const bytes = Buffer.byteLength(JSON.stringify(bigCard));
    expect(bytes).toBeGreaterThan(100 * 1024);
    expect(bytes).toBeLessThan(MAX_COMMAND_BYTES);

    await apply(boardB, {
      type: "RESTORE_CARD",
      card: bigCard,
      columnId: "col-b",
      index: 0,
    });

    const board = await getAggregate(boardB);
    expect(board.cards["card-big"]?.description).toHaveLength(
      LIMITS.description,
    );
  });

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
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.apiToken.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
