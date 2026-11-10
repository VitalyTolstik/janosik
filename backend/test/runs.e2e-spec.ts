import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
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
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(before);

    const cardId = randomUUID();
    const single = await command(
      "ADD_CARD",
      { newCardId: cardId, columnId, title: "PAT single" },
      { token: workerToken },
    ).expect(200);
    expect((single.body as CommandResponse).runId ?? null).toBeNull();
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

    const revertCommandId = randomUUID();
    const reverted = await revert(runId, revertCommandId).expect(200);
    const detail = reverted.body as RunDetailDto;
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
    expect(refused.body.code).toBe("run_conflict");
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
    const none = await runs().query({ status: "failed" }).expect(200);
    expect(none.body).toEqual([]);

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
    expect(expired.body.code).toBe("run_expired");

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
      await revert(runId).expect(200);
      const frame = await framePromise;
      expect(frame).toMatchObject({ type: "run", op: "reverted", runId });
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
