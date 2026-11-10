import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type {
  Board,
  CreateUserTokenResponse,
  PlanApplyResponse,
  PlanPreviewDto,
  RunDetailDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DEFAULT_BOARD_AGENT_POLICY } from "@/auth/token-scope";
import { stripAttribution } from "./support/attribution";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "plans-owner@example.com";
const MEMBER_EMAIL = "plans-member@example.com";
const VIEWER_EMAIL = "plans-viewer@example.com";
const PASSWORD = "correct horse battery";

interface PlanCommand {
  commandId: string;
  action: Record<string, unknown>;
  ifMatch?: number;
  ifMatchVersions?: Record<string, number>;
}

/**
 * TASK-166.8 — plan preview and atomic apply over REST.
 *
 * The suite pins the dry-run contract (no writes, no run, no approval), the
 * required planHash and its canonical form, the per-plan limits, the approval
 * seam and its one-time consumption, the `kind: "plan"` run with rollback,
 * and the browser/PAT boundary.
 */
describe("Plans and apply (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerSession: string;
  let memberSession: string;
  let viewerSession: string;
  let boardId: string;
  let workerToken: string;
  let observerToken: string;
  let trustedToken: string;

  beforeAll(async () => {
    // The limit tests create many commands; rate limiting is another suite.
    ThrottlerGuard.prototype.canActivate = function canActivate() {
      return Promise.resolve(true);
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const owner = await register(OWNER_EMAIL, "Owner");
    ownerSession = owner.accessToken;
    boardId = await createBoard("Plans board");

    const member = await register(MEMBER_EMAIL, "Member");
    memberSession = member.accessToken;
    await invite(MEMBER_EMAIL, "MEMBER");
    await acceptInvitation(memberSession);

    const viewer = await register(VIEWER_EMAIL, "Viewer");
    viewerSession = viewer.accessToken;
    await invite(VIEWER_EMAIL, "VIEWER");
    await acceptInvitation(viewerSession);

    workerToken = (await createToken("plans-worker", "worker")).token;
    observerToken = (await createToken("plans-observer", "observer")).token;
    trustedToken = (await createToken("plans-trusted", "worker", true)).token;
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
    scopePreset: "worker" | "observer" | "reviewer" | "admin",
    trustedCi = false,
  ): Promise<CreateUserTokenResponse> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerSession))
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

  async function createColumn(
    title = "Todo",
    board = boardId,
  ): Promise<string> {
    const columnId = randomUUID();
    await command(
      "ADD_COLUMN",
      { newColumnId: columnId, title },
      { board },
    ).expect(200);
    return columnId;
  }

  async function createCard(
    columnId: string,
    title = "Card",
    board = boardId,
  ): Promise<string> {
    const cardId = randomUUID();
    await command(
      "ADD_CARD",
      { newCardId: cardId, columnId, title },
      { board },
    ).expect(200);
    return cardId;
  }

  async function aggregate(board = boardId): Promise<Board> {
    return server()
      .get(`/api/v1/boards/${board}`)
      .set(auth(ownerSession))
      .expect(200)
      .then((res) => res.body as Board);
  }

  function preview(
    commands: PlanCommand[],
    token = workerToken,
    board = boardId,
  ) {
    return server()
      .post(`/api/v1/boards/${board}/plans`)
      .set(auth(token))
      .send({ commands });
  }

  function applyPlan(
    commands: PlanCommand[],
    planHash: string,
    options: {
      token?: string;
      board?: string;
      approvalId?: string;
      clientRunId?: string;
    } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${options.board ?? boardId}/plans/apply`)
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

  function decide(approvalId: string, planHash: string, decision = "approve") {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals/${approvalId}/decision`)
      .set(auth(ownerSession))
      .send({ decision, planHash });
  }

  async function counts(board = boardId) {
    const [commands, runs, approvals] = await Promise.all([
      prisma.command.count({ where: { boardId: board } }),
      prisma.agentRun.count({ where: { boardId: board } }),
      prisma.approvalRequest.count({ where: { boardId: board } }),
    ]);
    return { commands, runs, approvals };
  }

  async function snapshot(board = boardId) {
    return {
      ...(await counts(board)),
      board: stripAttribution(await aggregate(board)),
    };
  }

  function planCommand(
    action: Record<string, unknown>,
    commandId = randomUUID(),
  ): PlanCommand {
    return { commandId, action };
  }

  it("previews a plan without writing, creating a run or an approval", async () => {
    const columnId = await createColumn("Preview");
    const cardId = await createCard(columnId, "Editable");
    const newCardId = randomUUID();
    const commands: PlanCommand[] = [
      planCommand({
        type: "ADD_CARD",
        newCardId,
        columnId,
        title: "Bulk card",
      }),
      planCommand({ type: "UPDATE_CARD", cardId, title: "Edited" }),
      planCommand({ type: "SET_CARD_PRIORITY", cardId, priority: "high" }),
    ];
    const before = await snapshot();

    const response = await preview(commands).expect(200);
    const body = response.body as PlanPreviewDto;
    expect(body).toMatchObject({
      dryRun: true,
      schemaVersion: 1,
      boardId,
      commandCount: 3,
      cardCreates: 1,
      limits: { commands: 100, cards: 50 },
      canApply: true,
      conflicts: [],
    });
    expect(body.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.requirement).toMatchObject({
      kind: "custom",
      requiresApproval: false,
      requiredScope: "worker",
    });
    expect(body.plan.commands).toHaveLength(3);
    expect(body.plan.commands?.[0]?.action).not.toHaveProperty("at");
    expect(body.plan.commands?.[0]?.action).not.toHaveProperty("boardId");
    expect(body.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          touch: `card:${newCardId}`,
          kind: "create",
        }),
        expect.objectContaining({
          touch: `card:${cardId}`,
          kind: "update",
        }),
      ]),
    );

    // Nothing changed: no command row, no run, no approval, same aggregate.
    expect(await snapshot()).toEqual(before);

    // The hash excludes `at`: repeating a preview with the canonical plan
    // (or a fresh client clock) produces the same hash.
    const canonical = body.plan.commands as PlanCommand[];
    const second = await preview(canonical).expect(200);
    expect((second.body as PlanPreviewDto).planHash).toBe(body.planHash);
    const clocked = canonical.map((entry) => ({
      ...entry,
      action: { ...entry.action, at: Date.now() + 1 },
    }));
    const third = await preview(clocked).expect(200);
    expect((third.body as PlanPreviewDto).planHash).toBe(body.planHash);
  });

  it("requires the preview hash on apply and creates one kind:plan run", async () => {
    const columnId = await createColumn("Apply");
    const cardId = await createCard(columnId, "Before");
    const commands: PlanCommand[] = [
      planCommand({ type: "UPDATE_CARD", cardId, title: "After" }),
      planCommand({ type: "SET_CARD_PRIORITY", cardId, priority: "high" }),
    ];
    const previewBody = (await preview(commands).expect(200))
      .body as PlanPreviewDto;
    const runsBefore = await prisma.agentRun.count({ where: { boardId } });

    const mismatch = await applyPlan(commands, "a".repeat(64)).expect(409);
    expect(mismatch.body).toMatchObject({
      code: "approval_mismatch",
      expectedPlanHash: previewBody.planHash.slice(0, 12),
      actualPlanHash: "a".repeat(12),
    });
    expect((await aggregate()).cards[cardId]?.title).toBe("Before");
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );

    const clientRunId = `plan-${randomUUID().slice(0, 8)}`;
    const applied = await applyPlan(commands, previewBody.planHash, {
      clientRunId,
    }).expect(200);
    const body = applied.body as PlanApplyResponse;
    expect(body.planHash).toBe(previewBody.planHash);
    expect(body.runId).toEqual(expect.any(String));
    expect(body.results).toHaveLength(2);
    expect(applied.headers["x-run-id"]).toBe(body.runId);
    expect((await aggregate()).cards[cardId]).toMatchObject({
      title: "After",
      priority: "high",
    });

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: body.runId! },
    });
    expect(run).toMatchObject({
      boardId,
      kind: "plan",
      status: "applied",
      clientRunId,
      planHash: previewBody.planHash,
      approvalId: null,
      commandCount: 2,
    });
    expect(
      await prisma.commandPreimage.count({ where: { runId: run.id } }),
    ).toBe(2);

    // A retry with the same body and clientRunId is an idempotent replay.
    const commandsAfterApply = (await counts()).commands;
    const replay = await applyPlan(commands, previewBody.planHash, {
      clientRunId,
    }).expect(200);
    const replayBody = replay.body as PlanApplyResponse;
    expect(replayBody.runId).toBe(body.runId);
    expect(replayBody.results.map((result) => result.seq)).toEqual(
      body.results.map((result) => result.seq),
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore + 1,
    );
    expect(await prisma.command.count({ where: { boardId } })).toBe(
      commandsAfterApply,
    );
  });

  it("enforces the 100-command and 50-card-create limits", async () => {
    const columnId = await createColumn("Limits");
    const cardId = await createCard(columnId, "Limit card");

    const hundred = Array.from({ length: 100 }, (_, index) =>
      planCommand({
        type: "UPDATE_CARD",
        cardId,
        title: `Title ${index}`,
      }),
    );
    const atLimit = await preview(hundred).expect(200);
    expect((atLimit.body as PlanPreviewDto).commandCount).toBe(100);
    expect((atLimit.body as PlanPreviewDto).limits.commands).toBe(100);

    const attentionBefore = await prisma.attentionNotification.count({
      where: { boardId },
    });
    const overCommands = await preview([
      ...hundred,
      planCommand({ type: "UPDATE_CARD", cardId, title: "One too many" }),
    ]).expect(409);
    expect(overCommands.body).toMatchObject({
      code: "limit_exceeded",
      limit: 100,
      current: 101,
    });
    // A refused dry run is still a dry run: no attention row is written.
    expect(
      await prisma.attentionNotification.count({ where: { boardId } }),
    ).toBe(attentionBefore);

    const creates = Array.from({ length: 50 }, (_, index) =>
      planCommand({
        type: "ADD_CARD",
        newCardId: randomUUID(),
        columnId,
        title: `Bulk ${index}`,
      }),
    );
    const atCardLimit = await preview(creates).expect(200);
    expect((atCardLimit.body as PlanPreviewDto).cardCreates).toBe(50);

    const overCards = await preview([
      ...creates,
      planCommand({
        type: "ADD_CARD",
        newCardId: randomUUID(),
        columnId,
        title: "One card too many",
      }),
    ]).expect(409);
    expect(overCards.body).toMatchObject({
      code: "limit_exceeded",
      limit: 50,
      current: 51,
    });
  });

  it("applies the board policy caps to the preview", async () => {
    const policyBoard = await createBoard("Plan policy");
    const columnId = await createColumn("Policy", policyBoard);
    const cardId = await createCard(columnId, "Policy card", policyBoard);
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: policyBoard },
    });
    await prisma.board.update({
      where: { id: policyBoard },
      data: {
        agentPolicy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          maxCommandsPerRun: 3,
          maxCardsPerRun: 2,
        } as never,
      },
    });
    try {
      const three = Array.from({ length: 3 }, (_, index) =>
        planCommand({
          type: "UPDATE_CARD",
          cardId,
          title: `Policy ${index}`,
        }),
      );
      await preview(three, workerToken, policyBoard).expect(200);
      const four = await preview(
        [
          ...three,
          planCommand({ type: "UPDATE_CARD", cardId, title: "Fourth" }),
        ],
        workerToken,
        policyBoard,
      ).expect(409);
      expect(four.body).toMatchObject({
        code: "limit_exceeded",
        limit: 3,
        current: 4,
      });
      const twoCards = Array.from({ length: 2 }, (_, index) =>
        planCommand({
          type: "ADD_CARD",
          newCardId: randomUUID(),
          columnId,
          title: `Policy card ${index}`,
        }),
      );
      await preview(twoCards, workerToken, policyBoard).expect(200);
      const threeCards = await preview(
        [
          ...twoCards,
          planCommand({
            type: "ADD_CARD",
            newCardId: randomUUID(),
            columnId,
            title: "Policy card 3",
          }),
        ],
        workerToken,
        policyBoard,
      ).expect(409);
      expect(threeCards.body).toMatchObject({ limit: 2, current: 3 });
    } finally {
      await prisma.board.update({
        where: { id: policyBoard },
        data: { agentPolicy: board.agentPolicy as never },
      });
    }
  });

  it("creates an approval for a destructive plan and consumes it once", async () => {
    const columnId = await createColumn("Approval");
    const cardId = await createCard(columnId, "Delete me");
    const commands: PlanCommand[] = [
      planCommand({ type: "DELETE_CARD", cardId }),
    ];
    const previewBody = (await preview(commands).expect(200))
      .body as PlanPreviewDto;
    expect(previewBody.requirement).toMatchObject({
      kind: "destructive",
      requiresApproval: true,
    });
    expect(previewBody.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "approval_required" }),
      ]),
    );
    expect(previewBody.conflicts).toEqual([]);
    expect(previewBody.canApply).toBe(true);
    const approvalsBefore = await prisma.approvalRequest.count({
      where: { boardId },
    });
    const runsBefore = await prisma.agentRun.count({ where: { boardId } });

    const refused = await applyPlan(commands, previewBody.planHash).expect(409);
    expect(refused.body).toMatchObject({
      code: "approval_required",
      planHash: previewBody.planHash,
      approvalId: expect.any(String),
      expiresAt: expect.any(Number),
    });
    // No partial apply: the card is alive and no command/run was written.
    expect(
      await prisma.card.count({ where: { id: cardId, deletedAt: null } }),
    ).toBe(1);
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );
    expect(await prisma.approvalRequest.count({ where: { boardId } })).toBe(
      approvalsBefore + 1,
    );
    const approvalId = refused.body.approvalId as string;

    await decide(approvalId, previewBody.planHash).expect(200);
    const applied = await applyPlan(commands, previewBody.planHash, {
      approvalId,
    }).expect(200);
    const body = applied.body as PlanApplyResponse;
    expect(body.runId).toEqual(expect.any(String));
    expect((await aggregate()).cards[cardId]).toBeUndefined();

    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(approval).toMatchObject({
      status: "consumed",
      runId: body.runId,
    });
    expect(approval.consumedAt).not.toBeNull();
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: body.runId! },
    });
    expect(run).toMatchObject({
      kind: "plan",
      approvalId,
      planHash: previewBody.planHash,
      commandCount: 1,
    });

    // Repeating the same applied plan (with or without the header) is a safe
    // replay: no second run, no second command.
    const replayWithHeader = await applyPlan(commands, previewBody.planHash, {
      approvalId,
    }).expect(200);
    expect((replayWithHeader.body as PlanApplyResponse).runId).toBe(body.runId);
    const replayWithoutHeader = await applyPlan(
      commands,
      previewBody.planHash,
    ).expect(200);
    expect((replayWithoutHeader.body as PlanApplyResponse).runId).toBe(
      body.runId,
    );
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore + 1,
    );

    // Another plan cannot ride the consumed approval.
    const otherCardId = await createCard(columnId, "Other delete");
    const otherCommands = [
      planCommand({ type: "DELETE_CARD", cardId: otherCardId }),
    ];
    const otherPreview = (await preview(otherCommands).expect(200))
      .body as PlanPreviewDto;
    const otherApply = await applyPlan(otherCommands, otherPreview.planHash, {
      approvalId,
    }).expect(409);
    expect(otherApply.body.code).toBe("approval_mismatch");
    expect(otherApply.body.approvalId).toBe(approvalId);
    expect((await aggregate()).cards[otherCardId]?.title).toBe("Other delete");
  });

  it("previews conflicts for stale versions and WIP limits, and warns on a no-op", async () => {
    const columnId = await createColumn("Conflicts");
    const cardId = await createCard(columnId, "Conflict card");
    const seq = Number(
      (
        await server()
          .get(`/api/v1/boards/${boardId}`)
          .set(auth(ownerSession))
          .expect(200)
      ).headers["x-board-seq"],
    );

    const stale = await preview([
      planCommand(
        { type: "UPDATE_CARD", cardId, title: "Stale" },
        randomUUID(),
      ),
    ]).expect(200);
    // No precondition -> no conflict; add one through the helper body.
    const staleWithIfMatch = await server()
      .post(`/api/v1/boards/${boardId}/plans`)
      .set(auth(workerToken))
      .send({
        commands: [
          {
            commandId: randomUUID(),
            action: { type: "UPDATE_CARD", cardId, title: "Stale" },
            ifMatch: seq + 100,
          },
        ],
      })
      .expect(200);
    expect((stale.body as PlanPreviewDto).canApply).toBe(true);
    expect((staleWithIfMatch.body as PlanPreviewDto).canApply).toBe(false);
    expect((staleWithIfMatch.body as PlanPreviewDto).conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, code: "version" }),
      ]),
    );

    await command("SET_COLUMN_WIP_LIMIT", { columnId, wipLimit: 1 }).expect(
      200,
    );
    const wip = await preview([
      planCommand({
        type: "ADD_CARD",
        newCardId: randomUUID(),
        columnId,
        title: "Over WIP",
      }),
    ]).expect(200);
    expect((wip.body as PlanPreviewDto).conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "wip" })]),
    );
    expect((wip.body as PlanPreviewDto).canApply).toBe(false);

    const noop = await preview([
      planCommand({ type: "UPDATE_CARD", cardId, title: "Conflict card" }),
    ]).expect(200);
    expect((noop.body as PlanPreviewDto).warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "no_op" })]),
    );
    expect((noop.body as PlanPreviewDto).canApply).toBe(true);
  });

  it("keeps a browser plan outside the run log and does not require approval", async () => {
    const columnId = await createColumn("Browser plan");
    const cardId = await createCard(columnId, "Browser delete");
    const commands = [planCommand({ type: "DELETE_CARD", cardId })];
    const previewBody = (await preview(commands, ownerSession).expect(200))
      .body as PlanPreviewDto;
    expect(previewBody.requirement.requiresApproval).toBe(false);
    expect(previewBody.warnings).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ code: "approval_required" }),
      ]),
    );

    const runsBefore = await prisma.agentRun.count({ where: { boardId } });
    const applied = await applyPlan(commands, previewBody.planHash, {
      token: ownerSession,
    }).expect(200);
    expect((applied.body as PlanApplyResponse).runId ?? null).toBeNull();
    expect(applied.headers["x-run-id"]).toBeUndefined();
    expect((await aggregate()).cards[cardId]).toBeUndefined();
    expect(await prisma.agentRun.count({ where: { boardId } })).toBe(
      runsBefore,
    );
  });

  it("rolls back a kind:plan run from its pre-images", async () => {
    const columnId = await createColumn("Rollback");
    const newCardId = randomUUID();
    const commands: PlanCommand[] = [
      planCommand({
        type: "ADD_CARD",
        newCardId,
        columnId,
        title: "Plan-made",
      }),
      planCommand({
        type: "UPDATE_CARD",
        cardId: newCardId,
        title: "Plan-edited",
      }),
    ];
    const previewBody = (await preview(commands).expect(200))
      .body as PlanPreviewDto;
    const applied = await applyPlan(commands, previewBody.planHash).expect(200);
    const runId = (applied.body as PlanApplyResponse).runId!;
    expect((await aggregate()).cards[newCardId]?.title).toBe("Plan-edited");

    const previewRevert = await server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert/preview`)
      .set(auth(ownerSession))
      .send({})
      .expect(200);
    expect(previewRevert.body).toMatchObject({
      dryRun: true,
      canRevert: true,
      conflicts: [],
    });

    const reverted = await server()
      .post(`/api/v1/boards/${boardId}/runs/${runId}/revert`)
      .set(auth(ownerSession))
      .send({ commandId: randomUUID() })
      .expect(200);
    expect((reverted.body as RunDetailDto).run).toMatchObject({
      kind: "revert",
      revertsRunId: runId,
    });
    expect((await aggregate()).cards[newCardId]).toBeUndefined();
    expect(
      (await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
        .status,
    ).toBe("reverted");
  });

  it("keeps an observer PAT and a VIEWER out of the plan transport", async () => {
    const commands = [
      planCommand({
        type: "ADD_CARD",
        newCardId: randomUUID(),
        columnId: (await aggregate()).columns[0]!.id,
        title: "Denied",
      }),
    ];
    const patPlan = await preview(commands, observerToken);
    expect(patPlan.status).toBe(403);
    expect(patPlan.body.code).toBe("scope_denied");

    const viewerPlan = await preview(commands, viewerSession);
    expect(viewerPlan.status).toBe(403);
    expect(viewerPlan.body.code).toBe("scope_denied");

    const viewerApply = await applyPlan(commands, "a".repeat(64), {
      token: viewerSession,
    });
    expect(viewerApply.status).toBe(403);
    expect(viewerApply.body.code).toBe("scope_denied");
  });

  it("lets a trusted CI plan skip approval, and a board MEMBER plan without a run", async () => {
    const columnId = await createColumn("Trusted");
    const cardId = await createCard(columnId, "Trusted delete");
    const commands = [planCommand({ type: "DELETE_CARD", cardId })];
    const previewBody = (await preview(commands, trustedToken).expect(200))
      .body as PlanPreviewDto;
    expect(previewBody.requirement.requiresApproval).toBe(false);
    const applied = await applyPlan(commands, previewBody.planHash, {
      token: trustedToken,
    }).expect(200);
    const body = applied.body as PlanApplyResponse;
    expect(body.runId).toEqual(expect.any(String));
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: body.runId! },
    });
    expect(run).toMatchObject({ kind: "plan", approvalId: null });

    const memberColumn = await createColumn("Member");
    const memberCard = await createCard(memberColumn, "Member card");
    const memberCommands = [
      planCommand({ type: "UPDATE_CARD", cardId: memberCard, title: "Member" }),
    ];
    const memberPreview = await preview(memberCommands, memberSession).expect(
      200,
    );
    const memberPlanHash = (memberPreview.body as PlanPreviewDto).planHash;
    const memberApplied = await applyPlan(memberCommands, memberPlanHash, {
      token: memberSession,
    }).expect(200);
    expect((memberApplied.body as PlanApplyResponse).runId ?? null).toBeNull();
    expect((await aggregate()).cards[memberCard]?.title).toBe("Member");
  });

  it("reports owner, schema and board mismatch errors", async () => {
    const otherBoard = await createBoard("Plan isolation");
    const otherColumn = await createColumn("Elsewhere", otherBoard);
    const otherCard = await createCard(
      otherColumn,
      "Elsewhere card",
      otherBoard,
    );

    const foreign = await preview(
      [planCommand({ type: "UPDATE_CARD", cardId: otherCard, title: "No" })],
      workerToken,
    );
    // The card id belongs to another board; the preview reports the ownership
    // conflict instead of silently rewriting that board on apply.
    expect(foreign.status).toBe(200);
    expect((foreign.body as PlanPreviewDto).conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "id" })]),
    );

    const missingBoard = await preview(
      [planCommand({ type: "UPDATE_CARD", cardId: otherCard, title: "No" })],
      workerToken,
      "no-such-board",
    );
    expect(missingBoard.status).toBe(404);

    const unknownAction = await server()
      .post(`/api/v1/boards/${boardId}/plans`)
      .set(auth(workerToken))
      .send({
        commands: [{ commandId: randomUUID(), action: { type: "NOPE" } }],
      });
    expect(unknownAction.status).toBe(400);
    expect(unknownAction.body.message).toContain("Invalid command");

    const duplicate = await server()
      .post(`/api/v1/boards/${boardId}/plans`)
      .set(auth(workerToken))
      .send({
        commands: [
          {
            commandId: "same-id",
            action: { type: "TOUCH_CARD", cardId: otherCard },
          },
          {
            commandId: "same-id",
            action: { type: "TOUCH_CARD", cardId: otherCard },
          },
        ],
      });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toContain("repeats commandId");

    const empty = await server()
      .post(`/api/v1/boards/${boardId}/plans`)
      .set(auth(workerToken))
      .send({ commands: [] });
    expect(empty.status).toBe(400);
  });
});
