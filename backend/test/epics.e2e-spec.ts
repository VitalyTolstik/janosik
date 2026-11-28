import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type { Board, BoardAction, Epic } from "@janosik/shared";
import {
  boardReducer,
  epicOf,
  invert,
  LIMITS,
  MAX_BOARD_EXPORT_BYTES,
} from "@janosik/shared";
import request from "supertest";

import { AppModule } from "@/app.module";
import { BoardsService } from "@/boards/boards.service";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";
import { wipeAll } from "./support/wipe";

describe("Epic foundation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: { id: string; token: string };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);
    owner = await register("epic-owner");
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token = owner.token) => ({ Authorization: `Bearer ${token}` });
  const path = (id: string) => `/api/v1/boards/${id}`;

  async function register(name: string) {
    const res = await server()
      .post("/api/v1/auth/register")
      .send({
        email: `${name}@example.com`,
        password: "correct horse battery",
        displayName: name,
      })
      .expect(201);
    return {
      token: res.body.accessToken as string,
      id: res.body.user.id as string,
    };
  }

  async function createBoard(title: string): Promise<string> {
    const res = await server()
      .post("/api/v1/boards")
      .set(auth())
      .send({ title })
      .expect(201);
    return res.body.id;
  }

  function command(
    boardId: string,
    action: BoardAction,
    token = owner.token,
    commandId = randomUUID(),
  ) {
    return server()
      .post(`${path(boardId)}/commands`)
      .set(auth(token))
      .send({ commandId, action });
  }

  async function column(boardId: string, title: string): Promise<string> {
    const newColumnId = randomUUID();
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId,
      title,
      at: Date.now(),
    }).expect(200);
    return newColumnId;
  }

  function newEpic(fields: Partial<Epic> = {}): Epic {
    return {
      id: randomUUID(),
      title: "Private launch",
      description: "Private release notes",
      color: "rose",
      status: "active",
      position: 0,
      createdAt: 0,
      updatedAt: 0,
      ...fields,
    };
  }

  async function card(boardId: string, columnId: string, epicId?: string) {
    const newCardId = randomUUID();
    await command(boardId, {
      type: "ADD_CARD",
      newCardId,
      columnId,
      title: "Launch task",
      epicId,
      at: Date.now(),
    }).expect(200);
    return newCardId;
  }

  async function board(boardId: string): Promise<Board> {
    return stripAttribution(
      (await server().get(path(boardId)).set(auth()).expect(200)).body,
    );
  }

  it("persists the reducer result, derives progress across pages and restores without rewriting cards", async () => {
    const boardId = await createBoard("Epic writes");
    const backlog = await column(boardId, "Backlog");
    const done = await column(boardId, "Done");
    const epic = newEpic({ ownerId: owner.id });
    const at = Date.now();
    const add: BoardAction = { type: "ADD_EPIC", epic, at };
    const initial = await board(boardId);
    const addResult = await command(boardId, add).expect(200);
    expect(addResult.body.versions).toHaveProperty(`epic:${epic.id}`, 0);
    expect(await board(boardId)).toEqual(
      boardReducer([initial], add, { withActivity: false })[0],
    );

    const child = await card(boardId, backlog, epic.id);
    const doneChild = await card(boardId, done, epic.id);
    await card(boardId, done, epic.id);
    const archived = await card(boardId, done, epic.id);
    await command(boardId, {
      type: "ARCHIVE_CARD",
      cardId: archived,
      at: Date.now(),
    }).expect(200);
    const hidden = await column(boardId, "Deleted column");
    await card(boardId, hidden, epic.id);
    // Exercise a live row parked under a soft-deleted column, as in the orphan contour.
    await prisma.column.update({
      where: { id: hidden },
      data: { deletedAt: new Date() },
    });
    const summary = await server()
      .get(`${path(boardId)}/summary?limit=1`)
      .set(auth())
      .expect(200);
    expect(summary.body.epics).toEqual([
      expect.objectContaining({
        id: epic.id,
        ownerId: owner.id,
        progress: { total: 3, done: 2, open: 1 },
      }),
    ]);
    expect(summary.body.epics[0]).not.toHaveProperty("description");
    expect(summary.body.columns[1].cards).toHaveLength(1);
    expect(summary.body.columns[1].cards[0]).toHaveProperty("epicId", epic.id);
    const detail = await server()
      .get(`${path(boardId)}/cards/${doneChild}`)
      .set(auth())
      .expect(200);
    expect(detail.body.card.epicId).toBe(epic.id);

    const checkUndo = async (action: BoardAction) => {
      const before = await board(boardId);
      const changed = boardReducer([before], action, {
        withActivity: false,
      })[0];
      await command(boardId, action).expect(200);
      expect(await board(boardId)).toEqual(changed);
      await command(boardId, invert(before, action)!).expect(200);
      expect(await board(boardId)).toEqual(before);
      return changed;
    };
    await checkUndo({
      type: "UPDATE_EPIC",
      epicId: epic.id,
      description: null,
      startDate: 0,
      dueDate: at,
      at: at + 10,
    });
    await checkUndo({
      type: "SET_EPIC_STATUS",
      epicId: epic.id,
      status: "completed",
      at: at + 20,
    });
    await checkUndo({
      type: "SET_CARD_EPIC",
      cardId: child,
      epicId: null,
      at: at + 30,
    });
    await checkUndo({
      type: "MOVE_CARD",
      cardId: child,
      fromColumnId: backlog,
      toColumnId: backlog,
      fromIndex: 0,
      toIndex: 0,
      epicId: null,
      at: at + 40,
    });
    const nextEpic = newEpic({ title: "Next launch" });
    await command(boardId, { type: "ADD_EPIC", epic: nextEpic, at }).expect(
      200,
    );
    const moved = await checkUndo({
      type: "MOVE_CARD",
      cardId: child,
      fromColumnId: backlog,
      toColumnId: done,
      fromIndex: 0,
      toIndex: 0,
      epicId: nextEpic.id,
      at: at + 50,
    });
    expect(moved.cards[child].epicId).toBe(nextEpic.id);
    expect(moved.columns.find((entry) => entry.id === done)?.cardIds[0]).toBe(
      child,
    );

    const before = await board(boardId);
    const childRows = await prisma.card.findMany({
      where: { epicId: epic.id },
      orderBy: { id: "asc" },
    });
    const deletion: BoardAction = {
      type: "DELETE_EPIC",
      epicId: epic.id,
      at: Date.now(),
    };
    const commandId = randomUUID();
    const response = await command(
      boardId,
      deletion,
      owner.token,
      commandId,
    ).expect(200);
    expect(response.body.versions[`epic:${epic.id}`]).toBeGreaterThan(0);
    const log = await prisma.command.findFirstOrThrow({
      where: { id: commandId },
    });
    expect(log.touches.sort()).toEqual(
      [`board:${boardId}`, `epic:${epic.id}`].sort(),
    );
    expect(
      await prisma.card.findMany({
        where: { epicId: epic.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(childRows);
    const deleted = await board(boardId);
    expect(epicOf(deleted, epic.id)).toBeUndefined();
    expect(deleted.cards[child].epicId).toBe(epic.id);
    await command(boardId, invert(before, deletion)!).expect(200);
    expect(await board(boardId)).toEqual(before);
  });

  it("checks board ownership, accepted owners, completion status and destructive token scope", async () => {
    const boardId = await createBoard("Epic permissions");
    const foreignId = await createBoard("Other board");
    const columnId = await column(boardId, "Backlog");
    const cardId = await card(boardId, columnId);
    const viewer = await register("epic-viewer");
    const membership = await prisma.boardMember.create({
      data: { boardId, userId: viewer.id, role: "VIEWER" },
    });
    const epic = newEpic({ ownerId: viewer.id });
    const add: BoardAction = { type: "ADD_EPIC", epic, at: Date.now() };
    const invalidOwner = await command(boardId, add).expect(400);
    expect(invalidOwner.body.field).toBe("action.epic.ownerId");
    await prisma.boardMember.update({
      where: { id: membership.id },
      data: { acceptedAt: new Date() },
    });
    await command(boardId, add, viewer.token).expect(403);
    await command(foreignId, {
      ...add,
      epic: { ...epic, ownerId: owner.id },
    }).expect(200);
    await command(boardId, {
      type: "SET_CARD_EPIC",
      cardId,
      epicId: epic.id,
      at: Date.now(),
    }).expect(400);
    await command(boardId, add).expect(409);

    const local = newEpic({ status: "completed" });
    await command(boardId, { ...add, epic: local }).expect(200);
    await command(boardId, {
      type: "SET_CARD_EPIC",
      cardId,
      epicId: local.id,
      at: Date.now(),
    }).expect(400);

    const remove: BoardAction = {
      type: "DELETE_EPIC",
      epicId: local.id,
      at: Date.now(),
    };
    for (const scopePreset of ["worker", "admin"]) {
      const token = (
        await server()
          .post("/api/v1/users/me/tokens")
          .set(auth())
          .send({ name: `Epic ${scopePreset}`, expiresAt: null, scopePreset })
          .expect(201)
      ).body.token;
      const rejection = await command(boardId, remove, token).expect(
        scopePreset === "worker" ? 403 : 409,
      );
      expect(rejection.body.code).toBe(
        scopePreset === "worker" ? "scope_denied" : "approval_required",
      );
    }
    expect((await board(boardId)).epics?.[0]).toMatchObject({
      id: local.id,
      status: "completed",
      completedAt: add.at,
    });
  });

  it.each(["live", "soft-deleted"])(
    "keeps recently deleted card and column membership for a %s epic",
    async (state) => {
      const at = Date.now();
      const boardId = await createBoard("Recently deleted epic cards");
      const columnId = await column(boardId, "Backlog");
      const epic = newEpic();
      await command(boardId, { type: "ADD_EPIC", epic, at }).expect(200);
      const cardId = await card(boardId, columnId, epic.id);
      const otherCardId = await card(boardId, columnId, epic.id);
      const before = await board(boardId);
      const deleteEpic: BoardAction = {
        type: "DELETE_EPIC",
        epicId: epic.id,
        at,
      };
      if (state === "soft-deleted") {
        await command(boardId, deleteEpic).expect(200);
      }

      await command(boardId, { type: "DELETE_CARD", cardId, at }).expect(200);
      await server()
        .post(`${path(boardId)}/deleted/cards/${cardId}/restore`)
        .set(auth())
        .expect(200);
      expect((await board(boardId)).cards[cardId].epicId).toBe(epic.id);

      await command(boardId, { type: "DELETE_COLUMN", columnId, at }).expect(
        200,
      );
      await server()
        .post(`${path(boardId)}/deleted/columns/${columnId}/restore`)
        .set(auth())
        .expect(200);
      const restored = await board(boardId);
      for (const id of [cardId, otherCardId]) {
        expect(restored.cards[id].epicId).toBe(epic.id);
      }
      expect(epicOf(restored, restored.cards[cardId].epicId)).toEqual(
        state === "live" ? before.epics?.[0] : undefined,
      );
      if (state === "soft-deleted") {
        await command(boardId, invert(before, deleteEpic)!).expect(200);
      }
      const summary = await server()
        .get(`${path(boardId)}/summary`)
        .set(auth())
        .expect(200);
      expect(summary.body.epics[0]).toMatchObject({
        id: epic.id,
        progress: { total: 2, done: 2, open: 0 },
      });
    },
  );

  it("restores the existing owner after they leave the board", async () => {
    const at = Date.now();
    const boardId = await createBoard("Former epic owner");
    const member = await register("former-epic-owner");
    await prisma.boardMember.create({
      data: {
        boardId,
        userId: member.id,
        role: "MEMBER",
        acceptedAt: new Date(),
      },
    });
    const epic = newEpic({ ownerId: member.id });
    await command(boardId, { type: "ADD_EPIC", epic, at }, member.token).expect(
      200,
    );
    await server()
      .delete(`${path(boardId)}/members/me`)
      .set(auth(member.token))
      .expect(200);

    const before = await board(boardId);
    const remove: BoardAction = { type: "DELETE_EPIC", epicId: epic.id, at };
    await command(boardId, remove).expect(200);
    const restore = invert(before, remove)!;
    expect(restore.type).toBe("RESTORE_EPIC");
    if (restore.type !== "RESTORE_EPIC") throw new Error("Expected epic undo");
    const outsider = await register("unrelated-epic-owner");
    await command(boardId, {
      ...restore,
      epic: { ...restore.epic, ownerId: outsider.id },
    }).expect(400);
    await command(boardId, restore).expect(200);
    expect((await board(boardId)).epics).toEqual(before.epics);
    const members = await server()
      .get(`${path(boardId)}/members`)
      .set(auth())
      .expect(200);
    expect(members.body).not.toContainEqual(
      expect.objectContaining({ userId: member.id }),
    );
    await command(boardId, {
      type: "UPDATE_EPIC",
      epicId: epic.id,
      ownerId: member.id,
      at,
    }).expect(400);
  });

  it("restores over the epic create limit and round-trips the board through export", async () => {
    const at = Date.now();
    const boardId = await createBoard("Epic cap");
    const epic = newEpic();
    await command(boardId, { type: "ADD_EPIC", epic, at }).expect(200);
    await prisma.epic.createMany({
      data: Array.from({ length: LIMITS.epicsPerBoard - 1 }, (_, index) => ({
        boardId,
        title: `Seeded epic ${index + 1}`,
        position: index + 1,
      })),
    });
    const before = await board(boardId);
    expect(before.epics).toHaveLength(LIMITS.epicsPerBoard);
    const remove: BoardAction = { type: "DELETE_EPIC", epicId: epic.id, at };
    const add: BoardAction = { type: "ADD_EPIC", epic: newEpic(), at };
    await command(boardId, add).expect(409);
    await command(boardId, remove).expect(200);
    await command(boardId, add).expect(200);
    await command(boardId, invert(before, remove)!).expect(200);
    const restored = await board(boardId);
    expect(restored.epics).toHaveLength(LIMITS.epicsPerBoard + 1);
    expect(restored.epics?.[0]).toEqual(before.epics?.[0]);

    const exported = await server()
      .get(`${path(boardId)}/export`)
      .set(auth())
      .expect(200);
    const imported = await server()
      .post("/api/v1/boards/import")
      .set(auth())
      .send(exported.body)
      .expect(201);
    expect(imported.body[0].epics).toHaveLength(LIMITS.epicsPerBoard + 1);
  });

  it("returns epic touches and refreshes progress for card and column lifecycle commands", async () => {
    const at = Date.now();
    const boardId = await createBoard("Epic progress invalidation");
    const backlog = await column(boardId, "Backlog");
    const done = await column(boardId, "Done");
    const epic = newEpic();
    await command(boardId, { type: "ADD_EPIC", epic, at }).expect(200);
    const cardId = await card(boardId, backlog, epic.id);
    const readSummary = () =>
      server()
        .get(`${path(boardId)}/summary`)
        .set(auth());
    let { etag } = (await readSummary().expect(200)).header;

    async function checkProgress(
      action: BoardAction,
      total: number,
      done: number,
    ) {
      const commandId = randomUUID();
      const result = await command(
        boardId,
        action,
        owner.token,
        commandId,
      ).expect(200);
      expect(result.body.versions).toHaveProperty(`epic:${epic.id}`);
      const log = await prisma.command.findFirstOrThrow({
        where: { id: commandId },
      });
      expect(log.touches).toContain(`epic:${epic.id}`);
      const summary = await readSummary()
        .set("If-None-Match", etag)
        .expect(200);
      etag = summary.header.etag;
      expect(summary.body.epics[0].progress).toEqual({
        total,
        done,
        open: total - done,
      });
    }

    await checkProgress({ type: "ARCHIVE_CARD", cardId, at }, 0, 0);
    await checkProgress(
      { type: "UNARCHIVE_CARD", cardId, columnId: backlog, at },
      1,
      0,
    );
    const before = await board(boardId);
    const deleteCard: BoardAction = { type: "DELETE_CARD", cardId, at };
    await checkProgress(deleteCard, 0, 0);
    await checkProgress(invert(before, deleteCard)!, 1, 0);
    const archiveColumn: BoardAction = {
      type: "ARCHIVE_COLUMN_CARDS",
      columnId: backlog,
      at,
    };
    await checkProgress(archiveColumn, 0, 0);
    await checkProgress(invert(before, archiveColumn)!, 1, 0);
    // The fallback Done column changes even though the deleted column was empty.
    const deleteColumn: BoardAction = {
      type: "DELETE_COLUMN",
      columnId: done,
      at,
    };
    await checkProgress(deleteColumn, 1, 1);
    await checkProgress(invert(before, deleteColumn)!, 1, 0);
  });

  it("includes live epic descriptions in the export size preflight", async () => {
    const boardId = await createBoard("Epic export budget");
    const epic = await prisma.epic.create({
      data: { boardId, title: "Large epic" },
    });
    await prisma.$executeRaw`
      UPDATE "Epic" SET description = repeat('x', ${MAX_BOARD_EXPORT_BYTES + 1}::int)
      WHERE id = ${epic.id}
    `;
    await expect(
      app.get(BoardsService).assertExportFitsPreflight(boardId),
    ).rejects.toMatchObject({ status: 413 });
    const exportBoard = () =>
      server()
        .get(`${path(boardId)}/export`)
        .set(auth());
    await exportBoard().expect(413);
    await prisma.epic.update({
      where: { id: epic.id },
      data: { deletedAt: new Date() },
    });
    await exportBoard().expect(200);
  });

  it("replays an epic and its card in a dry-run, and tracks the epic version in agent runs", async () => {
    const boardId = await createBoard("Epic plan");
    const columnId = await column(boardId, "Backlog");
    const epic = newEpic();
    const newCardId = randomUUID();
    const commands = [
      { commandId: randomUUID(), action: { type: "ADD_EPIC", epic } },
      {
        commandId: randomUUID(),
        action: {
          type: "ADD_CARD",
          columnId,
          newCardId,
          title: "Plan task",
          epicId: epic.id,
        },
      },
      {
        commandId: randomUUID(),
        action: {
          type: "UPDATE_EPIC",
          epicId: epic.id,
          title: "Planned launch",
        },
      },
    ];
    const token = (
      await server()
        .post("/api/v1/users/me/tokens")
        .set(auth())
        .send({
          name: "Epic plan worker",
          expiresAt: null,
          scopePreset: "worker",
        })
        .expect(201)
    ).body.token;
    const preview = await server()
      .post(`${path(boardId)}/plans`)
      .set(auth(token))
      .send({ commands })
      .expect(200);
    expect(preview.body.canApply).toBe(true);
    expect(preview.body.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ touch: `epic:${epic.id}`, kind: "create" }),
        expect.objectContaining({
          touch: `card:${newCardId}`,
          kind: "create",
          after: expect.objectContaining({ epicId: epic.id }),
        }),
      ]),
    );
    expect(await prisma.epic.count({ where: { boardId } })).toBe(0);
    const run = await server()
      .post(`${path(boardId)}/plans/apply`)
      .set(auth(token))
      .send({
        commands: preview.body.plan.commands,
        planHash: preview.body.planHash,
      })
      .expect(200);
    expect((await board(boardId)).cards[newCardId].epicId).toBe(epic.id);
    await command(boardId, {
      type: "UPDATE_EPIC",
      epicId: epic.id,
      title: "Human edit",
      at: Date.now(),
    }).expect(200);
    const revert = await server()
      .post(`${path(boardId)}/runs/${run.body.runId}/revert/preview`)
      .set(auth())
      .send({})
      .expect(200);
    expect(revert.body.conflicts).toContainEqual(
      expect.objectContaining({
        touch: `epic:${epic.id}`,
        reason: "version_changed",
        expectedVersion: 1,
        currentVersion: 2,
      }),
    );
  });

  it("exports/imports v4, strips live and snapshot shares, and invalidates reads on direct writes", async () => {
    const boardId = await createBoard("Epic backup");
    const columnId = await column(boardId, "Backlog");
    const epic = newEpic({ ownerId: owner.id });
    const readSummary = () =>
      server()
        .get(`${path(boardId)}/summary`)
        .set(auth());
    const baseline = await readSummary().expect(200);
    await prisma.epic.create({
      data: {
        id: epic.id,
        title: epic.title,
        description: epic.description,
        ownerId: owner.id,
        boardId,
      },
    });
    const inserted = await readSummary()
      .set("If-None-Match", baseline.header.etag)
      .expect(200);
    expect(inserted.body.epics).toHaveLength(1);
    expect(inserted.body.aggregateRevision).toBeGreaterThan(
      baseline.body.aggregateRevision,
    );
    const cardId = await card(boardId, columnId, epic.id);
    const assigned = await readSummary().expect(200);
    await prisma.epic.update({
      where: { id: epic.id },
      data: { title: "Directly edited" },
    });
    const edited = await readSummary()
      .set("If-None-Match", assigned.header.etag)
      .expect(200);
    expect(edited.body.epics[0].title).toBe("Directly edited");

    for (const mode of ["live", "snapshot"]) {
      const share = await server()
        .post(`${path(boardId)}/shares`)
        .set(auth())
        .send({ mode })
        .expect(201);
      const response = await server()
        .get(`/api/v1/share/${share.body.token}`)
        .expect(200);
      expect(response.body.board).not.toHaveProperty("epics");
      expect(response.body.board.cards[cardId]).not.toHaveProperty("epicId");
      expect(response.text).not.toContain("Directly edited");
    }

    const exported = await server()
      .get(`${path(boardId)}/export`)
      .set(auth())
      .expect(200);
    expect(exported.body.schemaVersion).toBe(4);
    const preview = await server()
      .post("/api/v1/boards/import?dryRun=1")
      .set(auth())
      .send(exported.body)
      .expect(201);
    expect(preview.body.epics).toBe(1);
    const imported = await server()
      .post("/api/v1/boards/import")
      .set(auth())
      .send(exported.body)
      .expect(201);
    const copy = imported.body[0] as Board;
    expect(copy.epics?.[0]).toMatchObject({
      title: "Directly edited",
      description: epic.description,
      ownerId: owner.id,
    });
    expect(copy.epics?.[0].id).not.toBe(epic.id);
    expect(Object.values(copy.cards)[0].epicId).toBe(copy.epics?.[0].id);
    await prisma.epic.delete({ where: { id: epic.id } });
    const purged = await readSummary()
      .set("If-None-Match", edited.header.etag)
      .expect(200);
    expect(purged.body.epics).toEqual([]);
    expect(purged.body.columns[0].cards[0]).not.toHaveProperty("epicId");
  });
});
