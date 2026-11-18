import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import { duplicateChecklistId } from "@janosik/shared";
import type {
  AgentRunDto,
  Board,
  CommandBatchResponse,
  CommandResponse,
  CreateUserTokenResponse,
  RevertPreviewDto,
  RunDetailDto,
  UserTokenDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { stripAttribution } from "./support/attribution";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "runs-owner@example.com";
const MEMBER_EMAIL = "runs-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.7 — run grouping and rollback over REST.
 *
 * The suite pins the D16 boundary (a run exists only for a PAT batch, a single
 * destructive PAT command or the internal revert), attribution/pre-images on
 * every run command, conflict-checked previews, and a one-time human-only
 * revert that restores the prior state without breaking ordinary undo.
 */
describe("Agent runs and rollback (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerSession: string;
  let memberSession: string;
  let ownerId: string;
  let boardId: string;
  let workerToken: string;
  let readOnlyToken: string;
  let trustedToken: string;
  let trustedTokenId: string;
  let baseUrl: string;

  beforeAll(async () => {
    // The suite deliberately creates many runs; the global quota is another
    // suite's subject.
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const owner = await register(OWNER_EMAIL, "Owner");
    ownerSession = owner.accessToken;
    ownerId = owner.id;
    const member = await register(MEMBER_EMAIL, "Member");
    memberSession = member.accessToken;

    boardId = await createBoard("Runs board");
    await invite(MEMBER_EMAIL, "MEMBER");
    await acceptInvitation(memberSession);

    workerToken = (await createToken("worker-agent", ownerSession, "worker"))
      .token;
    readOnlyToken = (
      await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(ownerSession))
        .send({
          name: "read-only-agent",
          expiresAt: null,
          scopePreset: "observer",
          readOnly: true,
        })
        .expect(201)
        .then((res) => res.body as CreateUserTokenResponse)
    ).token;
    const trusted = await createToken(
      "trusted-agent",
      ownerSession,
      "worker",
      true,
    );
    trustedToken = trusted.token;
    trustedTokenId = (
      await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(ownerSession))
        .expect(200)
        .then((res) => res.body as UserTokenDto[])
    ).find((row) => row.name === "trusted-agent")!.id;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(
    email: string,
    displayName: string,
  ): Promise<{ accessToken: string; id: string }> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => ({
        accessToken: res.body.accessToken as string,
        id: res.body.user.id as string,
      }));
  }

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(ownerSession))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function invite(
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerSession))
      .send({ email, role })
      .expect(201);
  }

  async function acceptInvitation(token: string): Promise<void> {
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200)
      .then(
        (res) =>
          (res.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === boardId,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(token))
      .expect(200);
  }

  async function createToken(
    name: string,
    login: string,
    scopePreset: "worker" | "admin",
    trustedCi = false,
  ): Promise<CreateUserTokenResponse> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(login))
      .send({ name, expiresAt: null, scopePreset, trustedCi })
      .expect(201)
      .then((res) => res.body as CreateUserTokenResponse);
  }

  function command(
    type: string,
    fields: Record<string, unknown>,
    options: { token?: string; board?: string; commandId?: string } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${options.board ?? boardId}/commands`)
      .set(auth(options.token ?? ownerSession))
      .send({
        commandId: options.commandId ?? randomUUID(),
        action: {
          boardId: options.board ?? boardId,
          at: Date.now(),
          type,
          ...fields,
        },
      });
  }

  function batch(
    commands: Array<{ commandId?: string; action: Record<string, unknown> }>,
    options: {
      token?: string;
      board?: string;
      clientRunId?: string;
    } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${options.board ?? boardId}/commands/batch`)
      .set(auth(options.token ?? ownerSession))
      .send({
        commands: commands.map((entry) => ({
          commandId: entry.commandId ?? randomUUID(),
          action: {
            boardId: options.board ?? boardId,
            at: Date.now(),
            ...entry.action,
          },
        })),
        ...(options.clientRunId !== undefined
          ? { clientRunId: options.clientRunId }
          : {}),
      });
  }

  async function aggregate(board = boardId): Promise<Board> {
    return server()
      .get(`/api/v1/boards/${board}`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as Board);
  }

  async function createColumn(title = "Todo"): Promise<string> {
    const columnId = randomUUID();
    await command("ADD_COLUMN", { newColumnId: columnId, title }).expect(200);
    return columnId;
  }

  async function createCard(columnId: string, title = "Card"): Promise<string> {
    const cardId = randomUUID();
    await command("ADD_CARD", {
      newCardId: cardId,
      columnId,
      title,
    }).expect(200);
    return cardId;
  }

  /**
   * Retire a test column so the board stays below `LIMITS.columnsPerBoard`
   * for the next scenario. The aggregate only counts active columns.
   */
  async function retireColumn(columnId: string): Promise<void> {
    await command("DELETE_COLUMN", { columnId }).expect(200);
  }

  function runs() {
    return server()
      .get(`/api/v1/boards/${boardId}/runs`)
      .set(auth(ownerSession));
  }

  function preview(runId: string, token = ownerSession) {
    return server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert/preview`)
      .set(auth(token))
      .send({});
  }

  function revert(
    runId: string,
    commandId = randomUUID(),
    token = ownerSession,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert`)
      .set(auth(token))
      .send({ commandId });
  }

  it("creates one run for a PAT batch and stamps every command", async () => {
    const columnId = await createColumn("Batch");
    const cardId = randomUUID();
    const clientRunId = `run-${randomUUID().slice(0, 8)}`;
    const response = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: cardId,
            columnId,
            title: "Agent card",
          },
        },
        {
          action: { type: "UPDATE_CARD", cardId, description: "hello" },
        },
        {
          action: { type: "SET_CARD_PRIORITY", cardId, priority: "high" },
        },
      ],
      { token: workerToken, clientRunId },
    ).expect(200);
    const body = response.body as CommandBatchResponse;
    expect(body.runId).toEqual(expect.any(String));
    expect(response.headers["x-run-id"]).toBe(body.runId);
    expect(body.results).toHaveLength(3);
    for (const result of body.results) {
      expect(result.runId).toBe(body.runId);
    }

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: body.runId! },
    });
    expect(run).toMatchObject({
      boardId,
      kind: "batch",
      status: "applied",
      clientRunId,
      apiTokenId: expect.any(String),
      actorId: ownerId,
      commandCount: 3,
      firstSeq: expect.any(BigInt),
      lastSeq: expect.any(BigInt),
    });
    const commands = await prisma.command.findMany({
      where: { runId: run.id },
      orderBy: { seq: "asc" },
    });
    expect(commands).toHaveLength(3);
    expect(commands.every((row) => row.apiTokenId === run.apiTokenId)).toBe(
      true,
    );
    expect(commands.every((row) => row.agentName === "worker-agent")).toBe(
      true,
    );
    expect(
      await prisma.commandPreimage.count({ where: { runId: run.id } }),
    ).toBe(3);

    // Same clientRunId + same commands is an idempotent replay.
    const replay = await batch(
      [
        {
          commandId: commands[0]!.id,
          action: {
            type: "ADD_CARD",
            newCardId: cardId,
            columnId,
            title: "Agent card",
          },
        },
        {
          commandId: commands[1]!.id,
          action: { type: "UPDATE_CARD", cardId, description: "hello" },
        },
        {
          commandId: commands[2]!.id,
          action: { type: "SET_CARD_PRIORITY", cardId, priority: "high" },
        },
      ],
      { token: workerToken, clientRunId },
    ).expect(200);
    expect((replay.body as CommandBatchResponse).runId).toBe(run.id);
    expect(
      await prisma.command.count({ where: { boardId, runId: run.id } }),
    ).toBe(3);

    // A different plan on the same clientRunId is a conflict, not a replay.
    const conflict = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: randomUUID(),
            columnId,
            title: "Other plan",
          },
        },
      ],
      { token: workerToken, clientRunId },
    ).expect(409);
    expect(conflict.body.code).toBe("run_conflict");
  });

  it("does not store a destructive inverse for a no-op command (C1)", async () => {
    const columnId = await createColumn("No-op base");
    const cardId = await createCard(columnId, "No-op card");
    const labelId = randomUUID();
    const checklistId = randomUUID();
    const itemId = randomUUID();
    await command("ADD_LABEL", {
      label: { id: labelId, name: "Noop", color: "blue" },
    }).expect(200);
    await command("SET_CARD_LABEL", {
      cardId,
      labelId,
      on: true,
    }).expect(200);
    await command("ADD_CHECKLIST", {
      cardId,
      newChecklistId: checklistId,
      title: "Steps",
    }).expect(200);
    await command("ADD_CHECKLIST_ITEM", {
      cardId,
      checklistId,
      newItemId: itemId,
      text: "One",
    }).expect(200);

    const noops: Array<Record<string, unknown>> = [
      { type: "ADD_COLUMN", newColumnId: columnId, title: "No-op base" },
      {
        type: "ADD_LABEL",
        label: { id: labelId, name: "Noop", color: "blue" },
      },
      { type: "DUPLICATE_CARD", cardId, newCardId: cardId },
      {
        type: "DUPLICATE_COLUMN",
        columnId,
        newColumnId: columnId,
        newCardIds: [cardId],
      },
      { type: "SET_CARD_LABEL", cardId, labelId, on: true },
      {
        type: "ADD_CHECKLIST",
        cardId,
        newChecklistId: checklistId,
        title: "Steps",
      },
      {
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: itemId,
        text: "One",
      },
    ];

    for (const noop of noops) {
      const noopCommandId = randomUUID();
      const created = await batch(
        [
          { commandId: noopCommandId, action: noop },
          {
            action: {
              type: "SET_CARD_PRIORITY",
              cardId,
              priority: "high",
            },
          },
        ],
        { token: workerToken },
      ).expect(200);
      const runId = (created.body as CommandBatchResponse).runId!;
      const preimage = await prisma.commandPreimage.findUniqueOrThrow({
        where: { commandId: noopCommandId },
      });
      const data = preimage.data as {
        entities: unknown[];
        inverse?: { type: string } | null;
      };
      expect({
        type: noop.type,
        entities: data.entities,
        inverse: data.inverse,
      }).toEqual({ type: noop.type, entities: [], inverse: null });

      const previewBody = (await preview(runId).expect(200))
        .body as RevertPreviewDto;
      expect(previewBody.canRevert).toBe(true);
      await revert(runId).expect(200);

      const after = await aggregate();
      expect(after.columns.some((column) => column.id === columnId)).toBe(true);
      expect(after.cards[cardId]).toMatchObject({
        title: "No-op card",
        labelIds: [labelId],
      });
      expect(after.cards[cardId]?.checklists?.[0]?.items[0]?.text).toBe("One");
      expect(after.labels.some((label) => label.id === labelId)).toBe(true);
    }
    await retireColumn(columnId);
  });

  it("keeps a no-op-only run non-revertable instead of deleting a pre-existing entity", async () => {
    const columnId = await createColumn("No-op only");
    const cardId = await createCard(columnId, "Survivor");
    const labelId = randomUUID();
    await command("ADD_LABEL", {
      label: { id: labelId, name: "Keep", color: "green" },
    }).expect(200);

    const created = await batch(
      [
        {
          action: {
            type: "ADD_COLUMN",
            newColumnId: columnId,
            title: "Duplicate",
          },
        },
        {
          action: {
            type: "ADD_LABEL",
            label: { id: labelId, name: "Keep", color: "green" },
          },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;

    // C1 legacy row: an old no-op pre-image may still carry a destructive
    // inverse. The analyzer must ignore it even when the command row predates
    // the writer fix.
    const stored = await prisma.commandPreimage.findFirstOrThrow({
      where: { runId },
      select: { commandId: true, data: true },
    });
    await prisma.commandPreimage.update({
      where: { commandId: stored.commandId },
      data: {
        data: {
          ...(stored.data as Record<string, unknown>),
          inverse: {
            type: "DELETE_COLUMN",
            boardId,
            at: Date.now(),
            columnId,
          },
        },
      },
    });

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual([]);

    const refused = await revert(runId).expect(409);
    expect(refused.body).toMatchObject({ code: "run_conflict", runId });
    const after = await aggregate();
    expect(after.columns.some((column) => column.id === columnId)).toBe(true);
    expect(after.cards[cardId]?.title).toBe("Survivor");
    expect(after.labels.some((label) => label.id === labelId)).toBe(true);
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
    await retireColumn(columnId);
  });

  it("does not create a run for a browser batch or an ordinary single PAT command", async () => {
    const columnId = await createColumn("No run");
    const before = await prisma.agentRun.count({ where: { boardId } });

    const human = await batch([
      {
        action: {
          type: "ADD_CARD",
          newCardId: randomUUID(),
          columnId,
          title: "Human batch",
        },
      },
    ]).expect(200);
    expect((human.body as CommandBatchResponse).runId ?? null).toBeNull();
    expect(human.headers["x-run-id"]).toBeUndefined();
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(before);

    const cardId = randomUUID();
    const single = await command(
      "ADD_CARD",
      { newCardId: cardId, columnId, title: "PAT single" },
      { token: workerToken },
    ).expect(200);
    expect((single.body as CommandResponse).runId ?? null).toBeNull();
    expect(single.headers["x-run-id"]).toBeUndefined();
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(before);
  });

  it("creates a single run for a destructive PAT command and stores a pre-image", async () => {
    const columnId = await createColumn("Destructive");
    const cardId = await createCard(columnId, "Delete me");
    const commandId = randomUUID();
    const response = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken, commandId },
    ).expect(200);
    const body = response.body as CommandResponse;
    expect(body.runId).toEqual(expect.any(String));
    expect(response.headers["x-run-id"]).toBe(body.runId);

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: body.runId! },
    });
    expect(run).toMatchObject({
      boardId,
      kind: "single",
      status: "applied",
      apiTokenId: trustedTokenId,
      commandCount: 1,
    });
    const commandRow = await prisma.command.findUniqueOrThrow({
      where: { id: commandId },
    });
    expect(commandRow.runId).toBe(run.id);
    const preimage = await prisma.commandPreimage.findUniqueOrThrow({
      where: { commandId },
    });
    expect(preimage.runId).toBe(run.id);
    expect(preimage.boardId).toBe(boardId);
    const data = preimage.data as {
      schemaVersion: number;
      entities: Array<{
        touch: string;
        exists: boolean;
        snapshot: { title?: string } | null;
        postDeletedAt: number | null;
      }>;
      inverse: { type: string } | null;
    };
    expect(data.schemaVersion).toBe(1);
    const card = data.entities.find(
      (entry) => entry.touch === `card:${cardId}`,
    );
    expect(card).toMatchObject({
      exists: true,
      snapshot: { title: "Delete me" },
    });
    expect(card!.postDeletedAt).toEqual(expect.any(Number));
    expect(data.inverse?.type).toBe("RESTORE_CARD");

    // Preview is free for the PAT; applying a revert is not (D17).
    const dry = await preview(run.id, trustedToken).expect(200);
    const previewBody = dry.body as RevertPreviewDto;
    expect(previewBody).toMatchObject({
      dryRun: true,
      canRevert: true,
      conflicts: [],
    });
    expect(previewBody.diff).toBeUndefined();
    const denied = await revert(run.id, randomUUID(), trustedToken).expect(403);
    expect(denied.body.code).toBe("pat_forbidden");
  });

  it("previews and applies a clean revert once, then refuses a second or nested revert", async () => {
    const columnId = await createColumn("Revert");
    const cardId = await createCard(columnId, "Original");
    const before = await aggregate();
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;
    expect((await aggregate()).cards[cardId]).toBeUndefined();

    const clean = await preview(runId).expect(200);
    const cleanPreview = clean.body as RevertPreviewDto;
    expect(cleanPreview.canRevert).toBe(true);
    expect(cleanPreview.diff).toBeDefined();
    expect(cleanPreview.conflicts).toEqual([]);
    expect(clean.headers["x-run-id"]).toBeUndefined();

    const revertCommandId = randomUUID();
    const reverted = await revert(runId, revertCommandId).expect(200);
    const detail = reverted.body as RunDetailDto;
    expect(reverted.headers["x-run-id"]).toBe(detail.run.id);
    expect(detail.run).toMatchObject({
      kind: "revert",
      status: "applied",
      revertsRunId: runId,
      clientRunId: revertCommandId,
    });
    expect(detail.commands.length).toBeGreaterThan(0);
    expect(detail.preimages).toEqual(expect.any(Object));

    const original = await prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(original.status).toBe("reverted");
    expect(original.revertedAt).not.toBeNull();
    expect((await aggregate()).cards[cardId]?.title).toBe("Original");
    expect(stripAttribution(await aggregate())).toEqual(
      stripAttribution(before),
    );

    const activity = await prisma.activity.findFirst({
      where: { boardId, type: "run_reverted", runId: detail.run.id },
    });
    expect(activity).not.toBeNull();

    // Idempotent retry returns the same audit run.
    const retried = await revert(runId, revertCommandId).expect(200);
    expect((retried.body as RunDetailDto).run.id).toBe(detail.run.id);
    // A second, different revert is refused: one-time only.
    const second = await revert(runId).expect(409);
    expect(second.body.code).toBe("run_conflict");
    // A revert of that revert is forbidden in the MVP.
    const nested = await revert(detail.run.id).expect(409);
    expect(nested.body.code).toBe("run_conflict");
    // A non-ADMIN board member cannot apply a revert.
    const member = await revert(runId, randomUUID(), memberSession).expect(403);
    expect(member.body.code).toBe("scope_denied");
  });

  it("treats concurrent identical revert retries as one committed rollback (M20)", async () => {
    const columnId = await createColumn("Concurrent revert");
    const cardId = await createCard(columnId, "Concurrent card");
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;
    const key = randomUUID();

    // Hold the board advisory lock both reverts need. Both requests finish
    // their preflight (top replay lookup, status check, analyze) while the
    // run is still `applied`, then queue on the lock; the loser must
    // reconcile with the winner from the post-lock path.
    let acquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let release!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
      acquired();
      await lockReleased;
    });
    await lockAcquired;
    const pending = Promise.all([revert(runId, key), revert(runId, key)]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      release();
    }
    await holder;
    const [first, second] = await pending;
    expect([first.status, second.status]).toEqual([200, 200]);
    const firstId = (first.body as RunDetailDto).run.id;
    expect((second.body as RunDetailDto).run.id).toBe(firstId);
    expect(
      await prisma.agentRun.count({
        where: { boardId, kind: "revert", revertsRunId: runId },
      }),
    ).toBe(1);
    expect(
      await prisma.activity.count({
        where: { boardId, type: "run_reverted", runId: firstId },
      }),
    ).toBe(1);
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("reverted");
    expect((await aggregate()).cards[cardId]?.title).toBe("Concurrent card");
    await retireColumn(columnId);
  });

  it("never reuses a clientRunId for a different run (M20)", async () => {
    // Separate columns: H4 correctly treats another card leaving the same
    // column as a later column change, which is not what this test measures.
    const firstColumn = await createColumn("Revert keys first");
    const secondColumn = await createColumn("Revert keys second");
    const firstCard = await createCard(firstColumn, "First");
    const secondCard = await createCard(secondColumn, "Second");
    const firstRun = (
      await command(
        "DELETE_CARD",
        { cardId: firstCard },
        { token: trustedToken },
      ).expect(200)
    ).body as CommandResponse;
    const secondRun = (
      await command(
        "DELETE_CARD",
        { cardId: secondCard },
        { token: trustedToken },
      ).expect(200)
    ).body as CommandResponse;
    const key = randomUUID();

    await revert(firstRun.runId!, key).expect(200);
    const conflict = await revert(secondRun.runId!, key).expect(409);
    expect(conflict.body).toMatchObject({
      code: "run_conflict",
      runId: secondRun.runId,
      currentVersion: expect.any(Number),
    });
    expect(
      (
        await prisma.agentRun.findUniqueOrThrow({
          where: { id: secondRun.runId! },
        })
      ).status,
    ).toBe("applied");
    expect((await aggregate()).cards[secondCard]).toBeUndefined();
    await retireColumn(firstColumn);
    await retireColumn(secondColumn);
  });

  it("previews the WIP refusal before applying an unarchive (M22)", async () => {
    const columnId = await createColumn("WIP preview");
    await command("SET_COLUMN_WIP_LIMIT", { columnId, wipLimit: 1 }).expect(
      200,
    );
    const cardId = await createCard(columnId, "Archived");
    const created = await batch(
      [
        { action: { type: "ARCHIVE_CARD", cardId } },
        {
          action: {
            type: "SET_COLUMN_ACCENT",
            columnId,
            accent: { type: "color", value: "blue" },
          },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    await createCard(columnId, "Filled the WIP slot");

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "wip" })]),
    );
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
    await retireColumn(columnId);
  });

  it("releases a PAT-held claim on revert with matching preview (M7)", async () => {
    const columnId = await createColumn("Claim revert");
    const cardId = await createCard(columnId, "Claimed");
    const created = await batch(
      [
        {
          action: {
            type: "CLAIM_CARD",
            cardId,
            claimedBy: ownerId,
            leaseUntil: Date.now() + 600_000,
          },
        },
        {
          action: { type: "SET_CARD_PRIORITY", cardId, priority: "high" },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    expect((await aggregate()).cards[cardId].claimedBy).toBe(ownerId);

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(runId).expect(200);
    expect((await aggregate()).cards[cardId].claimedBy).toBeUndefined();
    await retireColumn(columnId);
  });

  it("previews a removed assignee before applying SET_CARD_ASSIGN (M22)", async () => {
    const columnId = await createColumn("Assignee preview");
    const cardId = await createCard(columnId, "Assigned");
    const assignee = await register("runs-assignee@example.com", "Assignee");
    await invite("runs-assignee@example.com", "MEMBER");
    await server()
      .get("/api/v1/invitations")
      .set(auth(assignee.accessToken))
      .expect(200)
      .then(async (res) => {
        const invitation = (
          res.body as Array<{ id: string; boardId: string }>
        ).find((row) => row.boardId === boardId)!.id;
        await server()
          .post(`/api/v1/invitations/${invitation}/accept`)
          .set(auth(assignee.accessToken))
          .expect(200);
      });
    // The run *unassigns* the member; its inverse must re-assign, which is
    // the apply-time membership check M22 is about.
    await command("SET_CARD_ASSIGN", {
      cardId,
      assigneeId: assignee.id,
    }).expect(200);
    const created = await batch(
      [
        {
          action: {
            type: "SET_CARD_ASSIGN",
            cardId,
            assigneeId: null,
          },
        },
        {
          action: { type: "SET_CARD_PRIORITY", cardId, priority: "low" },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    await prisma.boardMember.delete({
      where: { boardId_userId: { boardId, userId: assignee.id } },
    });

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          touch: `card:${cardId}`,
          reason: "assignee_not_member",
        }),
      ]),
    );
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    await retireColumn(columnId);
  });

  it("previews an oversized inverse before applying it (M22)", async () => {
    const columnId = await createColumn("Oversized inverse");
    await prisma.card.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        id: `oversized-${index}`,
        columnId,
        title: `Oversized ${index}`,
        description: "x".repeat(65_536),
        position: index,
        acceptanceCriteria: [],
        definitionOfDone: [],
      })),
    });
    const deleted = await command(
      "DELETE_COLUMN",
      { columnId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;

    const previewBody = (
      await server()
        .post(`/api/v1/boards/${boardId}/runs/${runId}/revert/preview`)
        .set(auth(readOnlyToken))
        .send({})
        .expect(200)
    ).body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "payload_too_large" }),
      ]),
    );
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    expect(
      (await aggregate()).columns.some((column) => column.id === columnId),
    ).toBe(false);
  });

  it("returns a validation error for a missing commandId and keeps the generic dry run PAT-safe (L21)", async () => {
    const columnId = await createColumn("L21");
    const cardId = await createCard(columnId, "L21 card");
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;

    const missing = await server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert`)
      .set(auth(ownerSession))
      .send({})
      .expect(400);
    expect(missing.body).toMatchObject({
      code: "validation_failed",
      field: "commandId",
    });

    const dry = await server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert`)
      .set(auth(readOnlyToken))
      .send({ dryRun: true })
      .expect(200);
    expect(dry.body).toMatchObject({
      dryRun: true,
      canRevert: true,
    });
    expect(dry.body.commandId).toBeUndefined();

    const real = await server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert`)
      .set(auth(readOnlyToken))
      .send({ commandId: randomUUID() })
      .expect(403);
    expect(real.body.code).toBe("pat_forbidden");
    await retireColumn(columnId);
  });

  it("blocks a revert on a later edit and applies nothing", async () => {
    const columnId = await createColumn("Conflict");
    const cardId = randomUUID();
    const created = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: cardId,
            columnId,
            title: "Run title",
          },
        },
        {
          action: { type: "UPDATE_CARD", cardId, description: "run" },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;

    await command("UPDATE_CARD", {
      cardId,
      title: "Human title",
    }).expect(200);

    const conflict = await preview(runId).expect(200);
    const conflictPreview = conflict.body as RevertPreviewDto;
    expect(conflictPreview.canRevert).toBe(false);
    expect(conflictPreview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          touch: `card:${cardId}`,
          reason: "version_changed",
        }),
      ]),
    );
    const refused = await revert(runId).expect(409);
    expect(refused.body).toMatchObject({
      code: "run_conflict",
      runId,
      currentVersion: expect.any(Number),
    });
    expect(refused.body.details.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ touch: `card:${cardId}` }),
      ]),
    );
    // Nothing applied, and the run is still available for future inspection.
    expect((await aggregate()).cards[cardId]?.title).toBe("Human title");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
  });

  it("conflicts when a human adds a card to a column the run created (H4)", async () => {
    const columnId = randomUUID();
    const created = await batch(
      [
        {
          action: {
            type: "ADD_COLUMN",
            newColumnId: columnId,
            title: "Run column",
          },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    const humanCardId = await createCard(columnId, "Human after run");

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ touch: `column:${columnId}` }),
      ]),
    );

    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    const after = await aggregate();
    expect(after.columns.some((column) => column.id === columnId)).toBe(true);
    expect(after.cards[humanCardId]?.title).toBe("Human after run");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
    await retireColumn(columnId);
  });

  it("does not self-conflict when a run adds/archives/moves and deletes in one column (H4)", async () => {
    // ADD_CARD → DELETE_CARD: the delete bumps the column after the add; the
    // run's own pre-image must record that bump, not compare against ADD's.
    const addDeleteColumn = await createColumn("Self add delete");
    const addDeleteCard = randomUUID();
    const addDelete = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: addDeleteCard,
            columnId: addDeleteColumn,
            title: "Transient add delete",
          },
        },
        { action: { type: "DELETE_CARD", cardId: addDeleteCard } },
      ],
      { token: trustedToken },
    ).expect(200);
    const addDeleteRun = (addDelete.body as CommandBatchResponse).runId!;
    // The invisible bump must be visible: the delete's response carries the
    // new column version for `ifMatchVersions` and the SSE `touches` list.
    expect(
      (addDelete.body as CommandBatchResponse).results[1]!.versions,
    ).toEqual(
      expect.objectContaining({
        [`column:${addDeleteColumn}`]: expect.any(Number),
      }),
    );
    expect(
      (
        await prisma.command.findFirstOrThrow({
          where: { runId: addDeleteRun, type: "DELETE_CARD" },
          select: { touches: true },
        })
      ).touches,
    ).toContain(`column:${addDeleteColumn}`);
    const addDeletePreview = (await preview(addDeleteRun).expect(200))
      .body as RevertPreviewDto;
    expect(addDeletePreview).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(addDeleteRun).expect(200);
    expect(
      (await aggregate()).columns.some(
        (column) => column.id === addDeleteColumn,
      ),
    ).toBe(true);
    await retireColumn(addDeleteColumn);

    // ADD_CARD → ARCHIVE_CARD: archive also rewrites the source column.
    const archiveColumn = await createColumn("Self add archive");
    const archiveCard = randomUUID();
    const archived = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: archiveCard,
            columnId: archiveColumn,
            title: "Transient archive",
          },
        },
        { action: { type: "ARCHIVE_CARD", cardId: archiveCard } },
      ],
      { token: trustedToken },
    ).expect(200);
    const archiveRun = (archived.body as CommandBatchResponse).runId!;
    expect(
      (archived.body as CommandBatchResponse).results[1]!.versions,
    ).toEqual(
      expect.objectContaining({
        [`column:${archiveColumn}`]: expect.any(Number),
      }),
    );
    const archivePreview = (await preview(archiveRun).expect(200))
      .body as RevertPreviewDto;
    expect(archivePreview).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(archiveRun).expect(200);
    expect(
      (await aggregate()).columns.some((column) => column.id === archiveColumn),
    ).toBe(true);
    await retireColumn(archiveColumn);

    // MOVE_CARD → DELETE_CARD: the move and the delete both bump the source
    // and destination columns.
    const moveFrom = await createColumn("Self move from");
    const moveTo = await createColumn("Self move to");
    const movedCard = await createCard(moveFrom, "Move then delete");
    const moved = await batch(
      [
        {
          action: {
            type: "MOVE_CARD",
            cardId: movedCard,
            fromColumnId: moveFrom,
            fromIndex: 0,
            toColumnId: moveTo,
            toIndex: 0,
          },
        },
        { action: { type: "DELETE_CARD", cardId: movedCard } },
      ],
      { token: trustedToken },
    ).expect(200);
    const movedRun = (moved.body as CommandBatchResponse).runId!;
    const movedPreview = (await preview(movedRun).expect(200))
      .body as RevertPreviewDto;
    expect(movedPreview).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(movedRun).expect(200);
    const restored = await aggregate();
    const fromColumn = restored.columns.find(
      (column) => column.id === moveFrom,
    );
    const toColumn = restored.columns.find((column) => column.id === moveTo);
    expect(fromColumn?.cardIds).toContain(movedCard);
    expect(toColumn?.cardIds).not.toContain(movedCard);
    await retireColumn(moveFrom);
    await retireColumn(moveTo);
  });

  it("records the DUPLICATE_CARD destination column and nested checklists in its preimage (H4/H3)", async () => {
    const columnId = await createColumn("Duplicate destination");
    const sourceId = await createCard(columnId, "Duplicate source");
    const sourceChecklistId = randomUUID();
    const sourceItemId = randomUUID();
    await command("ADD_CHECKLIST", {
      cardId: sourceId,
      newChecklistId: sourceChecklistId,
      title: "Steps",
    }).expect(200);
    await command("ADD_CHECKLIST_ITEM", {
      cardId: sourceId,
      checklistId: sourceChecklistId,
      newItemId: sourceItemId,
      text: "One",
    }).expect(200);
    const copyId = randomUUID();
    const duplicateCommandId = randomUUID();
    const created = await batch(
      [
        {
          commandId: duplicateCommandId,
          action: {
            type: "DUPLICATE_CARD",
            cardId: sourceId,
            newCardId: copyId,
            title: "Duplicate copy",
          },
        },
        {
          action: {
            type: "UPDATE_CARD",
            cardId: copyId,
            description: "copy body",
          },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    expect((created.body as CommandBatchResponse).results[0]!.versions).toEqual(
      expect.objectContaining({
        [`column:${columnId}`]: expect.any(Number),
      }),
    );
    const preimage = await prisma.commandPreimage.findUniqueOrThrow({
      where: { commandId: duplicateCommandId },
    });
    const data = preimage.data as {
      entities: Array<{
        touch: string;
        exists: boolean;
        snapshot: { title?: string } | null;
      }>;
    };
    expect(
      data.entities.find((entity) => entity.touch === `column:${columnId}`),
    ).toMatchObject({
      exists: true,
      snapshot: { title: "Duplicate destination" },
    });

    const duplicated = await aggregate();
    const copy = duplicated.cards[copyId]!;
    expect(copy.checklists).toHaveLength(1);
    const copyChecklist = copy.checklists![0];
    const copyItem = copyChecklist.items[0];
    expect(copyChecklist.id).toBe(duplicateChecklistId(copyId, 0));
    // The run's pre-image must know the copy created these rows, so a revert
    // removes exactly the copy and never the source's checklist.
    for (const touch of [
      `checklist:${copyChecklist.id}`,
      `checklistItem:${copyItem.id}`,
    ]) {
      expect(
        data.entities.find((entity) => entity.touch === touch),
      ).toMatchObject({ exists: false, postVersion: expect.any(Number) });
    }
    const duplicateCommand = await prisma.command.findUniqueOrThrow({
      where: { id: duplicateCommandId },
      select: { touches: true },
    });
    expect(duplicateCommand.touches).toEqual(
      expect.arrayContaining([
        `checklist:${copyChecklist.id}`,
        `checklistItem:${copyItem.id}`,
      ]),
    );

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(runId).expect(200);
    const after = await aggregate();
    expect(after.cards[sourceId]?.title).toBe("Duplicate source");
    expect(after.cards[copyId]).toBeUndefined();
    expect(after.cards[sourceId]?.checklists?.[0].id).toBe(sourceChecklistId);
    await retireColumn(columnId);
  });

  it("reverts a run that deleted its own source column (H5)", async () => {
    // Archive X, then delete C in the same run. The inverse sequence restores
    // C before unarchiving X, so it must not look like a human deletion.
    const archiveColumn = await createColumn("Run deletes archive source");
    const archiveCard = await createCard(archiveColumn, "Archive with column");
    const archived = await batch(
      [
        { action: { type: "ARCHIVE_CARD", cardId: archiveCard } },
        { action: { type: "DELETE_COLUMN", columnId: archiveColumn } },
      ],
      { token: trustedToken },
    ).expect(200);
    const archiveRun = (archived.body as CommandBatchResponse).runId!;
    const archivePreview = (await preview(archiveRun).expect(200))
      .body as RevertPreviewDto;
    expect(archivePreview).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(archiveRun).expect(200);
    const afterArchive = await aggregate();
    expect(afterArchive.columns.some((c) => c.id === archiveColumn)).toBe(true);
    expect(
      afterArchive.columns
        .find((c) => c.id === archiveColumn)
        ?.cardIds.includes(archiveCard),
    ).toBe(true);
    await retireColumn(archiveColumn);

    // Delete X, then delete C. The column restore comes before the card
    // restore in the inverse sequence.
    const deleteColumn = await createColumn("Run deletes card source");
    const deleteCard = await createCard(deleteColumn, "Delete with column");
    const deleted = await batch(
      [
        { action: { type: "DELETE_CARD", cardId: deleteCard } },
        { action: { type: "DELETE_COLUMN", columnId: deleteColumn } },
      ],
      { token: trustedToken },
    ).expect(200);
    const deleteRun = (deleted.body as CommandBatchResponse).runId!;
    const deletePreview = (await preview(deleteRun).expect(200))
      .body as RevertPreviewDto;
    expect(deletePreview).toMatchObject({ canRevert: true, conflicts: [] });
    await revert(deleteRun).expect(200);
    const afterDelete = await aggregate();
    expect(afterDelete.columns.some((c) => c.id === deleteColumn)).toBe(true);
    expect(
      afterDelete.columns
        .find((c) => c.id === deleteColumn)
        ?.cardIds.includes(deleteCard),
    ).toBe(true);
    await retireColumn(deleteColumn);
  });

  it("blocks deleting a card from a column a human removed (H5)", async () => {
    const columnId = await createColumn("Source delete");
    const cardId = await createCard(columnId, "Deleted by run");
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;
    await command("DELETE_COLUMN", { columnId }).expect(200);

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ touch: `column:${columnId}` }),
      ]),
    );
    // H4 version check and H5 source-column deletion both point at the same
    // column. The UI keys rows by `touch`, so the API must emit it once.
    const touches = previewBody.conflicts.map((conflict) => conflict.touch);
    expect(new Set(touches).size).toBe(touches.length);
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
    expect(
      await prisma.agentRun.count({
        where: { boardId, kind: "revert", revertsRunId: runId },
      }),
    ).toBe(0);
  });

  it("blocks unarchiving into a column a human removed (H5)", async () => {
    const columnId = await createColumn("Source archive");
    const cardId = await createCard(columnId, "Archived by run");
    const created = await batch(
      [
        { action: { type: "ARCHIVE_CARD", cardId } },
        {
          action: {
            type: "SET_COLUMN_ACCENT",
            columnId,
            accent: { type: "color", value: "green" },
          },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    await command("DELETE_COLUMN", { columnId }).expect(200);

    const previewBody = (await preview(runId).expect(200))
      .body as RevertPreviewDto;
    expect(previewBody.canRevert).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ touch: `column:${columnId}` }),
      ]),
    );
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_conflict");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
  });

  it("revalidates conflicts under the board lock before applying inverses", async () => {
    const columnId = await createColumn("TOCTOU");
    const cardId = await createCard(columnId, "Before run");
    const created = await batch(
      [
        {
          action: { type: "UPDATE_CARD", cardId, title: "Run title" },
        },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;

    let acquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let release!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Hold the same board advisory lock the command writer takes, so the
    // revert passes its pre-flight analysis and blocks just before apply.
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${boardId}, 0))`;
      acquired();
      await lockReleased;
    });
    await lockAcquired;

    const pending = revert(runId).then((response) => response);
    try {
      // The request is now waiting on the board lock; change the card
      // directly (bypassing the command transport and its queue).
      await new Promise((resolve) => setTimeout(resolve, 300));
      await prisma.card.update({
        where: { id: cardId },
        data: { title: "Concurrent title", version: { increment: 1 } },
      });
    } finally {
      release();
    }
    await holder;

    const refused = await pending;
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("run_conflict");
    expect(refused.body.details.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          touch: `card:${cardId}`,
          reason: "version_changed",
        }),
      ]),
    );
    expect((await aggregate()).cards[cardId]?.title).toBe("Concurrent title");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
  });

  it("stores nested pre-images for a destructive column delete and restores it", async () => {
    const columnId = await createColumn("Column to delete");
    const cardId = await createCard(columnId, "Nested card");
    const checklistId = randomUUID();
    const itemId = randomUUID();
    await batch([
      {
        action: {
          type: "ADD_CHECKLIST",
          cardId,
          newChecklistId: checklistId,
          title: "Steps",
        },
      },
      {
        action: {
          type: "ADD_CHECKLIST_ITEM",
          cardId,
          checklistId,
          newItemId: itemId,
          text: "One",
        },
      },
    ]).expect(200);
    const before = await aggregate();
    const deleted = await command(
      "DELETE_COLUMN",
      { columnId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;
    expect((await aggregate()).columns.some((c) => c.id === columnId)).toBe(
      false,
    );

    const preimages = await prisma.commandPreimage.findMany({
      where: { runId },
      select: { data: true },
    });
    expect(preimages).toHaveLength(1);
    const entities = (
      preimages[0]!.data as {
        entities: Array<{
          touch: string;
          snapshot: { title?: string; items?: unknown[] } | null;
        }>;
      }
    ).entities;
    expect(
      entities.find((entry) => entry.touch === `column:${columnId}`)?.snapshot,
    ).toMatchObject({ title: "Column to delete" });
    expect(
      entities.find((entry) => entry.touch === `card:${cardId}`)?.snapshot,
    ).toMatchObject({ title: "Nested card" });
    expect(
      entities.find((entry) => entry.touch === `checklist:${checklistId}`)
        ?.snapshot,
    ).toMatchObject({ title: "Steps" });

    await revert(runId).expect(200);
    const restored = await aggregate();
    expect(stripAttribution(restored)).toEqual(stripAttribution(before));
    expect(restored.cards[cardId]?.checklists?.[0]?.items[0]?.text).toBe("One");
  });

  it("lists runs with filters/cursor, scopes detail to the board and hides pre-images from a PAT", async () => {
    const list = await runs().query({ kind: "batch", limit: 1 }).expect(200);
    const page = list.body as AgentRunDto[];
    expect(page).toHaveLength(1);
    expect(page[0]!.kind).toBe("batch");
    const older = await runs()
      .query({ kind: "batch", limit: 100, cursor: page[0]!.id })
      .expect(200);
    expect(
      (older.body as AgentRunDto[]).every((row) => row.id !== page[0]!.id),
    ).toBe(true);
    const filtered = await runs()
      .query({ apiTokenId: trustedTokenId })
      .expect(200);
    expect(
      (filtered.body as AgentRunDto[]).every(
        (row) => row.apiTokenId === trustedTokenId,
      ),
    ).toBe(true);
    const revertedOnly = await runs().query({ status: "reverted" }).expect(200);
    expect(
      (revertedOnly.body as AgentRunDto[]).every(
        (row) => row.status === "reverted",
      ),
    ).toBe(true);
    // L37: `failed` had no writer and is no longer a run status.
    const invalid = await runs().query({ status: "failed" }).expect(400);
    expect(invalid.body.code).toBe("validation_failed");

    const runId = page[0]!.id;
    const admin = await server()
      .get(`/api/v1/boards/${boardId}/runs/${runId}`)
      .set(auth(ownerSession))
      .expect(200);
    expect((admin.body as RunDetailDto).commands.length).toBeGreaterThan(0);
    expect(Object.keys((admin.body as RunDetailDto).preimages).length).toBe(
      (admin.body as RunDetailDto).commands.length,
    );

    const pat = await server()
      .get(`/api/v1/boards/${boardId}/runs/${runId}`)
      .set(auth(workerToken))
      .expect(200);
    expect((pat.body as RunDetailDto).commands.length).toBeGreaterThan(0);
    expect((pat.body as RunDetailDto).preimages).toEqual({});

    const otherBoard = await createBoard("Other board");
    const foreign = await server()
      .get(`/api/v1/boards/${otherBoard}/runs/${runId}`)
      .set(auth(ownerSession))
      .expect(404);
    expect(foreign.body.statusCode).toBe(404);
  });

  it("returns run_expired when the pre-images were removed and keeps ordinary undo working", async () => {
    const columnId = await createColumn("Expiry");
    const cardId = await createCard(columnId, "Expires");
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;
    await prisma.commandPreimage.deleteMany({ where: { runId } });
    const expired = await preview(runId).expect(409);
    expect(expired.body).toMatchObject({
      code: "run_expired",
      runId,
      retentionDays: expect.any(Number),
    });

    // The ordinary browser undo path is untouched: delete a live card and
    // restore it from its aggregate snapshot.
    const liveCardId = await createCard(columnId, "Human undo");
    const before = await aggregate();
    const snapshot = before.cards[liveCardId];
    await command("DELETE_CARD", { cardId: liveCardId }).expect(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerSession))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "RESTORE_CARD",
          card: snapshot,
          columnId,
        },
      })
      .expect(200);
    expect((await aggregate()).cards[liveCardId]?.title).toBe("Human undo");
  });

  it("refuses a partially retained run against its commandCount (H6)", async () => {
    const columnId = await createColumn("Partial retention");
    const cardId = await createCard(columnId, "Partial");
    const created = await batch(
      [
        { action: { type: "UPDATE_CARD", cardId, title: "Run partial" } },
        { action: { type: "SET_CARD_PRIORITY", cardId, priority: "high" } },
      ],
      { token: workerToken },
    ).expect(200);
    const runId = (created.body as CommandBatchResponse).runId!;
    const rows = await prisma.command.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
      select: { id: true },
    });
    expect(rows).toHaveLength(2);
    // Simulate retention/demo cleanup dropping one member: the pre-image for
    // it may still exist, but the run is no longer the set it applied.
    await prisma.command.delete({ where: { id: rows[0]!.id } });

    const expired = await preview(runId).expect(409);
    expect(expired.body).toMatchObject({
      code: "run_expired",
      runId,
      retentionDays: expect.any(Number),
    });
    const refused = await revert(runId).expect(409);
    expect(refused.body.code).toBe("run_expired");
    expect((await aggregate()).cards[cardId]?.title).toBe("Run partial");
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("applied");
    // This scenario intentionally broke the run's command set. Remove the
    // synthetic partial run so the suite's final attribution invariant only
    // checks runs that claim a complete log; retention would remove it too.
    await prisma.command.deleteMany({ where: { runId } });
    await prisma.commandPreimage.deleteMany({ where: { runId } });
    await prisma.agentRun.delete({ where: { id: runId } });
    await retireColumn(columnId);
  });

  it("publishes run.created when a fresh run commits (L38)", async () => {
    const columnId = await createColumn("Run SSE created");
    const snapshot = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerSession))
      .expect(200);
    const since = Number(snapshot.headers["x-board-seq"]);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const stream = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
        {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${ownerSession}`,
          },
          signal: abort.signal,
        },
      );
      const reader = stream.body!.getReader();
      const framePromise = (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream closed before run.created");
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "" || payload === "ping") continue;
            const frame = JSON.parse(payload) as {
              type?: string;
              op?: string;
              runId?: string;
            };
            if (frame.type === "run" && frame.op === "created") return frame;
          }
        }
      })();

      const created = await batch(
        [
          {
            action: {
              type: "ADD_CARD",
              newCardId: randomUUID(),
              columnId,
              title: "Created run",
            },
          },
          {
            action: { type: "RENAME_COLUMN", columnId, title: "Renamed" },
          },
        ],
        { token: workerToken },
      ).expect(200);
      const runId = (created.body as CommandBatchResponse).runId!;
      const frame = await framePromise;
      expect(frame).toMatchObject({ type: "run", op: "created", runId });
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
    await retireColumn(columnId);
  });

  it("publishes run.reverted on the board stream", async () => {
    const columnId = await createColumn("SSE");
    const cardId = await createCard(columnId, "Stream me");
    const deleted = await command(
      "DELETE_CARD",
      { cardId },
      { token: trustedToken },
    ).expect(200);
    const runId = (deleted.body as CommandResponse).runId!;

    const snapshot = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerSession))
      .expect(200);
    const since = Number(snapshot.headers["x-board-seq"]);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const stream = await fetch(
        `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
        {
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${ownerSession}`,
          },
          signal: abort.signal,
        },
      );
      const reader = stream.body!.getReader();
      const createdRunIds: string[] = [];
      const framePromise = (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream closed before run frame");
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "" || payload === "ping") continue;
            const frame = JSON.parse(payload) as {
              type?: string;
              op?: string;
              runId?: string;
            };
            if (frame.type === "run" && frame.op === "created") {
              if (frame.runId !== undefined) createdRunIds.push(frame.runId);
              continue;
            }
            if (
              frame.type === "run" &&
              frame.op === "reverted" &&
              frame.runId === runId
            ) {
              return frame;
            }
          }
        }
      })();
      const reverted = await revert(runId).expect(200);
      const revertRunId = (reverted.body as RunDetailDto).run.id;
      const frame = await framePromise;
      expect(frame).toMatchObject({ type: "run", op: "reverted", runId });
      // A revert run is announced by `run.reverted`, not an extra
      // `run.created` that would refresh the list twice.
      expect(createdRunIds).not.toContain(revertRunId);
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  });

  it("forbids a run from another board and rejects an unknown run", async () => {
    const otherBoard = await createBoard("Foreign runs");
    const columnId = randomUUID();
    await command(
      "ADD_COLUMN",
      { newColumnId: columnId, title: "Todo" },
      { board: otherBoard },
    ).expect(200);
    const cardId = randomUUID();
    const created = await batch(
      [
        {
          action: {
            type: "ADD_CARD",
            newCardId: cardId,
            columnId,
            title: "Foreign",
          },
        },
      ],
      { board: otherBoard, token: workerToken },
    ).expect(200);
    const foreignRunId = (created.body as CommandBatchResponse).runId!;

    const hidden = await server()
      .get(`/api/v1/boards/${boardId}/runs/${foreignRunId}`)
      .set(auth(ownerSession))
      .expect(404);
    expect(hidden.body.statusCode).toBe(404);
    const missing = await preview("no-such-run").expect(404);
    expect(missing.body.statusCode).toBe(404);
  });

  it("keeps run commands attributable and bound to one board", async () => {
    const rows = await prisma.agentRun.findMany({ where: { boardId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const commands = await prisma.command.findMany({
        where: { runId: row.id },
        select: { boardId: true, runId: true, apiTokenId: true },
      });
      expect(commands).toHaveLength(row.commandCount);
      expect(commands.every((command) => command.boardId === row.boardId)).toBe(
        true,
      );
      expect(commands.every((command) => command.runId === row.id)).toBe(true);
    }
  });
});
