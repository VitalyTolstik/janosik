import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DEFAULT_BOARD_AGENT_POLICY } from "@janosik/shared";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import * as boardAggregate from "@/boards/board-aggregate";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CommandsService } from "@/commands/commands.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "entity-cas@example.com";
const MEMBER_EMAIL = "entity-cas-member@example.com";
const PASSWORD = "correct horse battery";

interface BoardFixture {
  boardId: string;
  todoId: string;
  doingId: string;
  pat: string;
}

/**
 * TASK-200.7: targeted card intents and per-entity CAS.
 *
 * Every test gets a fresh board (and its own PAT), so WIP, workflow, policy
 * and claim state cannot leak between cases. Setup writes use the human
 * session: a workflow/policy change must not itself be classified as an agent
 * action or require an approval.
 *
 * The suite covers the two hard guarantees — different cards never conflict,
 * the same card does — plus exact-retry replay, WIP/workflow/approval,
 * observer/pause/cross-board access, archived/ownership handling and the
 * explicit `ifMatch = seq` mode.
 */
describe("Card entity CAS and targeted intents (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let memberSession: string;
  const todoColumns = new Map<string, string>();

  const load = jest.spyOn(boardAggregate, "loadBoardAggregate");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    session = await register(OWNER_EMAIL, "Owner");
    memberSession = await register(MEMBER_EMAIL, "Member");
  }, 60_000);

  afterAll(async () => {
    load.mockRestore();
    await wipeAll(prisma);
    await app.close();
  });

  beforeEach(() => load.mockClear());

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(email: string, displayName: string): Promise<string> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => res.body.accessToken as string);
  }

  async function newBoard(title: string): Promise<BoardFixture> {
    const boardId = await server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
    const todoId = randomUUID();
    const doingId = randomUUID();
    todoColumns.set(boardId, todoId);
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: todoId,
      title: "Todo",
    }).expect(200);
    await command(boardId, {
      type: "ADD_COLUMN",
      newColumnId: doingId,
      title: "Doing",
    }).expect(200);
    const pat = await createPat(boardId);
    return { boardId, todoId, doingId, pat };
  }

  function command(
    boardId: string,
    action: Record<string, unknown>,
    token = session,
    extra: {
      commandId?: string;
      ifMatchVersions?: Record<string, number>;
    } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: extra.commandId ?? randomUUID(),
        action: { boardId, at: Date.now(), ...action },
        ...(extra.ifMatchVersions !== undefined
          ? { ifMatchVersions: extra.ifMatchVersions }
          : {}),
      });
  }

  async function card(boardId: string, title: string): Promise<string> {
    const cardId = randomUUID();
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId: todoColumns.get(boardId),
      title,
    }).expect(200);
    return cardId;
  }

  async function fingerprintOf(commandId: string): Promise<string> {
    const row = await prisma.commandDetail.findFirstOrThrow({
      where: { commandId },
      select: { data: true },
    });
    const fingerprint = (row.data as { intentFingerprint?: string })
      .intentFingerprint;
    if (typeof fingerprint !== "string") {
      throw new Error("command has no intent fingerprint");
    }
    return fingerprint;
  }

  async function setIntentDetail(
    commandId: string,
    boardId: string,
    data: Prisma.InputJsonValue,
  ): Promise<void> {
    await prisma.commandDetail.deleteMany({ where: { commandId } });
    await prisma.commandDetail.create({
      data: { commandId, boardId, createdAt: new Date(), data },
    });
  }

  async function createPat(
    boardId: string,
    scopePreset: "worker" | "reviewer" | "admin" | "observer" = "admin",
    token = session,
  ): Promise<string> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(token))
      .send({ name: `entity-cas-${randomUUID()}`, boardId, scopePreset })
      .expect(201)
      .then((res) => res.body.token as string);
  }

  async function joinBoard(
    boardId: string,
    role: "MEMBER" | "VIEWER" = "MEMBER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(session))
      .send({ email: MEMBER_EMAIL, role })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(memberSession))
      .expect(200);
    const invitation = invitations.body.find(
      (row: { boardId: string }) => row.boardId === boardId,
    );
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(memberSession))
      .expect(200);
  }

  async function context(boardId: string, cardId: string, token: string) {
    return server()
      .get(`/api/v1/boards/${boardId}/cards/${cardId}/context`)
      .set(auth(token))
      .expect(200)
      .then(
        (res) =>
          res.body as {
            card: {
              id: string;
              description?: string;
              claimedBy?: string;
              leaseUntil?: number;
            };
            columnId: string;
            cardIndex: number;
            doneColumnIds: string[];
            seq: number;
            versions: Record<string, number>;
          },
      );
  }

  function patch(
    boardId: string,
    cardId: string,
    body: Record<string, unknown>,
    token: string,
    commandId = randomUUID(),
  ) {
    return server()
      .patch(`/api/v1/boards/${boardId}/cards/${cardId}`)
      .set(auth(token))
      .send({ commandId, ...body });
  }

  function move(
    boardId: string,
    cardId: string,
    body: Record<string, unknown>,
    token: string,
    commandId = randomUUID(),
    approvalId?: string,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/cards/${cardId}/move`)
      .set(auth(token))
      .set(approvalId !== undefined ? { "X-Approval-Id": approvalId } : {})
      .send({ commandId, ...body });
  }

  function claim(
    boardId: string,
    cardId: string,
    body: Record<string, unknown>,
    token: string,
    commandId = randomUUID(),
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/cards/${cardId}/claim`)
      .set(auth(token))
      .send({ commandId, ...body });
  }

  it("lets different cards update concurrently and keeps the same-card conflict targeted", async () => {
    const { boardId, pat } = await newBoard("Concurrent updates");
    const a = await card(boardId, "A");
    const b = await card(boardId, "B");
    load.mockClear();
    const before = await Promise.all([
      context(boardId, a, pat),
      context(boardId, b, pat),
    ]);
    // Context is a one-card read, not a board aggregate.
    expect(load).not.toHaveBeenCalled();

    load.mockClear();
    const different = await Promise.all([
      patch(
        boardId,
        a,
        {
          description: "A edited",
          ifMatchVersions: { [`card:${a}`]: before[0]!.versions[`card:${a}`]! },
        },
        pat,
      ),
      patch(
        boardId,
        b,
        {
          description: "B edited",
          ifMatchVersions: { [`card:${b}`]: before[1]!.versions[`card:${b}`]! },
        },
        pat,
      ),
    ]);
    expect(different.map((res) => res.status)).toEqual([200, 200]);
    expect(load).not.toHaveBeenCalled();

    const version = (await context(boardId, a, pat)).versions[`card:${a}`]!;
    const same = await Promise.all([
      patch(
        boardId,
        a,
        {
          description: "first",
          ifMatchVersions: { [`card:${a}`]: version },
        },
        pat,
      ),
      patch(
        boardId,
        a,
        {
          description: "second",
          ifMatchVersions: { [`card:${a}`]: version },
        },
        pat,
      ),
    ]);
    expect(same.map((res) => res.status).sort()).toEqual([200, 409]);
    const conflict = same.find((res) => res.status === 409)!;
    expect(conflict.body).toMatchObject({
      conflict: "version",
      versions: { [`card:${a}`]: expect.any(Number) },
    });
    const fresh = conflict.body.versions[`card:${a}`] as number;
    await patch(
      boardId,
      a,
      {
        description: "retried",
        ifMatchVersions: { [`card:${a}`]: fresh },
      },
      pat,
    ).expect(200);
    expect((await context(boardId, a, pat)).card.description).toBe("retried");
  });

  it("lets different cards move concurrently, conflicts on one card and logs one command each", async () => {
    const { boardId, todoId, doingId, pat } =
      await newBoard("Concurrent moves");
    const a = await card(boardId, "Move A");
    const b = await card(boardId, "Move B");
    const before = await Promise.all([
      context(boardId, a, pat),
      context(boardId, b, pat),
    ]);
    load.mockClear();

    const moved = await Promise.all([
      move(
        boardId,
        a,
        {
          toColumnId: doingId,
          ifMatchVersions: { [`card:${a}`]: before[0]!.versions[`card:${a}`]! },
        },
        pat,
      ),
      move(
        boardId,
        b,
        {
          toColumnId: doingId,
          ifMatchVersions: { [`card:${b}`]: before[1]!.versions[`card:${b}`]! },
        },
        pat,
      ),
    ]);
    expect(moved.map((res) => res.status)).toEqual([200, 200]);
    expect(load).not.toHaveBeenCalled();

    const version = (await context(boardId, a, pat)).versions[`card:${a}`]!;
    const same = await Promise.all([
      move(
        boardId,
        a,
        { toColumnId: todoId, ifMatchVersions: { [`card:${a}`]: version } },
        pat,
      ),
      move(
        boardId,
        a,
        { toColumnId: todoId, ifMatchVersions: { [`card:${a}`]: version } },
        pat,
      ),
    ]);
    expect(same.map((res) => res.status).sort()).toEqual([200, 409]);
    const conflict = same.find((res) => res.status === 409)!;
    expect(conflict.body).toMatchObject({
      conflict: "version",
      versions: { [`card:${a}`]: expect.any(Number) },
    });

    const log = await server()
      .get(`/api/v1/boards/${boardId}/commands?since=0`)
      .set(auth(pat))
      .expect(200);
    const moves = (
      log.body as Array<{ action: { type: string }; touches: string[] }>
    ).filter((entry) => entry.action.type === "MOVE_CARD");
    expect(moves).toHaveLength(3);
    expect(moves.at(-1)!.touches).toEqual(
      expect.arrayContaining([
        `card:${a}`,
        `column:${todoId}`,
        `column:${doingId}`,
      ]),
    );
  });

  it("replays exact claim, move and expectedDescription retries", async () => {
    const { boardId, todoId, doingId, pat } = await newBoard("Exact replay");
    const cardId = await card(boardId, "Replay card");

    const claimId = randomUUID();
    load.mockClear();
    const firstClaim = await claim(
      boardId,
      cardId,
      { leaseMs: 60_000 },
      pat,
      claimId,
    ).expect(200);
    expect(load).not.toHaveBeenCalled();
    const storedClaim = await prisma.commandDetail.findFirstOrThrow({
      where: { commandId: claimId },
      select: { data: true },
    });
    expect(
      (storedClaim.data as { intentFingerprint?: string }).intentFingerprint,
    ).toMatch(/^v2:/);
    // A foreign release must not change what the replayed command reports.
    await command(boardId, {
      type: "CLAIM_CARD",
      cardId,
      claimedBy: null,
      leaseUntil: null,
    }).expect(200);
    const replayClaim = await claim(
      boardId,
      cardId,
      { leaseMs: 60_000 },
      pat,
      claimId,
    ).expect(200);
    expect(replayClaim.body.seq).toBe(firstClaim.body.seq);
    expect(replayClaim.body.versions).toEqual(firstClaim.body.versions);
    expect(replayClaim.body.claimedBy).toBe(firstClaim.body.claimedBy);
    expect(replayClaim.body.leaseUntil).toBe(firstClaim.body.leaseUntil);

    // Version pins are preconditions, not intent: refreshing them on the
    // retry must not turn an exact replay into idempotency_conflict.
    const refreshedVersion = (await context(boardId, cardId, pat)).versions[
      `card:${cardId}`
    ]!;
    const pinnedReplay = await claim(
      boardId,
      cardId,
      {
        leaseMs: 60_000,
        ifMatchVersions: { [`card:${cardId}`]: refreshedVersion },
      },
      pat,
      claimId,
    ).expect(200);
    expect(pinnedReplay.body.seq).toBe(firstClaim.body.seq);

    // Presence-only differences are a different intent.
    const presenceClaim = await claim(
      boardId,
      cardId,
      { leaseMs: 60_000, release: false },
      pat,
      claimId,
    ).expect(409);
    expect(presenceClaim.body).toMatchObject({ code: "idempotency_conflict" });

    // The same `commandId` arriving while the first request is still in flight
    // must queue and read the stored result, not rebuild a different lease.
    const concurrentCard = await card(boardId, "Concurrent claim");
    const concurrentId = randomUUID();
    const originalApply = CommandsService.prototype.apply;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let applyCalls = 0;
    const applySpy = jest
      .spyOn(CommandsService.prototype, "apply")
      .mockImplementation(function (
        this: CommandsService,
        ...args: Parameters<CommandsService["apply"]>
      ) {
        applyCalls += 1;
        if (applyCalls === 1) {
          started();
          return gate.then(() => originalApply.apply(this, args));
        }
        return originalApply.apply(this, args);
      });
    let startedTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = Promise.resolve(
        claim(boardId, concurrentCard, { leaseMs: 60_000 }, pat, concurrentId),
      );
      await Promise.race([
        startedPromise,
        new Promise((_, reject) => {
          startedTimer = setTimeout(
            () => reject(new Error("first claim did not start")),
            5_000,
          );
        }),
      ]);
      clearTimeout(startedTimer);
      const second = claim(
        boardId,
        concurrentCard,
        { leaseMs: 60_000 },
        pat,
        concurrentId,
      );
      releaseFirst();
      const concurrent = await Promise.all([first, second]);
      expect(concurrent.map((res) => res.status)).toEqual([200, 200]);
      expect(concurrent[0]!.body.seq).toBe(concurrent[1]!.body.seq);
      expect(concurrent[0]!.body.versions).toEqual(
        concurrent[1]!.body.versions,
      );
      // The queued duplicate replayed; it did not enter CommandsService.
      expect(applyCalls).toBe(1);
    } finally {
      clearTimeout(startedTimer);
      releaseFirst();
      applySpy.mockRestore();
    }

    // A different intent under the same commandId is rejected, not replayed.
    const differentIntent = await claim(
      boardId,
      concurrentCard,
      { leaseMs: 120_000 },
      pat,
      concurrentId,
    ).expect(409);
    expect(differentIntent.body).toMatchObject({
      code: "idempotency_conflict",
    });

    // A command row written before the fingerprint deploy still replays for
    // the same actor/card/type (rolling-deploy bridge).
    const legacyCard = await card(boardId, "Pre-fingerprint row");
    const legacyId = randomUUID();
    await claim(boardId, legacyCard, { leaseMs: 60_000 }, pat, legacyId).expect(
      200,
    );
    await setIntentDetail(legacyId, boardId, {});
    await claim(boardId, legacyCard, { leaseMs: 60_000 }, pat, legacyId).expect(
      200,
    );
    // A fingerprint-less row still keeps the older semantic match: a release
    // is a different intent from the stored claim.
    const legacyDifferent = await claim(
      boardId,
      legacyCard,
      { release: true },
      pat,
      legacyId,
    ).expect(409);
    expect(legacyDifferent.body).toMatchObject({
      code: "idempotency_conflict",
    });
    const legacyLease = await claim(
      boardId,
      legacyCard,
      { leaseMs: 120_000 },
      pat,
      legacyId,
    ).expect(409);
    expect(legacyLease.body).toMatchObject({ code: "idempotency_conflict" });

    // The real predecessor (`2b175874`) stored the same hash JSON without the
    // `v2:` prefix; stripping the prefix reproduces that v1 row exactly.
    const v1Card = await card(boardId, "V1 fingerprint row");
    const v1Id = randomUUID();
    await claim(boardId, v1Card, { leaseMs: 60_000 }, pat, v1Id).expect(200);
    const v1Fingerprint = (await fingerprintOf(v1Id)).slice(3);
    await setIntentDetail(v1Id, boardId, { intentFingerprint: v1Fingerprint });
    await claim(boardId, v1Card, { leaseMs: 60_000 }, pat, v1Id).expect(200);
    const v1Different = await claim(
      boardId,
      v1Card,
      { leaseMs: 120_000 },
      pat,
      v1Id,
    ).expect(409);
    expect(v1Different.body).toMatchObject({ code: "idempotency_conflict" });

    // A v1 patch with expectedDescription replays exactly instead of falling
    // into the conservative fingerprint-less patch branch.
    const v1PatchCard = await card(boardId, "V1 patch");
    const v1PatchId = randomUUID();
    await patch(
      boardId,
      v1PatchCard,
      { description: "v1", expectedDescription: "" },
      pat,
      v1PatchId,
    ).expect(200);
    const v1PatchFingerprint = (await fingerprintOf(v1PatchId)).slice(3);
    await setIntentDetail(v1PatchId, boardId, { intentFingerprint: v1PatchFingerprint });
    await patch(
      boardId,
      v1PatchCard,
      { description: "v1", expectedDescription: "" },
      pat,
      v1PatchId,
    ).expect(200);

    // A v1 clamped move also replays: the hash contains the requested
    // position, not the clamped action index.
    const v1MoveCard = await card(boardId, "V1 clamped move");
    const v1MoveId = randomUUID();
    await move(
      boardId,
      v1MoveCard,
      { toColumnId: doingId, position: 99 },
      pat,
      v1MoveId,
    ).expect(200);
    const v1MoveFingerprint = (await fingerprintOf(v1MoveId)).slice(3);
    await setIntentDetail(v1MoveId, boardId, { intentFingerprint: v1MoveFingerprint });
    await move(
      boardId,
      v1MoveCard,
      { toColumnId: doingId, position: 99 },
      pat,
      v1MoveId,
    ).expect(200);

    const legacyMoveCard = await card(boardId, "Legacy move");
    const legacyMoveId = randomUUID();
    await move(
      boardId,
      legacyMoveCard,
      { toColumnId: doingId, position: 0 },
      pat,
      legacyMoveId,
    ).expect(200);
    await setIntentDetail(legacyMoveId, boardId, {});
    await move(
      boardId,
      legacyMoveCard,
      { toColumnId: doingId, position: 0 },
      pat,
      legacyMoveId,
    ).expect(200);
    // A fingerprint-less row cannot verify the requested position (the
    // action stored only the clamped index), so the destination-only semantic
    // match replays it. v1/v2 hashes above cover the position exactly.
    await move(
      boardId,
      legacyMoveCard,
      { toColumnId: doingId, position: 1 },
      pat,
      legacyMoveId,
    ).expect(200);

    const legacyPatchCard = await card(boardId, "Legacy patch");
    const legacyPatchId = randomUUID();
    await patch(
      boardId,
      legacyPatchCard,
      { description: "legacy", expectedDescription: "" },
      pat,
      legacyPatchId,
    ).expect(200);
    await setIntentDetail(legacyPatchId, boardId, {});
    // A legacy row cannot prove the old expectedDescription; refuse rather
    // than replay the compare-and-set unsafely.
    await patch(
      boardId,
      legacyPatchCard,
      { description: "legacy", expectedDescription: "" },
      pat,
      legacyPatchId,
    ).expect(409);
    await patch(
      boardId,
      legacyPatchCard,
      { description: "legacy" },
      pat,
      legacyPatchId,
    ).expect(200);

    // A replay after the card was deleted still returns the stored result;
    // the optional card is omitted instead of turning the replay into 404.
    const deletedCard = await card(boardId, "Deleted replay");
    const deletedClaimId = randomUUID();
    const deletedFirst = await claim(
      boardId,
      deletedCard,
      { leaseMs: 60_000 },
      pat,
      deletedClaimId,
    ).expect(200);
    await command(boardId, {
      type: "DELETE_CARD",
      cardId: deletedCard,
    }).expect(200);
    const deletedReplay = await claim(
      boardId,
      deletedCard,
      { leaseMs: 60_000 },
      pat,
      deletedClaimId,
    ).expect(200);
    expect(deletedReplay.body.seq).toBe(deletedFirst.body.seq);
    expect(deletedReplay.body).not.toHaveProperty("card");

    const moveId = randomUUID();
    const firstMove = await move(
      boardId,
      cardId,
      { toColumnId: doingId },
      pat,
      moveId,
    ).expect(200);
    const replayMove = await move(
      boardId,
      cardId,
      { toColumnId: doingId },
      pat,
      moveId,
    ).expect(200);
    expect(replayMove.body.seq).toBe(firstMove.body.seq);
    expect(replayMove.body.versions).toEqual(firstMove.body.versions);
    const differentMove = await move(
      boardId,
      cardId,
      { toColumnId: todoId },
      pat,
      moveId,
    ).expect(409);
    expect(differentMove.body).toMatchObject({ code: "idempotency_conflict" });
    const differentPosition = await move(
      boardId,
      cardId,
      { toColumnId: doingId, position: 1 },
      pat,
      moveId,
    ).expect(409);
    expect(differentPosition.body).toMatchObject({
      code: "idempotency_conflict",
    });
    const presenceMove = await move(
      boardId,
      cardId,
      { toColumnId: doingId, position: 0 },
      pat,
      moveId,
    ).expect(409);
    expect(presenceMove.body).toMatchObject({ code: "idempotency_conflict" });

    const patchId = randomUUID();
    const firstPatch = await patch(
      boardId,
      cardId,
      { description: "mine", expectedDescription: "" },
      pat,
      patchId,
    ).expect(200);
    // A foreign edit after the first patch must not turn the exact retry into
    // a version conflict: the stored command wins.
    await command(boardId, {
      type: "UPDATE_CARD",
      cardId,
      description: "foreign",
    }).expect(200);
    const replayPatch = await patch(
      boardId,
      cardId,
      { description: "mine", expectedDescription: "" },
      pat,
      patchId,
    ).expect(200);
    expect(replayPatch.body.seq).toBe(firstPatch.body.seq);
    expect(replayPatch.body.versions).toEqual(firstPatch.body.versions);
    const differentPatch = await patch(
      boardId,
      cardId,
      { description: "another" },
      pat,
      patchId,
    ).expect(409);
    expect(differentPatch.body).toMatchObject({
      code: "idempotency_conflict",
    });
    const presencePatch = await patch(
      boardId,
      cardId,
      { description: "mine", expectedDescription: "", title: "Replay card" },
      pat,
      patchId,
    ).expect(409);
    expect(presencePatch.body).toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("enforces WIP and workflow on targeted moves", async () => {
    const { boardId, todoId, doingId, pat } =
      await newBoard("WIP and workflow");
    const full = await card(boardId, "Full");
    await command(boardId, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: doingId,
      wipLimit: 1,
    }).expect(200);
    await move(boardId, full, { toColumnId: doingId }, pat).expect(200);
    const extra = await card(boardId, "Extra");
    const wip = await move(boardId, extra, { toColumnId: doingId }, pat).expect(
      409,
    );
    expect(wip.body).toMatchObject({ conflict: "wip", columnId: doingId });

    // Human session setup: clearing WIP and enabling a workflow is not an
    // agent move and must not need an approval of its own.
    await command(boardId, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId: doingId,
      wipLimit: null,
    }).expect(200);
    await command(boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow: {
        schemaVersion: 1,
        enabled: true,
        doneColumnIds: [doingId],
        transitions: [
          {
            id: randomUUID(),
            fromColumnId: todoId,
            toColumnId: doingId,
            allowedRoles: ["ADMIN", "MEMBER"],
          },
        ],
      },
    }).expect(200);
    await move(boardId, extra, { toColumnId: doingId }, pat).expect(200);
    const workflow = await move(
      boardId,
      extra,
      { toColumnId: todoId },
      pat,
    ).expect(409);
    expect(workflow.body).toMatchObject({
      conflict: "workflow",
      workflow: { code: "transition_not_allowed" },
    });
  });

  it("keeps the move-to-done approval gate and records the run preimage", async () => {
    const { boardId, todoId, doingId } = await newBoard("Approval gate");
    await command(boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow: {
        schemaVersion: 1,
        enabled: true,
        doneColumnIds: [doingId],
        transitions: [
          {
            id: randomUUID(),
            fromColumnId: todoId,
            toColumnId: doingId,
            allowedRoles: ["ADMIN", "MEMBER"],
          },
        ],
      },
    }).expect(200);
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentPolicy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          requireApprovalFor: ["move_to_done"],
        } as never,
      },
    });
    // The PAT is created after the human setup; it is the agent under test.
    const pat = await createPat(boardId);
    const cardId = await card(boardId, "Needs approval");
    const commandId = randomUUID();
    const refused = await move(
      boardId,
      cardId,
      { toColumnId: doingId },
      pat,
      commandId,
    ).expect(409);
    expect(refused.body).toMatchObject({
      code: "approval_required",
      approvalId: expect.any(String),
      planHash: expect.any(String),
    });
    // Unrelated cards change both source/destination indexes while the human
    // decision is pending. The approval authorizes the destination intent,
    // not the server-resolved positions, so the retry must still apply.
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: randomUUID(),
      columnId: todoId,
      title: "Source drift",
    }).expect(200);
    await command(boardId, {
      type: "ADD_CARD",
      newCardId: randomUUID(),
      columnId: doingId,
      title: "Destination drift",
    }).expect(200);
    await server()
      .post(
        `/api/v1/boards/${boardId}/approvals/${refused.body.approvalId}/decision`,
      )
      .set(auth(session))
      .send({ decision: "approve", planHash: refused.body.planHash })
      .expect(200);

    const applied = await move(
      boardId,
      cardId,
      { toColumnId: doingId },
      pat,
      commandId,
      refused.body.approvalId,
    ).expect(200);
    expect(applied.body.columnId).toBe(doingId);
    const preimage = await prisma.commandPreimage.findFirstOrThrow({
      where: { commandId },
    });
    expect(preimage.runId).not.toBeNull();
    expect(
      await prisma.agentRun.count({ where: { id: preimage.runId! } }),
    ).toBe(1);
  });

  it("refuses observers, honours board pause and isolates another board's card", async () => {
    const first = await newBoard("Access board");
    const cardId = await card(first.boardId, "Access card");
    const observer = await createPat(first.boardId, "observer");
    const observerMove = await move(
      first.boardId,
      cardId,
      { toColumnId: first.doingId },
      observer,
    ).expect(403);
    expect(observerMove.body).toMatchObject({
      code: "scope_denied",
      effectiveTokenScope: "observer",
    });

    // A VIEWER may read the targeted context but cannot use a write intent.
    await joinBoard(first.boardId, "VIEWER");
    const viewerPat = await createPat(first.boardId, "worker", memberSession);
    await context(first.boardId, cardId, viewerPat);
    const viewerMove = await move(
      first.boardId,
      cardId,
      { toColumnId: first.doingId },
      viewerPat,
    ).expect(403);
    expect(viewerMove.body).toMatchObject({ code: "scope_denied" });

    const other = await newBoard("Other board");
    const otherCard = await card(other.boardId, "Other card");
    await move(
      first.boardId,
      otherCard,
      { toColumnId: first.doingId },
      first.pat,
    ).expect(404);

    // A destination id from another board is a 404 and must never reach the
    // card-index query: the loader drops columns not loaded for the route
    // board, and the SQL is additionally scoped by `column.boardId`.
    const cardFindMany = jest.spyOn(prisma.card, "findMany");
    try {
      await move(
        first.boardId,
        cardId,
        { toColumnId: other.doingId },
        first.pat,
      ).expect(404);
      const foreignReads = cardFindMany.mock.calls.filter(([args]) => {
        const where = (args as { where?: { columnId?: { in?: string[] } } })
          ?.where;
        return where?.columnId?.in?.includes(other.doingId) === true;
      });
      expect(foreignReads).toHaveLength(0);
    } finally {
      cardFindMany.mockRestore();
    }

    await prisma.board.update({
      where: { id: first.boardId },
      data: {
        agentsPausedAt: new Date(),
        agentsPausedBy: "test",
        agentsPauseReason: "review pause",
      },
    });
    try {
      const paused = await move(
        first.boardId,
        cardId,
        { toColumnId: first.doingId },
        first.pat,
      ).expect(403);
      expect(paused.body).toMatchObject({ code: "agent_paused" });
    } finally {
      await prisma.board.update({
        where: { id: first.boardId },
        data: {
          agentsPausedAt: null,
          agentsPausedBy: null,
          agentsPauseReason: null,
        },
      });
    }
  });

  it("refuses archived moves and another member's live release", async () => {
    const { boardId, doingId, pat } = await newBoard("Archived and release");
    const archived = await card(boardId, "Archived");
    await command(boardId, { type: "ARCHIVE_CARD", cardId: archived }).expect(
      200,
    );
    const archivedMove = await move(
      boardId,
      archived,
      { toColumnId: doingId },
      pat,
    ).expect(400);
    expect(archivedMove.body.message).toMatch(/archived/i);

    await joinBoard(boardId);
    const memberPat = await createPat(boardId, "worker", memberSession);
    const claimed = await card(boardId, "Owned claim");
    const sharedClaimId = randomUUID();
    await claim(
      boardId,
      claimed,
      { leaseMs: 60_000 },
      pat,
      sharedClaimId,
    ).expect(200);
    // Another authenticated actor cannot replay this command id and read the
    // first holder's result.
    const crossActor = await claim(
      boardId,
      claimed,
      { leaseMs: 60_000 },
      memberPat,
      sharedClaimId,
    ).expect(409);
    expect(crossActor.body).toMatchObject({ code: "idempotency_conflict" });
    const release = await claim(
      boardId,
      claimed,
      { release: true },
      memberPat,
    ).expect(400);
    expect(release.body.message).toMatch(/claimed by another member/i);

    await claim(boardId, claimed, { release: true }, pat).expect(200);
    await claim(boardId, claimed, { leaseMs: 60_000 }, memberPat).expect(200);
    await claim(boardId, claimed, { release: true }, memberPat).expect(200);
  });

  it("keeps explicit ifMatch = seq mode and rejects nulls as validation errors", async () => {
    const { boardId, doingId, pat } = await newBoard("Explicit mode");
    const cardId = await card(boardId, "Sequenced");
    const contextResponse = await server()
      .get(`/api/v1/boards/${boardId}/cards/${cardId}/context`)
      .set(auth(pat))
      .expect(200);
    expect(contextResponse.headers["x-janosik-intent-api"]).toBe("1");
    const missingContext = await server()
      .get(`/api/v1/boards/${boardId}/cards/missing/context`)
      .set(auth(pat))
      .expect(404);
    expect(missingContext.headers["x-janosik-intent-api"]).toBe("1");
    expect(missingContext.headers["x-request-id"]).toEqual(expect.any(String));
    expect(missingContext.body).toMatchObject({
      code: "not_found",
      retryable: false,
      requestId: missingContext.headers["x-request-id"],
      currentVersion: null,
    });
    const snapshot = await context(boardId, cardId, pat);

    await patch(
      boardId,
      cardId,
      {
        description: "pinned",
        ifMatch: snapshot.seq,
      },
      pat,
    ).expect(200);
    const stale = await patch(
      boardId,
      cardId,
      { description: "stale", ifMatch: 0 },
      pat,
    ).expect(409);
    expect(stale.body).toMatchObject({ conflict: "version" });

    // An empty or partial map still pins the card version the intent read;
    // the caller's extra/override keys are merged on top.
    await patch(
      boardId,
      cardId,
      { description: "empty pins", ifMatchVersions: {} },
      pat,
    ).expect(200);
    const pinContext = await context(boardId, cardId, pat);
    const columnKey = `column:${pinContext.columnId}`;
    await patch(
      boardId,
      cardId,
      {
        description: "partial pins",
        ifMatchVersions: { [columnKey]: pinContext.versions[columnKey]! },
      },
      pat,
    ).expect(200);

    await move(
      boardId,
      cardId,
      { toColumnId: doingId, position: null },
      pat,
    ).expect(400);
    await patch(
      boardId,
      cardId,
      { description: "x", expectedDescription: null },
      pat,
    ).expect(400);
    await patch(
      boardId,
      cardId,
      { description: "x", ifMatch: null },
      pat,
    ).expect(400);
    await claim(boardId, cardId, { leaseMs: null }, pat).expect(400);
  });
});
