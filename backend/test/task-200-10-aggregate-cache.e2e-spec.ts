import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { argon2id, hash as argonHash } from "argon2";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import * as boardAggregateModule from "@/boards/board-aggregate";
import {
  BOARD_AGGREGATE_CACHE_CONFIG,
  BoardAggregateCacheService,
} from "@/boards/board-aggregate-cache";
import { BoardAggregateLoader } from "@/boards/board-aggregate-loader";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AccountDeletionService } from "@/users/account-deletion.service";
import { MaintenanceService } from "@/ops/maintenance.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "aggregate-cache@example.com";
const PASSWORD = "correct horse battery";
const ADMIN_EMAIL = "aggregate-cache-master@example.com";
const ADMIN_PASSWORD = "master correct horse battery";
const PDF = Buffer.from("%PDF-1.4\n% aggregate cache e2e\n");

/**
 * TASK-200.10: the revision-keyed full-board aggregate cache.
 *
 * Enabled explicitly here (the suite-wide test default is `0`, like every
 * other cache) with a provider override. The assertions are about
 * correctness, not speed: a cache hit must produce the same aggregate as a
 * fresh database load, a changed revision must never be served stale, and
 * out-of-band writers (comments, attachments, claims/session end, admin
 * restore) must move the revision and force a reload.
 */
describe("Board aggregate cache (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cache: BoardAggregateCacheService;
  let loader: BoardAggregateLoader;
  let session: string;
  let ownerId: string;
  let adminToken: string;

  const load = jest.spyOn(
    boardAggregateModule,
    "loadBoardAggregateWithRevision",
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BOARD_AGGREGATE_CACHE_CONFIG)
      .useValue({ entries: 16, bytes: 16 * 1024 * 1024 })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    prisma = app.get(PrismaService);
    cache = app.get(BoardAggregateCacheService);
    loader = app.get(BoardAggregateLoader);
    await wipeAll(prisma);

    const registration = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    session = registration.body.accessToken as string;
    ownerId = registration.body.user.id as string;

    await prisma.adminUser.create({
      data: {
        email: ADMIN_EMAIL,
        displayName: "Master",
        role: "OWNER",
        passwordHash: await argonHash(ADMIN_PASSWORD, { type: argon2id }),
      },
    });
    adminToken = await server()
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200)
      .then((res) => res.body.accessToken as string);
  });

  afterAll(async () => {
    load.mockRestore();
    await wipeAll(prisma);
    await app.close();
  });

  beforeEach(() => {
    cache.clear();
    load.mockClear();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function revision(boardId: string): Promise<bigint> {
    const row = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { aggregateRevision: true },
    });
    return row.aggregateRevision;
  }

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function command(
    boardId: string,
    action: Record<string, unknown>,
    options: { token?: string; headers?: Record<string, string> } = {},
  ) {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(options.token ?? session))
      .set(options.headers ?? {})
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
    if (res.status !== 200) {
      throw new Error(
        `Command ${String(action.type)} failed (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
    return res.body as { seq: number; versions: Record<string, number> };
  }

  async function batch(
    boardId: string,
    actions: Record<string, unknown>[],
  ): Promise<{ results: Array<{ seq: number }> }> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(session))
      .send({
        commands: actions.map((action) => ({
          commandId: randomUUID(),
          action: { boardId, at: Date.now(), ...action },
        })),
      });
    if (res.status !== 200) {
      throw new Error(
        `Batch failed (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
    return res.body as { results: Array<{ seq: number }> };
  }

  async function createToken(boardId: string, name: string): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name, boardId, scopePreset: "admin" })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  /**
   * The cached snapshot must be a deep equal of a fresh load at the board's
   * committed revision, and the loader must answer from the cache without
   * touching the primitive.
   */
  async function expectCacheMatchesDatabase(
    boardId: string,
    label: string,
  ): Promise<bigint> {
    const rev = await revision(boardId);
    const cached = cache.get(boardId, rev);
    const fresh = await boardAggregateModule.loadBoardAggregateWithRevision(
      prisma,
      boardId,
    );
    expect(fresh).not.toBeNull();
    if (cached === null) {
      throw new Error(`${label}: no cached aggregate at revision ${rev}`);
    }
    expect(cached).toEqual(fresh!.board);

    load.mockClear();
    const viaLoader = await loader.load(prisma, boardId);
    expect(load).not.toHaveBeenCalled();
    expect(viaLoader).toEqual(fresh!.board);
    return rev;
  }

  /**
   * An out-of-band writer (comment, attachment, session end, direct admin
   * restore) moves the revision without going through the command cache path.
   * The old entry must no longer be served, and the next load must miss,
   * query and cache the new revision.
   */
  async function expectReloadAfterExternalWrite(
    boardId: string,
    label: string,
    before: bigint,
  ): Promise<bigint> {
    const after = await revision(boardId);
    expect(after).toBeGreaterThan(before);
    const stale = cache.get(boardId, after);
    if (stale !== null) {
      throw new Error(
        `${label}: served a pre-write aggregate as revision ${after}`,
      );
    }

    load.mockClear();
    const reloaded = await loader.loadWithRevision(prisma, boardId);
    expect(load).toHaveBeenCalledTimes(1);
    expect(reloaded?.revision).toBe(after);
    const fresh = await boardAggregateModule.loadBoardAggregateWithRevision(
      prisma,
      boardId,
    );
    expect(reloaded?.board).toEqual(fresh!.board);
    expect(cache.revisionOf(boardId)).toBe(after);
    return after;
  }

  /**
   * Some admin restores are implemented as ordinary commands (a card restore
   * goes through `RESTORE_CARD`), so the writer has already cached the new
   * revision. Either way the entry at the new revision must be the fresh
   * content, never the pre-restore snapshot under a newer key.
   */
  async function expectFreshCacheAfterWrite(
    boardId: string,
    label: string,
    before: bigint,
  ): Promise<bigint> {
    const after = await revision(boardId);
    expect(after).toBeGreaterThan(before);
    const fresh = await boardAggregateModule.loadBoardAggregateWithRevision(
      prisma,
      boardId,
    );
    const cached = cache.get(boardId, after);
    if (cached === null) {
      throw new Error(`${label}: no cached aggregate at revision ${after}`);
    }
    expect(cached).toEqual(fresh!.board);

    load.mockClear();
    const reloaded = await loader.loadWithRevision(prisma, boardId);
    expect(load).not.toHaveBeenCalled();
    expect(reloaded?.revision).toBe(after);
    expect(reloaded?.board).toEqual(fresh!.board);
    return after;
  }

  it("serves a second consecutive command from the cache with no aggregate SELECT", async () => {
    const boardId = await createBoard("Consecutive commands");
    const columnId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    const firstCard = randomUUID();
    const secondCard = randomUUID();
    for (const [newCardId, title] of [
      [firstCard, "First"],
      [secondCard, "Second"],
    ] as const) {
      await command(boardId, {
        type: "ADD_CARD",
        newCardId,
        columnId,
        title,
      });
    }

    cache.clear();
    load.mockClear();

    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: firstCard,
      description: "one snapshot",
    });
    // Human command: no pre-lock classification, one in-transaction load.
    expect(load).toHaveBeenCalledTimes(1);
    const afterFirst = await revision(boardId);
    expect(cache.revisionOf(boardId)).toBe(afterFirst);
    expect(await expectCacheMatchesDatabase(boardId, "after first")).toBe(
      afterFirst,
    );

    load.mockClear();
    const second = await command(boardId, {
      type: "UPDATE_CARD",
      cardId: secondCard,
      description: "no reload",
    });
    // The revision from the transaction's board row matches the entry stored
    // after the first commit, so the second command issues no aggregate
    // SELECT at all.
    expect(load).not.toHaveBeenCalled();
    const afterSecond = await revision(boardId);
    expect(afterSecond).toBeGreaterThan(afterFirst);
    expect(second.seq).toBeGreaterThan(0);
    expect(await expectCacheMatchesDatabase(boardId, "after second")).toBe(
      afterSecond,
    );

    const board = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(session))
      .expect(200)
      .then((res) => res.body);
    expect(board.cards[firstCard].description).toBe("one snapshot");
    expect(board.cards[secondCard].description).toBe("no reload");
  });

  it("keeps the cached aggregate identical to a fresh load after representative actions", async () => {
    const boardId = await createBoard("Parity board");
    const firstColumn = randomUUID();
    const secondColumn = randomUUID();
    const labelId = randomUUID();

    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: firstColumn,
      title: "Todo",
    });
    await expectCacheMatchesDatabase(boardId, "add column");
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: secondColumn,
      title: "Doing",
    });
    await expectCacheMatchesDatabase(boardId, "add second column");

    await command(boardId, {
      type: "ADD_LABEL",
      label: { id: labelId, name: "Bug", color: "red" },
    });
    await expectCacheMatchesDatabase(boardId, "add label");
    await command(boardId, {
      type: "RENAME_LABEL",
      labelId,
      name: "Defect",
    });
    await expectCacheMatchesDatabase(boardId, "rename label");

    const firstCard = randomUUID();
    const secondCard = randomUUID();
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: firstCard,
      columnId: firstColumn,
      title: "First",
    });
    await expectCacheMatchesDatabase(boardId, "add card");
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: secondCard,
      columnId: secondColumn,
      title: "Second",
    });
    await expectCacheMatchesDatabase(boardId, "add second card");

    const linkId = randomUUID();
    await command(boardId, {
      type: "ADD_CARD_LINK",
      cardId: firstCard,
      linkId,
      targetCardId: secondCard,
      linkType: "relates_to",
    });
    await expectCacheMatchesDatabase(boardId, "add card link");
    await command(boardId, {
      type: "REMOVE_CARD_LINK",
      cardId: firstCard,
      linkId,
      targetCardId: secondCard,
      linkType: "relates_to",
    });
    await expectCacheMatchesDatabase(boardId, "remove card link");

    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: firstCard,
      title: "First edited",
      description: "notes",
      priority: "high",
    });
    await expectCacheMatchesDatabase(boardId, "update card");
    await command(boardId, {
      type: "SET_CARD_LABEL",
      cardId: firstCard,
      labelId,
      on: true,
    });
    await expectCacheMatchesDatabase(boardId, "set card label");
    await command(boardId, {
      type: "SET_CARD_DUE_DATE",
      cardId: firstCard,
      dueDate: 1_700_500_000_000,
    });
    await expectCacheMatchesDatabase(boardId, "set due date");

    const checklistId = randomUUID();
    const itemId = randomUUID();
    await command(boardId, {
      type: "ADD_CHECKLIST",
      cardId: firstCard,
      newChecklistId: checklistId,
      title: "Steps",
    });
    await expectCacheMatchesDatabase(boardId, "add checklist");
    await command(boardId, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: firstCard,
      checklistId,
      newItemId: itemId,
      text: "One",
    });
    await expectCacheMatchesDatabase(boardId, "add checklist item");
    await command(boardId, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: firstCard,
      checklistId,
      itemId,
      done: true,
    });
    await expectCacheMatchesDatabase(boardId, "toggle checklist item");
    await command(boardId, {
      type: "RENAME_CHECKLIST_ITEM",
      cardId: firstCard,
      checklistId,
      itemId,
      text: "Edited item",
    });
    await expectCacheMatchesDatabase(boardId, "rename checklist item");

    await command(boardId, {
      type: "MOVE_CARD",
      cardId: firstCard,
      fromColumnId: firstColumn,
      fromIndex: 0,
      toColumnId: secondColumn,
      toIndex: 0,
    });
    await expectCacheMatchesDatabase(boardId, "move card");
    await command(boardId, {
      type: "ARCHIVE_CARD",
      cardId: firstCard,
    });
    await expectCacheMatchesDatabase(boardId, "archive card");
    await command(boardId, {
      type: "UNARCHIVE_CARD",
      cardId: firstCard,
    });
    await expectCacheMatchesDatabase(boardId, "unarchive card");

    await command(boardId, {
      type: "MOVE_COLUMN",
      columnId: secondColumn,
      fromIndex: 1,
      toIndex: 0,
    });
    await expectCacheMatchesDatabase(boardId, "move column");
    await command(boardId, {
      type: "RENAME_COLUMN",
      columnId: firstColumn,
      title: "Backlog",
    });
    await expectCacheMatchesDatabase(boardId, "rename column");
    await command(boardId, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: firstColumn,
      wipLimit: 3,
    });
    await expectCacheMatchesDatabase(boardId, "set column wip limit");
    await command(boardId, {
      type: "SET_COLUMN_ACCENT",
      columnId: firstColumn,
      accent: { type: "color", value: "blue" },
    });
    await expectCacheMatchesDatabase(boardId, "set column accent");
    await command(boardId, {
      type: "SET_BOARD_COLUMN_STYLE",
      columnStyle: "glow",
    });
    await expectCacheMatchesDatabase(boardId, "set board column style");

    await command(boardId, {
      type: "DELETE_CHECKLIST_ITEM",
      cardId: firstCard,
      checklistId,
      itemId,
    });
    await expectCacheMatchesDatabase(boardId, "delete checklist item");
    await command(boardId, { type: "DELETE_LABEL", labelId });
    await expectCacheMatchesDatabase(boardId, "delete label");
    await command(boardId, { type: "DELETE_CARD", cardId: secondCard });
    await expectCacheMatchesDatabase(boardId, "delete card");
    await command(boardId, { type: "DELETE_COLUMN", columnId: firstColumn });
    await expectCacheMatchesDatabase(boardId, "delete column");
    await command(boardId, { type: "RENAME_BOARD", title: "Renamed" });
    await expectCacheMatchesDatabase(boardId, "rename board");
  });

  it("caches a column delete with active and archived cards like a fresh load", async () => {
    const boardId = await createBoard("Column delete parity");
    const columnId = randomUUID();
    const activeCard = randomUUID();
    const archivedCard = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Doomed",
    });
    for (const [newCardId, title] of [
      [activeCard, "Active"],
      [archivedCard, "Archived"],
    ] as const) {
      await command(boardId, { type: "ADD_CARD", newCardId, columnId, title });
    }
    await command(boardId, { type: "ARCHIVE_CARD", cardId: archivedCard });
    await expectCacheMatchesDatabase(boardId, "before column delete");
    const beforeDelete = (await loader.loadWithRevision(prisma, boardId))!
      .board;
    const doomedColumn = beforeDelete.columns.find(
      (column) => column.id === columnId,
    )!;
    const doomedCards = doomedColumn.cardIds.map(
      (id) => beforeDelete.cards[id]!,
    );

    await command(boardId, { type: "DELETE_COLUMN", columnId });
    await expectCacheMatchesDatabase(boardId, "after column delete");

    const deleted = (await loader.loadWithRevision(prisma, boardId))!.board;
    // The active card leaves the aggregate with the column; the archived card
    // survives on the invisible orphan column and stays byte-identical.
    expect(deleted.cards[activeCard]).toBeUndefined();
    expect(deleted.cards[archivedCard]).toMatchObject({
      title: "Archived",
      archivedAt: expect.any(Number),
    });

    await command(boardId, {
      type: "RESTORE_COLUMN",
      column: doomedColumn,
      index: 0,
      cards: doomedCards,
    });
    await expectCacheMatchesDatabase(boardId, "after column restore");
    const restored = (await loader.loadWithRevision(prisma, boardId))!.board;
    expect(restored.cards[activeCard]?.title).toBe("Active");
  });

  it("overlays writer-only card fields on a duplicated card", async () => {
    const boardId = await createBoard("Duplicate parity");
    const columnId = randomUUID();
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Source",
    });
    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(session))
      .attach("file", PDF, {
        filename: "source.pdf",
        contentType: "application/pdf",
      })
      .expect(201);

    // Let the loader pick up the out-of-band attachment revision first.
    const loaded = await loader.loadWithRevision(prisma, boardId);
    expect(loaded?.board.cards[cardId]?.attachmentCount).toBe(1);
    await expectCacheMatchesDatabase(boardId, "before duplicate");

    const copyId = randomUUID();
    await command(boardId, {
      type: "DUPLICATE_CARD",
      cardId,
      newCardId: copyId,
      title: "Copy",
    });
    await expectCacheMatchesDatabase(boardId, "after duplicate");

    const cached = cache.get(boardId, await revision(boardId))!;
    // The reducer spreads the source and would copy its attachment badge;
    // the copy has no attachment rows, and the writer-only overlay clears it.
    expect(cached.cards[copyId]?.attachmentCount).toBeUndefined();
    expect(cached.cards[copyId]?.lastActorId).toBe(ownerId);
    expect(cached.cards[cardId]?.attachmentCount).toBe(1);
  });

  it("keeps parity for workflow repair, board archive and a multi-command batch", async () => {
    const boardId = await createBoard("Workflow parity");
    const firstColumn = randomUUID();
    const doneColumn = randomUUID();
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: firstColumn,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: doneColumn,
      title: "Done",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: firstColumn,
      title: "Task",
    });

    // Simulate a board written before validation existed: the aggregate
    // exposes `workflowInvalid` until an ADMIN repairs or clears it.
    await prisma.board.update({
      where: { id: boardId },
      data: { workflow: { schemaVersion: 99 } as Prisma.InputJsonValue },
    });
    const workflow = {
      schemaVersion: 1,
      enabled: true,
      doneColumnIds: [doneColumn],
      transitions: [
        {
          id: randomUUID(),
          fromColumnId: firstColumn,
          toColumnId: doneColumn,
          allowedRoles: ["ADMIN", "MEMBER"],
        },
      ],
    };
    await command(boardId, { type: "SET_BOARD_WORKFLOW", workflow });
    await expectCacheMatchesDatabase(boardId, "repaired workflow");
    const repaired = cache.get(boardId, await revision(boardId))!;
    expect(repaired.workflow).toEqual(workflow);
    expect(repaired.workflowInvalid).toBeUndefined();

    await command(boardId, { type: "SET_BOARD_WORKFLOW" });
    await expectCacheMatchesDatabase(boardId, "cleared workflow");
    const cleared = cache.get(boardId, await revision(boardId))!;
    expect(cleared.workflow).toBeUndefined();
    expect(cleared.workflowInvalid).toBeUndefined();

    load.mockClear();
    const batched = await batch(boardId, [
      { type: "UPDATE_CARD", cardId, title: "Batched title" },
      { type: "SET_CARD_PRIORITY", cardId, priority: "high" },
      { type: "TOUCH_CARD", cardId },
    ]);
    expect(batched.results).toHaveLength(3);
    expect(load).not.toHaveBeenCalled();
    await expectCacheMatchesDatabase(boardId, "after batch");

    await command(boardId, { type: "ARCHIVE_BOARD" });
    await expectCacheMatchesDatabase(boardId, "after board archive");
    expect(cache.get(boardId, await revision(boardId))!.archivedAt).toEqual(
      expect.any(Number),
    );

    await command(boardId, { type: "UNARCHIVE_BOARD" });
    await expectCacheMatchesDatabase(boardId, "after board unarchive");
    expect(
      cache.get(boardId, await revision(boardId))!.archivedAt,
    ).toBeUndefined();
  });

  it("keeps parity for label/checklist restores, bulk archive and a column copy", async () => {
    const boardId = await createBoard("Restore parity");
    const columnId = randomUUID();
    const cardId = randomUUID();
    const labelId = randomUUID();
    const checklistId = randomUUID();
    const itemId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Task",
    });
    await command(boardId, {
      type: "ADD_LABEL",
      label: { id: labelId, name: "Bug", color: "red" },
    });
    await command(boardId, {
      type: "SET_CARD_LABEL",
      cardId,
      labelId,
      on: true,
    });
    await command(boardId, {
      type: "ADD_CHECKLIST",
      cardId,
      newChecklistId: checklistId,
      title: "Steps",
    });
    await command(boardId, {
      type: "ADD_CHECKLIST_ITEM",
      cardId,
      checklistId,
      newItemId: itemId,
      text: "One",
    });

    const beforeLabelDelete = (await loader.loadWithRevision(prisma, boardId))!
      .board;
    const label = beforeLabelDelete.labels.find((row) => row.id === labelId)!;
    const assignments = [
      {
        cardId,
        index: beforeLabelDelete.cards[cardId]!.labelIds.indexOf(labelId),
      },
    ];
    await command(boardId, { type: "DELETE_LABEL", labelId });
    await expectCacheMatchesDatabase(boardId, "after label delete");
    await command(boardId, {
      type: "RESTORE_LABEL",
      label,
      index: beforeLabelDelete.labels.indexOf(label),
      assignments,
    });
    await expectCacheMatchesDatabase(boardId, "after label restore");

    const beforeChecklistDelete = (await loader.loadWithRevision(
      prisma,
      boardId,
    ))!.board;
    const checklist = beforeChecklistDelete.cards[cardId]!.checklists!.find(
      (row) => row.id === checklistId,
    )!;
    await command(boardId, {
      type: "DELETE_CHECKLIST",
      cardId,
      checklistId,
    });
    await expectCacheMatchesDatabase(boardId, "after checklist delete");
    await command(boardId, {
      type: "RESTORE_CHECKLIST",
      cardId,
      checklist,
      index: 0,
    });
    await expectCacheMatchesDatabase(boardId, "after checklist restore");

    const beforeItem = (await loader.loadWithRevision(
      prisma,
      boardId,
    ))!.board.cards[cardId]!.checklists!.find((row) => row.id === checklistId)!
      .items[0]!;
    await command(boardId, {
      type: "DELETE_CHECKLIST_ITEM",
      cardId,
      checklistId,
      itemId: beforeItem.id,
    });
    await expectCacheMatchesDatabase(boardId, "after checklist item delete");
    await command(boardId, {
      type: "RESTORE_CHECKLIST_ITEM",
      cardId,
      checklistId,
      item: beforeItem,
      index: 0,
    });
    await expectCacheMatchesDatabase(boardId, "after checklist item restore");

    const secondChecklist = randomUUID();
    await command(boardId, {
      type: "ADD_CHECKLIST",
      cardId,
      newChecklistId: secondChecklist,
      title: "Doomed",
    });
    await command(boardId, {
      type: "DELETE_CHECKLIST",
      cardId,
      checklistId: secondChecklist,
    });
    await expectCacheMatchesDatabase(boardId, "after second checklist delete");

    const copyCardId = randomUUID();
    await command(boardId, {
      type: "DUPLICATE_COLUMN",
      columnId,
      newColumnId: randomUUID(),
      newCardIds: [copyCardId],
      title: "Copy",
    });
    await expectCacheMatchesDatabase(boardId, "after column copy");
    expect(
      (await loader.loadWithRevision(prisma, boardId))!.board.cards[copyCardId]!
        .title,
    ).toBe("Task");

    await command(boardId, { type: "ARCHIVE_COLUMN_CARDS", columnId });
    await expectCacheMatchesDatabase(boardId, "after bulk archive");
    expect(
      (await loader.loadWithRevision(prisma, boardId))!.board.columns.find(
        (column) => column.id === columnId,
      )?.cardIds,
    ).toEqual([]);
    expect(
      (await loader.loadWithRevision(prisma, boardId))!.board.cards[copyCardId]!
        .archivedAt,
    ).toBeUndefined();
  });

  it("keeps parity for column order, bulk restore, orphan restore and a crafted column payload", async () => {
    const boardId = await createBoard("Column order parity");
    const firstColumn = randomUUID();
    const secondColumn = randomUUID();
    const firstCard = randomUUID();
    const secondCard = randomUUID();
    const thirdCard = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: firstColumn,
      title: "Alpha",
    });
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: secondColumn,
      title: "Beta",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: firstCard,
      columnId: firstColumn,
      title: "Bravo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: secondCard,
      columnId: firstColumn,
      title: "Alpha",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: thirdCard,
      columnId: secondColumn,
      title: "Third",
    });

    await command(boardId, {
      type: "SORT_COLUMN",
      columnId: firstColumn,
      sortBy: "title",
    });
    await expectCacheMatchesDatabase(boardId, "after sort column");
    await command(boardId, {
      type: "SET_COLUMN_CARD_ORDER",
      columnId: firstColumn,
      cardIds: [firstCard, secondCard],
    });
    await expectCacheMatchesDatabase(boardId, "after explicit column order");

    await command(boardId, {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: secondColumn,
    });
    await expectCacheMatchesDatabase(boardId, "after bulk archive");
    const archivedThird = (await loader.loadWithRevision(prisma, boardId))!
      .board.cards[thirdCard]!;
    const liveThird = {
      ...archivedThird,
    };
    delete liveThird.archivedAt;
    delete liveThird.archivedFromColumnId;
    await command(boardId, {
      type: "RESTORE_COLUMN_CARDS",
      columnId: secondColumn,
      cardIds: [thirdCard],
      cards: [liveThird],
    });
    await expectCacheMatchesDatabase(boardId, "after RESTORE_COLUMN_CARDS");
    expect(
      (await loader.loadWithRevision(prisma, boardId))!.board.cards[thirdCard]!
        .archivedAt,
    ).toBeUndefined();

    // Archive it again, then restore the card without naming its column: the
    // writer parks it in the invisible orphan column while the aggregate
    // keeps it in `cards` only.
    await command(boardId, {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: secondColumn,
    });
    const archivedAgain = (await loader.loadWithRevision(prisma, boardId))!
      .board.cards[thirdCard]!;
    await command(boardId, {
      type: "RESTORE_COLUMN_CARDS",
      columnId: secondColumn,
      cardIds: [],
      cards: [archivedAgain],
    });
    await expectCacheMatchesDatabase(boardId, "after orphan-column restore");
    const orphaned = (await loader.loadWithRevision(prisma, boardId))!.board;
    expect(orphaned.cards[thirdCard]!.archivedAt).toEqual(expect.any(Number));
    expect(
      orphaned.columns.find((column) => column.id === secondColumn)?.cardIds,
    ).toEqual([]);

    // A crafted RESTORE_COLUMN: a ghost id and an archived payload card in
    // `column.cardIds` are not part of a fresh aggregate.
    const beforeDelete = (await loader.loadWithRevision(prisma, boardId))!
      .board;
    const doomedColumn = beforeDelete.columns.find(
      (column) => column.id === firstColumn,
    )!;
    const doomedCards = doomedColumn.cardIds.map(
      (id) => beforeDelete.cards[id]!,
    );
    await command(boardId, { type: "DELETE_COLUMN", columnId: firstColumn });
    await expectCacheMatchesDatabase(boardId, "before crafted restore");

    const ghostId = randomUUID();
    const archivedCardId = randomUUID();
    const now = Date.now();
    const archivedCard = {
      id: archivedCardId,
      title: "Should stay archived",
      labelIds: [],
      createdAt: now,
      updatedAt: now,
      archivedAt: now,
    };
    await command(boardId, {
      type: "RESTORE_COLUMN",
      column: {
        ...doomedColumn,
        cardIds: [archivedCardId, ghostId, ...doomedColumn.cardIds],
      },
      index: 0,
      cards: [...doomedCards, archivedCard],
    });
    await expectCacheMatchesDatabase(boardId, "after crafted column restore");

    const restored = (await loader.loadWithRevision(prisma, boardId))!.board;
    expect(
      restored.columns.find((column) => column.id === firstColumn),
    ).toMatchObject({ cardIds: doomedColumn.cardIds });
    expect(restored.cards[ghostId]).toBeUndefined();
    expect(restored.cards[archivedCardId]!.archivedAt).toEqual(now);
    expect(
      restored.columns
        .find((column) => column.id === firstColumn)!
        .cardIds.includes(archivedCardId),
    ).toBe(false);
    expect(await prisma.card.count({ where: { id: ghostId } })).toBe(0);
  });

  it("keeps parity for touch, task spec and claim commands", async () => {
    const boardId = await createBoard("Card command parity");
    const columnId = randomUUID();
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Task",
    });

    await command(boardId, { type: "TOUCH_CARD", cardId });
    await expectCacheMatchesDatabase(boardId, "after touch");
    await command(boardId, {
      type: "SET_CARD_TASK_SPEC",
      cardId,
      acceptanceCriteria: ["Works"],
      definitionOfDone: ["Tested"],
    });
    await expectCacheMatchesDatabase(boardId, "after task spec");
    await command(boardId, {
      type: "CLAIM_CARD",
      cardId,
      claimedBy: ownerId,
      leaseUntil: Date.now() + 900_000,
    });
    const claimedRevision = await expectCacheMatchesDatabase(
      boardId,
      "after claim",
    );
    const claimed = cache.get(boardId, claimedRevision)!;
    expect(claimed.cards[cardId]).toMatchObject({
      claimedBy: ownerId,
      acceptanceCriteria: ["Works"],
    });
    expect(claimed.cards[cardId]!.leaseUntil).toEqual(expect.any(Number));
  });

  it("keeps parity for RESTORE_CARD and drops injected activity/links", async () => {
    const boardId = await createBoard("Restore injection");
    const columnId = randomUUID();
    const cardId = randomUUID();
    const otherCardId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    for (const [id, title] of [
      [cardId, "Restore me"],
      [otherCardId, "Other"],
    ] as const) {
      await command(boardId, {
        type: "ADD_CARD",
        newCardId: id,
        columnId,
        title,
      });
    }
    await command(boardId, {
      type: "ADD_CHECKLIST",
      cardId,
      newChecklistId: randomUUID(),
      title: "Steps",
    });
    const before = (await loader.loadWithRevision(prisma, boardId))!.board;
    await command(boardId, { type: "DELETE_CARD", cardId });
    await expectCacheMatchesDatabase(boardId, "before restore");

    const snapshot = structuredClone(before.cards[cardId]!);
    snapshot.activity = [
      {
        id: randomUUID(),
        type: "created",
        at: Date.now(),
        actorId: ownerId,
        detail: "injected",
      },
    ];
    snapshot.links = [
      {
        id: randomUUID(),
        type: "relates_to",
        targetCardId: otherCardId,
      },
    ];
    const injectedLinkId = snapshot.links[0]!.id;
    await command(boardId, {
      type: "RESTORE_CARD",
      card: snapshot,
      columnId,
      index: 0,
    });
    await expectCacheMatchesDatabase(boardId, "after injected restore");

    const cached = cache.get(boardId, await revision(boardId))!;
    expect(cached.cards[cardId]!.title).toBe("Restore me");
    expect(cached.cards[cardId]!.activity).toBeUndefined();
    expect(cached.cards[cardId]!.links).toBeUndefined();
    expect(cached.cards[cardId]!.checklists?.map((row) => row.title)).toEqual([
      "Steps",
    ]);
    expect(await prisma.cardLink.count({ where: { id: injectedLinkId } })).toBe(
      0,
    );
  });

  it("rebuilds the attachment owner when a description embeds another card's upload", async () => {
    const boardId = await createBoard("Cross-card embed");
    const columnId = randomUUID();
    const authorCard = randomUUID();
    const ownerCard = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    for (const [id, title] of [
      [authorCard, "Author"],
      [ownerCard, "Owner"],
    ] as const) {
      await command(boardId, {
        type: "ADD_CARD",
        newCardId: id,
        columnId,
        title,
      });
    }
    const uploaded = await server()
      .post(`/api/v1/cards/${ownerCard}/attachments?description=1`)
      .set(auth(session))
      .attach("file", PDF, {
        filename: "owner.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    // Prime the cache at the attachment revision.
    await loader.loadWithRevision(prisma, boardId);

    await command(boardId, {
      type: "UPDATE_CARD",
      cardId: authorCard,
      description: `![file](/api/v1/attachments/${uploaded.body.id as string}/content)`,
    });
    await expectCacheMatchesDatabase(boardId, "after cross-card embed");
    const cached = cache.get(boardId, await revision(boardId))!;
    expect(cached.cards[ownerCard]!.attachmentCount).toBe(1);
    expect(cached.cards[authorCard]!.attachmentCount).toBeUndefined();
  });

  it("reloads the cache after a lapsed-claim maintenance sweep", async () => {
    const boardId = await createBoard("Claim sweep");
    const columnId = randomUUID();
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Claimed",
    });
    await command(boardId, {
      type: "CLAIM_CARD",
      cardId,
      claimedBy: ownerId,
      leaseUntil: Date.now() - 1_000,
    });
    const before = await expectCacheMatchesDatabase(boardId, "before sweep");
    expect(cache.get(boardId, before)!.cards[cardId]!.claimedBy).toBe(ownerId);

    const maintenance = app.get(MaintenanceService);
    expect(await maintenance.sweepClaims()).toBe(1);
    const afterSweep = await revision(boardId);
    expect(afterSweep).toBeGreaterThan(before);
    expect(cache.revisionOf(boardId)).toBe(before);
    expect(cache.get(boardId, afterSweep)).toBeNull();

    load.mockClear();
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId,
      title: "After sweep",
    });
    expect(load).toHaveBeenCalledTimes(1);
    await expectCacheMatchesDatabase(boardId, "after sweep command");
    expect(
      cache.get(boardId, await revision(boardId))!.cards[cardId]!.claimedBy,
    ).toBeUndefined();
  });

  it("reloads the cache when account schedule revokes a scoped token", async () => {
    const registration = await server()
      .post("/api/v1/auth/register")
      .send({
        email: "scheduled-cache@example.com",
        password: PASSWORD,
        displayName: "Scheduled",
      })
      .expect(201);
    const userToken = registration.body.accessToken as string;
    const userId = registration.body.user.id as string;
    const boardId = await server()
      .post("/api/v1/boards")
      .set(auth(userToken))
      .send({ title: "Scheduled board" })
      .expect(201)
      .then((res) => res.body.id as string);
    const columnId = randomUUID();
    const cardId = randomUUID();
    await command(
      boardId,
      { type: "ADD_COLUMN", newColumnId: columnId, title: "Todo" },
      { token: userToken },
    );
    await command(
      boardId,
      { type: "ADD_CARD", newCardId: cardId, columnId, title: "Claimed" },
      { token: userToken },
    );
    const pat = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(userToken))
      .send({ name: "scheduled-writer", boardId, scopePreset: "admin" })
      .expect(201)
      .then((res) => res.body.token as string);
    await command(
      boardId,
      {
        type: "CLAIM_CARD",
        cardId,
        claimedBy: userId,
        leaseUntil: Date.now() + 900_000,
      },
      { token: pat },
    );
    const before = await expectCacheMatchesDatabase(boardId, "before schedule");

    await app.get(AccountDeletionService).schedule(userId, userId);

    await expectReloadAfterExternalWrite(boardId, "after schedule", before);
    const reloaded = (await loader.loadWithRevision(prisma, boardId))!.board;
    expect(reloaded.cards[cardId]!.claimedBy).toBeUndefined();
    expect(
      await prisma.apiToken.count({
        where: { userId, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("reloads after a comment, an attachment, a session end and an admin restore", async () => {
    const boardId = await createBoard("Coherency board");
    const columnId = randomUUID();
    const cardId = randomUUID();
    const claimCard = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Commented",
    });
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: claimCard,
      columnId,
      title: "Claimed",
    });

    // ---- comment: Card.lastActorId changes outside the command log --------
    let before = await expectCacheMatchesDatabase(boardId, "before comment");
    await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(session))
      .send({ text: "A comment" })
      .expect(201);
    await expectReloadAfterExternalWrite(boardId, "after comment", before);
    expect(
      (await loader.load(prisma, boardId))!.cards[cardId]!.lastActorId,
    ).toBe(ownerId);

    // ---- attachment: attachmentCount changes outside the command log ------
    before = await expectCacheMatchesDatabase(boardId, "before attachment");
    await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(session))
      .attach("file", PDF, {
        filename: "tiny.pdf",
        contentType: "application/pdf",
      })
      .expect(201);
    await expectReloadAfterExternalWrite(boardId, "after attachment", before);
    expect(
      (await loader.load(prisma, boardId))!.cards[cardId]!.attachmentCount,
    ).toBe(1);

    // ---- claim + session end: session end releases the card -------------
    const token = await createToken(boardId, "cache-claimer");
    const agentSession = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(token))
      .send({ name: "cache-claimer" })
      .expect(201)
      .then((res) => res.body.id as string);
    await command(
      boardId,
      {
        type: "CLAIM_CARD",
        cardId: claimCard,
        claimedBy: ownerId,
        leaseUntil: Date.now() + 900_000,
      },
      { token, headers: { "X-Agent-Session": agentSession } },
    );
    expect(
      (await loader.load(prisma, boardId))!.cards[claimCard]!.claimedBy,
    ).toBe(ownerId);

    before = await expectCacheMatchesDatabase(boardId, "before session end");
    await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions/${agentSession}/end`)
      .set(auth(token))
      .send({ status: "completed" })
      .expect(200);
    await expectReloadAfterExternalWrite(boardId, "after session end", before);
    expect(
      (await loader.load(prisma, boardId))!.cards[claimCard]!.claimedBy,
    ).toBeUndefined();

    // ---- admin card restore: a soft-deleted row comes back --------------
    const restoredCard = randomUUID();
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: restoredCard,
      columnId,
      title: "Restore me",
    });
    await command(boardId, { type: "DELETE_CARD", cardId: restoredCard });
    await expectCacheMatchesDatabase(boardId, "after card delete");
    expect(
      (await loader.load(prisma, boardId))!.cards[restoredCard],
    ).toBeUndefined();

    before = await revision(boardId);
    await server()
      .post(`/api/v1/admin/entities/cards/${restoredCard}/restore`)
      .set(auth(adminToken))
      .expect(201);
    await expectFreshCacheAfterWrite(
      boardId,
      "after admin card restore",
      before,
    );
    expect(
      (await loader.load(prisma, boardId))!.cards[restoredCard]!.title,
    ).toBe("Restore me");

    // ---- admin board restore: a deleted subtree comes back --------------
    const restoreBoard = await createBoard("Restore board");
    const restoreColumn = randomUUID();
    const restoreCardId = randomUUID();
    await command(restoreBoard, {
      type: "ADD_COLUMN",
      newColumnId: restoreColumn,
      title: "Todo",
    });
    await command(restoreBoard, {
      type: "ADD_CARD",
      newCardId: restoreCardId,
      columnId: restoreColumn,
      title: "Inside",
    });
    await expectCacheMatchesDatabase(restoreBoard, "before board delete");

    await server()
      .delete(`/api/v1/boards/${restoreBoard}`)
      .set(auth(session))
      .expect(200);
    // The deleted board is invisible to the loader regardless of the cache.
    expect(await loader.load(prisma, restoreBoard)).toBeNull();

    before = await revision(restoreBoard);
    await server()
      .post(`/api/v1/admin/entities/boards/${restoreBoard}/restore`)
      .set(auth(adminToken))
      .expect(201);
    await expectReloadAfterExternalWrite(
      restoreBoard,
      "after board restore",
      before,
    );
    expect(
      (await loader.load(prisma, restoreBoard))!.cards[restoreCardId]!.title,
    ).toBe("Inside");
  });

  it("never caches a targeted card-intent snapshot as the whole board", async () => {
    const boardId = await createBoard("Targeted intents");
    const columnId = randomUUID();
    const firstCard = randomUUID();
    const secondCard = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    for (const [newCardId, title] of [
      [firstCard, "First"],
      [secondCard, "Second"],
    ] as const) {
      await command(boardId, { type: "ADD_CARD", newCardId, columnId, title });
    }
    const cachedRevision = await expectCacheMatchesDatabase(
      boardId,
      "before intent",
    );
    const token = await createToken(boardId, "targeted-writer");

    await server()
      .patch(`/api/v1/boards/${boardId}/cards/${firstCard}`)
      .set(auth(token))
      .send({ commandId: randomUUID(), description: "targeted edit" })
      .expect(200);

    const after = await revision(boardId);
    expect(after).toBeGreaterThan(cachedRevision);
    // The command committed, but its snapshot had only one card; the cache
    // must still hold the previous full-board revision, never the slice.
    expect(cache.revisionOf(boardId)).toBe(cachedRevision);
    expect(cache.get(boardId, after)).toBeNull();

    const full = await loader.loadWithRevision(prisma, boardId);
    expect(full?.revision).toBe(after);
    expect(full?.board.cards[firstCard]?.description).toBe("targeted edit");
    expect(full?.board.cards[secondCard]?.title).toBe("Second");
  });

  it("simulates two replicas: a reader at an older revision misses and reloads", async () => {
    const config = { entries: 8, bytes: 8 * 1024 * 1024 };
    const readerCache = new BoardAggregateCacheService(config);
    const writerCache = new BoardAggregateCacheService(config);
    const reader = new BoardAggregateLoader(readerCache);
    const writer = new BoardAggregateLoader(writerCache);

    const boardId = await createBoard("Replica board");
    const columnId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title: "Todo",
    });
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title: "Before",
    });

    const readerFirst = await reader.loadWithRevision(prisma, boardId);
    const revisionBefore = await revision(boardId);
    expect(readerFirst?.revision).toBe(revisionBefore);
    expect(readerFirst?.board.cards[cardId]!.title).toBe("Before");

    // The writer replica (or the command process) commits a newer revision.
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId,
      title: "After",
    });
    const revisionAfter = await revision(boardId);
    expect(revisionAfter).toBeGreaterThan(revisionBefore);

    const writerLoad = await writer.loadWithRevision(prisma, boardId);
    expect(writerLoad?.revision).toBe(revisionAfter);
    expect(writerLoad?.board.cards[cardId]!.title).toBe("After");
    expect(writerCache.revisionOf(boardId)).toBe(revisionAfter);

    // The reader still holds R. Serving R for R+1 is impossible by key; the
    // loader reads the board row in its own snapshot, misses, and reloads.
    expect(readerCache.revisionOf(boardId)).toBe(revisionBefore);
    expect(readerCache.get(boardId, revisionAfter)).toBeNull();
    const readerSecond = await reader.loadWithRevision(prisma, boardId);
    expect(readerSecond?.revision).toBe(revisionAfter);
    expect(readerSecond?.board.cards[cardId]!.title).toBe("After");
    expect(readerCache.revisionOf(boardId)).toBe(revisionAfter);
  });
});
