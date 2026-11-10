import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type {
  Board,
  CreateUserTokenResponse,
  PlanApplyResponse,
  PlanPreviewDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "agent-approval-security@example.com";
const PASSWORD = "correct horse battery";

interface PlanCommand {
  commandId: string;
  action: Record<string, unknown>;
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
}

/**
 * TASK-166.12 — contract/security suite (part 2: approval exactness, atomic
 * plan apply, conflicts and concurrency).
 *
 * These are the paths where a denial must leave *nothing* behind: an approval
 * is bound to one board, one canonical plan and one token; a plan apply is one
 * board-locked all-or-nothing transaction; two writers with the same
 * precondition produce one winner and one `version_conflict`.
 */
describe("Agent approval and plan security (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerSession: string;
  let workerToken: string;

  beforeAll(async () => {
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    // Concurrency tests fire two real HTTP requests at once; a listening
    // server keeps supertest from closing the socket between them.
    await app.listen(0);
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    ownerSession = registered.body.accessToken as string;
    workerToken = (
      await server()
        .post("/api/v1/users/me/tokens")
        .set(auth(ownerSession))
        .send({
          name: "approval-security-worker",
          expiresAt: null,
          scopePreset: "worker",
          trustedCi: false,
        })
        .expect(201)
        .then((res) => res.body as CreateUserTokenResponse)
    ).token;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(ownerSession))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function createColumn(
    boardId: string,
    title = "Todo",
  ): Promise<string> {
    const columnId = randomUUID();
    await command(ownerSession, boardId, {
      type: "ADD_COLUMN",
      newColumnId: columnId,
      title,
    }).then((res) => expect(res.status).toBe(200));
    return columnId;
  }

  async function createCard(
    boardId: string,
    columnId: string,
    title = "Card",
  ): Promise<string> {
    const cardId = randomUUID();
    await command(ownerSession, boardId, {
      type: "ADD_CARD",
      newCardId: cardId,
      columnId,
      title,
    }).then((res) => expect(res.status).toBe(200));
    return cardId;
  }

  function command(
    token: string,
    boardId: string,
    action: Record<string, unknown>,
    options: { approvalId?: string; commandId?: string } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .set(
        options.approvalId === undefined
          ? {}
          : { "X-Approval-Id": options.approvalId },
      )
      .send({
        commandId: options.commandId ?? randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
  }

  async function aggregate(boardId: string): Promise<Board> {
    return server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as Board);
  }

  function planCommand(
    action: Record<string, unknown>,
    commandId = randomUUID(),
    precondition: { ifMatch?: number } = {},
  ): PlanCommand {
    return {
      commandId,
      action,
      ...(precondition.ifMatch !== undefined
        ? { ifMatch: precondition.ifMatch }
        : {}),
    };
  }

  function preview(
    boardId: string,
    commands: PlanCommand[],
    token = workerToken,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/plans`)
      .set(auth(token))
      .send({ commands });
  }

  function applyPlan(
    boardId: string,
    commands: PlanCommand[],
    planHash: string,
    options: { token?: string; approvalId?: string; clientRunId?: string } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/plans/apply`)
      .set(auth(options.token ?? workerToken))
      .set(
        options.approvalId === undefined
          ? {}
          : { "X-Approval-Id": options.approvalId },
      )
      .send({
        commands,
        planHash,
        ...(options.clientRunId !== undefined
          ? { clientRunId: options.clientRunId }
          : {}),
      });
  }

  function decide(boardId: string, approvalId: string, planHash: string) {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals/${approvalId}/decision`)
      .set(auth(ownerSession))
      .send({ decision: "approve", planHash });
  }

  async function requestDeleteApproval(
    boardId: string,
    cardId: string,
  ): Promise<{
    commands: PlanCommand[];
    planHash: string;
    approvalId: string;
  }> {
    const commands = [planCommand({ type: "DELETE_CARD", cardId })];
    const previewBody = (await preview(boardId, commands).expect(200))
      .body as PlanPreviewDto;
    const refused = await applyPlan(boardId, commands, previewBody.planHash);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "approval_required",
      approvalId: expect.any(String),
      planHash: previewBody.planHash,
      expiresAt: expect.any(Number),
    });
    return {
      commands,
      planHash: previewBody.planHash,
      approvalId: refused.body.approvalId as string,
    };
  }

  it("binds an approval to its board and exact plan, consumes it once and refuses a replay decision", async () => {
    const boardId = await createBoard("Approval exactness");
    const columnId = await createColumn(boardId);
    const cardA = await createCard(boardId, columnId, "Card A");
    const cardB = await createCard(boardId, columnId, "Card B");
    const request = await requestDeleteApproval(boardId, cardA);
    await decide(boardId, request.approvalId, request.planHash).expect(200);

    // Same approval, different plan on the same board: hash mismatch, both
    // cards stay alive, and the approval is not consumed.
    const otherCommands = [planCommand({ type: "DELETE_CARD", cardId: cardB })];
    const otherPreview = (await preview(boardId, otherCommands).expect(200))
      .body as PlanPreviewDto;
    const wrongPlan = await applyPlan(
      boardId,
      otherCommands,
      otherPreview.planHash,
      { approvalId: request.approvalId },
    );
    expect(wrongPlan.status).toBe(409);
    expect(wrongPlan.body).toMatchObject({
      code: "approval_mismatch",
      approvalId: request.approvalId,
      retryable: false,
    });
    expect(
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.approvalId },
      }),
    ).toMatchObject({ status: "approved", runId: null });
    expect((await aggregate(boardId)).cards[cardA]?.title).toBe("Card A");
    expect((await aggregate(boardId)).cards[cardB]?.title).toBe("Card B");

    // Same approval id sent to another board: it is simply not that board's
    // approval, and nothing is applied there.
    const foreignBoard = await createBoard("Foreign approval board");
    const foreignColumn = await createColumn(foreignBoard);
    const foreignCard = await createCard(
      foreignBoard,
      foreignColumn,
      "Foreign card",
    );
    const foreignCommands = [
      planCommand({ type: "DELETE_CARD", cardId: foreignCard }),
    ];
    const foreignPreview = (
      await preview(foreignBoard, foreignCommands).expect(200)
    ).body as PlanPreviewDto;
    const foreignUse = await applyPlan(
      foreignBoard,
      foreignCommands,
      foreignPreview.planHash,
      { approvalId: request.approvalId },
    );
    expect(foreignUse.status).toBe(404);
    expect(foreignUse.body.code).toBe("not_found");
    expect((await aggregate(foreignBoard)).cards[foreignCard]?.title).toBe(
      "Foreign card",
    );

    const runsBefore = await prisma.agentRun.count({ where: { boardId } });
    const applied = await applyPlan(
      boardId,
      request.commands,
      request.planHash,
      {
        approvalId: request.approvalId,
      },
    ).expect(200);
    const appliedBody = applied.body as PlanApplyResponse;
    expect(appliedBody.runId).toEqual(expect.any(String));
    expect((await aggregate(boardId)).cards[cardA]).toBeUndefined();
    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: request.approvalId },
    });
    expect(row).toMatchObject({
      status: "consumed",
      runId: appliedBody.runId,
    });
    expect(row.consumedAt).not.toBeNull();
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore + 1,
    );

    const laterDecision = await decide(
      boardId,
      request.approvalId,
      request.planHash,
    );
    expect(laterDecision.status).toBe(409);
    expect(laterDecision.body).toMatchObject({
      code: "approval_not_pending",
      approvalId: request.approvalId,
      status: "consumed",
    });
  });

  it("refuses an approval that expired after it was approved, applying nothing", async () => {
    const boardId = await createBoard("Approval expiry");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Expiry card");
    const request = await requestDeleteApproval(boardId, cardId);
    await decide(boardId, request.approvalId, request.planHash).expect(200);

    await prisma.approvalRequest.update({
      where: { id: request.approvalId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const runsBefore = await prisma.agentRun.count({ where: { boardId } });
    const commandsBefore = await prisma.command.count({ where: { boardId } });
    const expired = await applyPlan(
      boardId,
      request.commands,
      request.planHash,
      {
        approvalId: request.approvalId,
      },
    );
    expect(expired.status).toBe(409);
    expect(expired.body).toMatchObject({
      code: "approval_expired",
      approvalId: request.approvalId,
      expiresAt: expect.any(Number),
      retryable: false,
      requestId: expired.headers["x-request-id"],
    });
    expect(
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.approvalId },
      }),
    ).toMatchObject({ status: "expired", runId: null });
    expect((await aggregate(boardId)).cards[cardId]?.title).toBe("Expiry card");
    expect(
      await prisma.command.count({
        where: { id: request.commands[0]!.commandId },
      }),
    ).toBe(0);
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore,
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );
  });

  it("covers canonical commands with planHash and rejects a changed command or commandId", async () => {
    const boardId = await createBoard("Plan hash");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Hash base");
    const commands = [
      planCommand({ type: "UPDATE_CARD", cardId, title: "Canonical" }),
      planCommand({ type: "SET_CARD_PRIORITY", cardId, priority: "high" }),
    ];
    const attentionBefore = await prisma.attentionNotification.count({
      where: { boardId },
    });
    const previewBody = (await preview(boardId, commands).expect(200))
      .body as PlanPreviewDto;
    expect(
      await prisma.attentionNotification.count({ where: { boardId } }),
    ).toBe(attentionBefore);
    const commandsBefore = await prisma.command.count({ where: { boardId } });
    const runsBefore = await prisma.agentRun.count({ where: { boardId } });

    const tamperedTitle = commands.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            action: {
              ...entry.action,
              title: "Tampered",
            },
          }
        : entry,
    );
    const changedTitle = await applyPlan(
      boardId,
      tamperedTitle,
      previewBody.planHash,
    );
    expect(changedTitle.status).toBe(409);
    expect(changedTitle.body).toMatchObject({
      code: "approval_mismatch",
      expectedPlanHash: expect.any(String),
      actualPlanHash: previewBody.planHash.slice(0, 12),
    });
    expect(changedTitle.body.expectedPlanHash).not.toBe(
      previewBody.planHash.slice(0, 12),
    );
    const afterRejectedTitle = (await aggregate(boardId)).cards[cardId];
    expect(afterRejectedTitle?.title).toBe("Hash base");
    expect(afterRejectedTitle?.priority).toBeUndefined();

    const changedCommandId = commands.map((entry, index) =>
      index === 0 ? { ...entry, commandId: randomUUID() } : entry,
    );
    const changedId = await applyPlan(
      boardId,
      changedCommandId,
      previewBody.planHash,
    );
    expect(changedId.status).toBe(409);
    expect(changedId.body.code).toBe("approval_mismatch");
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore,
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );

    // `action.at` is not part of the canonical plan: a fresh client clock with
    // the preview hash applies the exact plan and creates one run.
    const clocked = commands.map((entry) => ({
      ...entry,
      action: { ...entry.action, at: Date.now() + 1_000 },
    }));
    const applied = await applyPlan(
      boardId,
      clocked,
      previewBody.planHash,
    ).expect(200);
    expect((applied.body as PlanApplyResponse).runId).toEqual(
      expect.any(String),
    );
    expect((await aggregate(boardId)).cards[cardId]).toMatchObject({
      title: "Canonical",
      priority: "high",
    });
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore + 1,
    );
  });

  it("enforces preview conflicts on apply and rolls the whole plan back", async () => {
    const boardId = await createBoard("Plan conflicts");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Conflict base");
    const seq = Number(
      (
        await server()
          .get(`/api/v1/boards/${boardId}`)
          .set(auth(ownerSession))
          .expect(200)
      ).headers["x-board-seq"],
    );

    // First command is valid; the second has a stale precondition. The preview
    // reports it as advisory, apply must roll the first one back.
    const commands = [
      planCommand({ type: "UPDATE_CARD", cardId, title: "Rolled back" }),
      planCommand(
        { type: "UPDATE_CARD", cardId, description: "Also rolled back" },
        randomUUID(),
        { ifMatch: seq + 100 },
      ),
    ];
    const previewBody = (await preview(boardId, commands).expect(200))
      .body as PlanPreviewDto;
    expect(previewBody.canApply).toBe(false);
    expect(previewBody.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "version" })]),
    );
    const commandsBefore = await prisma.command.count({ where: { boardId } });
    const runsBefore = await prisma.agentRun.count({ where: { boardId } });
    const refused = await applyPlan(boardId, commands, previewBody.planHash);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("version_conflict");
    const rolledBack = (await aggregate(boardId)).cards[cardId];
    expect(rolledBack?.title).toBe("Conflict base");
    expect(rolledBack?.description).toBeUndefined();
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore,
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );

    // WIP is advisory in preview and enforced by apply.
    await command(ownerSession, boardId, {
      type: "SET_COLUMN_WIP_LIMIT",
      columnId,
      wipLimit: 1,
    }).then((response) => expect(response.status).toBe(200));
    const newCardId = randomUUID();
    const wipCommands = [
      planCommand({
        type: "ADD_CARD",
        newCardId,
        columnId,
        title: "Over WIP",
      }),
    ];
    const wipPreview = (await preview(boardId, wipCommands).expect(200))
      .body as PlanPreviewDto;
    expect(wipPreview.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "wip" })]),
    );
    const wipApply = await applyPlan(boardId, wipCommands, wipPreview.planHash);
    expect(wipApply.status).toBe(409);
    expect(wipApply.body).toMatchObject({
      code: "limit_exceeded",
      conflict: "wip",
    });
    expect(await prisma.card.count({ where: { id: newCardId } })).toBe(0);
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore + 1, // only the WIP-limit command itself
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );
  });

  it("lets one of two parallel writers with the same ifMatch win and leaves one version conflict", async () => {
    const boardId = await createBoard("Write race");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Race base");
    const seq = Number(
      (
        await server()
          .get(`/api/v1/boards/${boardId}`)
          .set(auth(ownerSession))
          .expect(200)
      ).headers["x-board-seq"],
    );
    const commandsBefore = await prisma.command.count({ where: { boardId } });
    const writes = ["Race left", "Race right"].map((title) => {
      const commandId = randomUUID();
      return {
        commandId,
        title,
        response: server()
          .post(`/api/v1/boards/${boardId}/commands`)
          .set(auth(ownerSession))
          .send({
            commandId,
            ifMatch: seq,
            action: {
              boardId,
              at: Date.now(),
              type: "UPDATE_CARD",
              cardId,
              title,
            },
          }),
      };
    });

    const responses = await Promise.all(writes.map((write) => write.response));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winnerIndex = responses.findIndex(
      (response) => response.status === 200,
    );
    const loserIndex = responses.findIndex(
      (response) => response.status === 409,
    );
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(responses[loserIndex]!.body).toMatchObject({
      code: "version_conflict",
      conflict: "version",
      retryable: false,
      requestId: responses[loserIndex]!.headers["x-request-id"],
    });
    expect(responses[loserIndex]!.body.currentVersion).toBeGreaterThanOrEqual(
      seq + 1,
    );
    expect((await aggregate(boardId)).cards[cardId]?.title).toBe(
      writes[winnerIndex]!.title,
    );
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsBefore + 1,
    );
    expect(
      await prisma.command.count({
        where: { id: writes[loserIndex]!.commandId },
      }),
    ).toBe(0);
  });

  it("applies one approved plan concurrently as one run and one command set", async () => {
    const boardId = await createBoard("Approval race");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Race delete");
    const request = await requestDeleteApproval(boardId, cardId);
    await decide(boardId, request.approvalId, request.planHash).expect(200);

    const runsBefore = await prisma.agentRun.count({ where: { boardId } });
    const results = await Promise.all([
      applyPlan(boardId, request.commands, request.planHash, {
        approvalId: request.approvalId,
      }),
      applyPlan(boardId, request.commands, request.planHash, {
        approvalId: request.approvalId,
      }),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    const runIds = results.map(
      (response) => (response.body as PlanApplyResponse).runId,
    );
    expect(new Set(runIds).size).toBe(1);
    expect(runIds[0]).toEqual(expect.any(String));
    expect((await aggregate(boardId)).cards[cardId]).toBeUndefined();
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore + 1,
    );
    expect(
      await prisma.command.count({
        where: { id: request.commands[0]!.commandId },
      }),
    ).toBe(1);
    expect(
      await prisma.commandPreimage.count({
        where: { runId: runIds[0] },
      }),
    ).toBe(1);
    expect(
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.approvalId },
      }),
    ).toMatchObject({
      status: "consumed",
      runId: runIds[0],
    });
    expect(
      await prisma.activity.count({
        where: { boardId, type: "approval_consumed" },
      }),
    ).toBe(1);
  });
});
