import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ApprovalRequestDto,
  CreateUserTokenResponse,
  UserTokenDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DEFAULT_BOARD_AGENT_POLICY } from "@/auth/token-scope";
import { wipeAll } from "./support/wipe";
import { ShareService } from "@/share/share.service";

const OWNER_EMAIL = "approvals@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.5 — approval lifecycle over REST.
 *
 * The suite follows one destructive card delete from the automatic 409
 * through a human decision to a consumed approval, then pins the refusal
 * paths: reject/cancel/expiry, hash and kind mismatch, owner/session
 * ownership, destructive deny and the batch/plan hash contract.
 */
describe("Approvals (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;
  let ownerId: string;
  let boardId: string;
  let token: string;
  let tokenId: string;
  let otherToken: string;
  let otherTokenId: string;
  let memberToken: string;
  let memberTokenId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const registered = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201);
    session = registered.body.accessToken as string;
    ownerId = registered.body.user.id as string;
    boardId = await createBoard("Approvals");
    token = (await createToken("agent")).token;
    otherToken = (await createToken("agent-other")).token;
    const list = await server()
      .get("/api/v1/users/me/tokens")
      .set(auth(session))
      .expect(200)
      .then((res) => res.body as UserTokenDto[]);
    tokenId = list.find((row) => row.name === "agent")!.id;
    otherTokenId = list.find((row) => row.name === "agent-other")!.id;

    const member = await server()
      .post("/api/v1/auth/register")
      .send({
        email: "approvals-member@example.com",
        password: PASSWORD,
        displayName: "Member",
      })
      .expect(201);
    const memberSession = member.body.accessToken as string;
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(session))
      .send({ email: "approvals-member@example.com", role: "MEMBER" })
      .expect(201);
    const invitation = await server()
      .get("/api/v1/invitations")
      .set(auth(memberSession))
      .expect(200)
      .then(
        (res) =>
          (res.body as Array<{ id: string; boardId: string }>).find(
            (row) => row.boardId === boardId,
          )!.id,
      );
    await server()
      .post(`/api/v1/invitations/${invitation}/accept`)
      .set(auth(memberSession))
      .expect(200);
    const memberCreated = await createToken("member-agent", memberSession);
    memberToken = memberCreated.token;
    memberTokenId = (
      await server()
        .get("/api/v1/users/me/tokens")
        .set(auth(memberSession))
        .expect(200)
        .then((res) => res.body as UserTokenDto[])
    ).find((row) => row.name === "member-agent")!.id;
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (value: string) => ({ Authorization: `Bearer ${value}` });

  async function createBoard(title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function createColumn(title = "Todo"): Promise<string> {
    const columnId = randomUUID();
    await command("ADD_COLUMN", {
      newColumnId: columnId,
      title,
    });
    return columnId;
  }

  async function createCard(columnId: string, title = "Card"): Promise<string> {
    const cardId = randomUUID();
    await command("ADD_CARD", {
      newCardId: cardId,
      columnId,
      title,
    });
    return cardId;
  }

  async function command(
    type: string,
    fields: Record<string, unknown>,
    options: {
      token?: string;
      commandId?: string;
      approvalId?: string;
      sessionId?: string;
    } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(options.token ?? session))
      .set(
        options.sessionId === undefined
          ? {}
          : { "X-Agent-Session": options.sessionId },
      )
      .set(
        options.approvalId === undefined
          ? {}
          : { "X-Approval-Id": options.approvalId },
      )
      .send({
        commandId: options.commandId ?? randomUUID(),
        action: { boardId, at: Date.now(), type, ...fields },
      });
    return { status: response.status, body: response.body };
  }

  async function createToken(
    name: string,
    login: string = session,
    scopePreset: "worker" | "admin" = "worker",
  ): Promise<CreateUserTokenResponse> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(login))
      .send({
        name,
        expiresAt: null,
        scopePreset,
        trustedCi: false,
      })
      .expect(201)
      .then((res) => res.body as CreateUserTokenResponse);
  }

  function deletePlan(cardIds: string[]): Record<string, unknown> {
    return {
      schemaVersion: 1,
      boardId,
      commands: cardIds.map((cardId) => ({
        commandId: randomUUID(),
        action: { type: "DELETE_CARD", cardId },
      })),
    };
  }

  function createApproval(
    body: Record<string, unknown>,
    options: { token?: string; sessionId?: string } = {},
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals`)
      .set(auth(options.token ?? token))
      .set(
        options.sessionId === undefined
          ? {}
          : { "X-Agent-Session": options.sessionId },
      )
      .send(body);
  }

  function decide(
    approvalId: string,
    planHash: string,
    decision: "approve" | "reject" = "approve",
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/approvals/${approvalId}/decision`)
      .set(auth(session))
      .send({ decision, planHash });
  }

  it("runs create → approve → apply → consumed and does not apply twice", async () => {
    const columnId = await createColumn("Lifecycle");
    const cardId = await createCard(columnId, "Delete me");
    const plan = deletePlan([cardId]);
    const commandId = (plan.commands as Array<{ commandId: string }>)[0]!
      .commandId;

    const created = await createApproval({
      kind: "destructive",
      cardId,
      ttlMinutes: 30,
      plan,
    }).expect(201);
    const approval = created.body as ApprovalRequestDto;
    expect(approval).toMatchObject({
      boardId,
      cardId,
      kind: "destructive",
      status: "pending",
      requestedByTokenId: tokenId,
      requestedBy: ownerId,
    });
    expect(approval.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.plan).toEqual(plan);

    // Same token + same plan is the same request.
    const repeated = await createApproval({
      kind: "destructive",
      cardId,
      plan,
    }).expect(201);
    expect((repeated.body as ApprovalRequestDto).id).toBe(approval.id);

    const approved = await decide(approval.id, approval.planHash).expect(200);
    expect(approved.body).toMatchObject({
      id: approval.id,
      status: "approved",
      decidedBy: ownerId,
    });
    // Repeating approve is idempotent, not a second decision.
    const again = await decide(approval.id, approval.planHash).expect(200);
    expect((again.body as ApprovalRequestDto).status).toBe("approved");

    // The stored plan has no `at`; applying it must stamp the server clock.
    const applied = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .set("X-Approval-Id", approval.id)
      .send({
        commandId,
        action: { type: "DELETE_CARD", cardId },
      })
      .expect(200);
    expect((applied.body as { seq: number }).seq).toEqual(expect.any(Number));

    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(row).toMatchObject({
      status: "consumed",
      runId: expect.any(String),
    });
    expect(row.consumedAt).not.toBeNull();
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: row.runId! },
    });
    expect(run).toMatchObject({
      boardId,
      approvalId: approval.id,
      commandCount: 1,
      firstSeq: expect.any(BigInt),
      lastSeq: expect.any(BigInt),
    });
    const stored = await prisma.command.findUniqueOrThrow({
      where: { id: commandId },
    });
    expect(stored.runId).toBe(row.runId);

    // A retry of the same applied command is an idempotent replay.
    const retry = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId, approvalId: approval.id },
    );
    expect(retry.status).toBe(200);
    expect(retry.body.seq).toBe((applied.body as { seq: number }).seq);
    const stillOne = await prisma.command.count({ where: { id: commandId } });
    expect(stillOne).toBe(1);

    // A timeout retry that loses the header is still a stored replay: the
    // consumed approval's commands are already applied by its run.
    const retryWithoutHeader = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId },
    );
    expect(retryWithoutHeader.status).toBe(200);

    // A different command under the consumed approval cannot apply.
    const different = await command(
      "DELETE_CARD",
      { cardId: randomUUID() },
      { token, approvalId: approval.id },
    );
    expect(different.status).toBe(409);
    expect(different.body.code).toBe("approval_mismatch");

    const activity = await prisma.activity.findMany({
      where: { boardId, type: { startsWith: "approval_" } },
      select: { type: true },
    });
    expect(activity.map((entry) => entry.type)).toEqual(
      expect.arrayContaining([
        "approval_requested",
        "approval_approved",
        "approval_consumed",
      ]),
    );
  });

  it("creates the same request automatically for a destructive command", async () => {
    const columnId = await createColumn("Auto");
    const cardId = await createCard(columnId, "Auto delete");
    const commandId = randomUUID();

    const refused = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("approval_required");
    expect(refused.body.approvalId).toEqual(expect.any(String));
    expect(refused.body.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(refused.body.expiresAt).toEqual(expect.any(Number));
    expect(await prisma.command.count({ where: { id: commandId } })).toBe(0);
    expect(
      await prisma.card.count({ where: { id: cardId, deletedAt: null } }),
    ).toBe(1);

    const approvalId = refused.body.approvalId as string;
    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(row.status).toBe("pending");
    expect(row.planHash).toBe(refused.body.planHash);

    await decide(approvalId, row.planHash).expect(200);
    const applied = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId, approvalId },
    );
    expect(applied.status).toBe(200);
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approvalId },
        })
      ).status,
    ).toBe("consumed");
  });

  it("rejects a decision with a different planHash", async () => {
    const cardId = await createCard(await createColumn("Hash"), "Hash");
    const approval = (
      await createApproval({
        kind: "destructive",
        plan: deletePlan([cardId]),
      }).expect(201)
    ).body as ApprovalRequestDto;

    const mismatch = await decide(approval.id, "a".repeat(64)).expect(409);
    expect(mismatch.body.code).toBe("approval_mismatch");
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: approval.id },
        })
      ).status,
    ).toBe("pending");
  });

  it("rejects and allows a new request for the same plan", async () => {
    const cardId = await createCard(await createColumn("Reject"), "Reject");
    const plan = deletePlan([cardId]);
    const approval = (
      await createApproval({ kind: "destructive", plan }).expect(201)
    ).body as ApprovalRequestDto;

    const rejected = await decide(
      approval.id,
      approval.planHash,
      "reject",
    ).expect(200);
    expect((rejected.body as ApprovalRequestDto).status).toBe("rejected");

    const apply = await command(
      "DELETE_CARD",
      { cardId },
      {
        token,
        commandId: (plan.commands as Array<{ commandId: string }>)[0]!
          .commandId,
        approvalId: approval.id,
      },
    );
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe("approval_rejected");

    const fresh = await createApproval({ kind: "destructive", plan }).expect(
      201,
    );
    expect((fresh.body as ApprovalRequestDto).id).not.toBe(approval.id);
    expect((fresh.body as ApprovalRequestDto).status).toBe("pending");
  });

  it("cancels a pending approval and refuses to apply it", async () => {
    const cardId = await createCard(await createColumn("Cancel"), "Cancel");
    const plan = deletePlan([cardId]);
    const approval = (
      await createApproval({ kind: "destructive", plan }).expect(201)
    ).body as ApprovalRequestDto;

    const cancelled = await server()
      .post(`/api/v1/boards/${boardId}/approvals/${approval.id}/cancel`)
      .set(auth(token))
      .expect(200);
    expect((cancelled.body as ApprovalRequestDto).status).toBe("cancelled");

    const apply = await command(
      "DELETE_CARD",
      { cardId },
      {
        token,
        commandId: (plan.commands as Array<{ commandId: string }>)[0]!
          .commandId,
        approvalId: approval.id,
      },
    );
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe("approval_cancelled");
  });

  it("expires lazily on decision and reports approval_expired", async () => {
    const cardId = await createCard(await createColumn("Expiry"), "Expiry");
    const approval = (
      await createApproval({
        kind: "destructive",
        plan: deletePlan([cardId]),
      }).expect(201)
    ).body as ApprovalRequestDto;
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await decide(approval.id, approval.planHash).expect(409);
    expect(expired.body.code).toBe("approval_expired");
    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(row.status).toBe("expired");
    expect(
      await prisma.activity.count({
        where: { boardId, type: "approval_expired" },
      }),
    ).toBeGreaterThan(0);
  });

  it("clamps TTL to the policy and the five-minute floor", async () => {
    const cardId = await createCard(await createColumn("TTL"), "TTL");
    const plan = deletePlan([cardId]);

    const short = (
      await createApproval({
        kind: "destructive",
        plan,
        ttlMinutes: 1,
      }).expect(201)
    ).body as ApprovalRequestDto;
    const shortMinutes = (short.expiresAt - Date.now()) / 60_000;
    expect(shortMinutes).toBeGreaterThan(4.8);
    expect(shortMinutes).toBeLessThan(5.2);

    const longPlan = {
      ...plan,
      commands: (plan.commands as Array<Record<string, unknown>>).map(
        (entry) => ({ ...entry, commandId: randomUUID() }),
      ),
    };
    const long = (
      await createApproval({
        kind: "destructive",
        plan: longPlan,
        ttlMinutes: 500,
      }).expect(201)
    ).body as ApprovalRequestDto;
    const longMinutes = (long.expiresAt - Date.now()) / 60_000;
    expect(longMinutes).toBeGreaterThan(59);
    expect(longMinutes).toBeLessThan(60.2);
  });

  it("hard-denies destructive plans when board policy is deny", async () => {
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
    });
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentPolicy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          destructive: "deny",
        } as never,
      },
    });
    const before = await prisma.approvalRequest.count({
      where: { boardId, requestedByTokenId: tokenId },
    });
    try {
      const cardId = await createCard(await createColumn("Deny"), "Deny");
      const denied = await createApproval({
        kind: "destructive",
        plan: deletePlan([cardId]),
      }).expect(403);
      expect(denied.body.code).toBe("destructive_denied");
      expect(
        await prisma.approvalRequest.count({
          where: { boardId, requestedByTokenId: tokenId },
        }),
      ).toBe(before);
    } finally {
      await prisma.board.update({
        where: { id: boardId },
        data: { agentPolicy: board.agentPolicy as never },
      });
    }
  });

  it("enforces token and agent-session ownership on apply", async () => {
    const columnId = await createColumn("Owner");
    const cardId = await createCard(columnId, "Owned");
    const started = await server()
      .post(`/api/v1/boards/${boardId}/agent-sessions`)
      .set(auth(token))
      .send({ name: "approval-run" })
      .expect(201);
    const sessionId = started.body.id as string;
    const plan = deletePlan([cardId]);
    const approval = (
      await createApproval({ kind: "destructive", plan }, { sessionId }).expect(
        201,
      )
    ).body as ApprovalRequestDto;
    expect(approval.agentSessionId).toBe(sessionId);
    await decide(approval.id, approval.planHash).expect(200);

    const commandId = (plan.commands as Array<{ commandId: string }>)[0]!
      .commandId;
    const wrongToken = await command(
      "DELETE_CARD",
      { cardId },
      { token: otherToken, commandId, approvalId: approval.id },
    );
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.body.code).toBe("approval_owner_mismatch");

    const missingSession = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId, approvalId: approval.id },
    );
    expect(missingSession.status).toBe(403);
    expect(missingSession.body.code).toBe("approval_owner_mismatch");

    const applied = await command(
      "DELETE_CARD",
      { cardId },
      { token, commandId, approvalId: approval.id, sessionId },
    );
    expect(applied.status).toBe(200);
  });

  it("applies a whole batch under one approval and one run", async () => {
    const columnId = await createColumn("Batch");
    const first = await createCard(columnId, "First");
    const second = await createCard(columnId, "Second");
    const plan = deletePlan([first, second]);
    const approval = (
      await createApproval({ kind: "destructive", plan }).expect(201)
    ).body as ApprovalRequestDto;
    await decide(approval.id, approval.planHash).expect(200);

    const response = await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(token))
      .set("X-Approval-Id", approval.id)
      .send({
        commands: (plan.commands as Array<Record<string, unknown>>).map(
          (entry) => ({
            commandId: entry.commandId,
            action: {
              boardId,
              at: Date.now(),
              ...(entry.action as Record<string, unknown>),
            },
          }),
        ),
      })
      .expect(200);
    expect(response.body.results).toHaveLength(2);

    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(row.status).toBe("consumed");
    const commands = await prisma.command.findMany({
      where: {
        id: {
          in: (plan.commands as Array<{ commandId: string }>).map(
            (entry) => entry.commandId,
          ),
        },
      },
      select: { runId: true },
    });
    expect(new Set(commands.map((entry) => entry.runId))).toEqual(
      new Set([row.runId]),
    );
  });

  it("gates a lifecycle REST operation and consumes the same request", async () => {
    const operationBoard = await createBoard("Operation approval");
    const adminToken = (await createToken("operation-agent", session, "admin"))
      .token;

    const refused = await server()
      .post(`/api/v1/boards/${operationBoard}/shares`)
      .set(auth(adminToken))
      .send({ mode: "live" })
      .expect(409);
    expect(refused.body.code).toBe("approval_required");
    expect(refused.body.approvalId).toEqual(expect.any(String));
    expect(refused.body.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await prisma.boardShare.count({ where: { boardId: operationBoard } }),
    ).toBe(0);

    await server()
      .post(
        `/api/v1/boards/${operationBoard}/approvals/${refused.body.approvalId}/decision`,
      )
      .set(auth(session))
      .send({ decision: "approve", planHash: refused.body.planHash })
      .expect(200);

    const created = await server()
      .post(`/api/v1/boards/${operationBoard}/shares`)
      .set(auth(adminToken))
      .set("X-Approval-Id", refused.body.approvalId as string)
      .send({ mode: "live" })
      .expect(201);
    expect(created.body).toMatchObject({
      boardId: operationBoard,
      mode: "live",
    });

    const row = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: refused.body.approvalId as string },
    });
    expect(row).toMatchObject({
      status: "consumed",
      actionType: "share.create",
      runId: null,
    });
    expect(row.consumedAt).not.toBeNull();
    // An operation has no AgentRun; a spontaneous second use is refused.
    const again = await server()
      .post(`/api/v1/boards/${operationBoard}/shares`)
      .set(auth(adminToken))
      .set("X-Approval-Id", refused.body.approvalId as string)
      .send({ mode: "live" })
      .expect(409);
    expect(again.body.code).toBe("approval_consumed");
  });

  it("releases a lifecycle approval on a proven validation rollback but never after commit", async () => {
    const b = await createBoard("Lifecycle rollback");
    const agent = (await createToken("lifecycle-rollback", session, "admin"))
      .token;
    const authorize = async (body: Record<string, unknown>) => {
      const pending = await server()
        .post(`/api/v1/boards/${b}/shares`)
        .set(auth(agent))
        .send(body)
        .expect(409);
      await server()
        .post(
          `/api/v1/boards/${b}/approvals/${pending.body.approvalId}/decision`,
        )
        .set(auth(session))
        .send({ decision: "approve", planHash: pending.body.planHash })
        .expect(200);
      return pending.body.approvalId as string;
    };
    const invalid = { mode: "live", expiresAt: "2000-01-01T00:00:00.000Z" };
    const invalidApproval = await authorize(invalid);
    for (let i = 0; i < 2; i++) {
      await server()
        .post(`/api/v1/boards/${b}/shares`)
        .set(auth(agent))
        .set("X-Approval-Id", invalidApproval)
        .send(invalid)
        .expect(400);
      expect(
        (
          await prisma.approvalRequest.findUniqueOrThrow({
            where: { id: invalidApproval },
          })
        ).status,
      ).toBe("approved");
    }
    expect(await prisma.boardShare.count({ where: { boardId: b } })).toBe(0);
    const valid = { mode: "live", title: "commit failure simulation" };
    const validApproval = await authorize(valid);
    const service = app.get(ShareService);
    const original = service.create.bind(service);
    const spy = jest
      .spyOn(service, "create")
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error("post-commit failure");
      });
    await server()
      .post(`/api/v1/boards/${b}/shares`)
      .set(auth(agent))
      .set("X-Approval-Id", validApproval)
      .send(valid)
      .expect(500);
    spy.mockRestore();
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: validApproval },
        })
      ).status,
    ).toBe("consumed");
    await server()
      .post(`/api/v1/boards/${b}/shares`)
      .set(auth(agent))
      .set("X-Approval-Id", validApproval)
      .send(valid)
      .expect(409);
    expect(await prisma.boardShare.count({ where: { boardId: b } })).toBe(1);
  });

  it("keeps a failed member conflict approved and consumes a concurrent share only once", async () => {
    const b = await createBoard("Lifecycle conflict");
    const agent = (await createToken("lifecycle-conflict", session, "admin"))
      .token;
    const memberPath = `/api/v1/boards/${b}/members/${ownerId}`;
    const denied = await server()
      .patch(memberPath)
      .set(auth(agent))
      .send({ role: "MEMBER" })
      .expect(409);
    await server()
      .post(`/api/v1/boards/${b}/approvals/${denied.body.approvalId}/decision`)
      .set(auth(session))
      .send({ decision: "approve", planHash: denied.body.planHash })
      .expect(200);
    await server()
      .patch(memberPath)
      .set(auth(agent))
      .set("X-Approval-Id", denied.body.approvalId)
      .send({ role: "MEMBER" })
      .expect(409);
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: denied.body.approvalId },
        })
      ).status,
    ).toBe("approved");

    const sharePath = `/api/v1/boards/${b}/shares`;
    const pending = await server()
      .post(sharePath)
      .set(auth(agent))
      .send({ mode: "live" })
      .expect(409);
    await server()
      .post(`/api/v1/boards/${b}/approvals/${pending.body.approvalId}/decision`)
      .set(auth(session))
      .send({ decision: "approve", planHash: pending.body.planHash })
      .expect(200);
    const send = () =>
      server()
        .post(sharePath)
        .set(auth(agent))
        .set("X-Approval-Id", pending.body.approvalId)
        .send({ mode: "live" });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.boardShare.count({ where: { boardId: b } })).toBe(1);
  });

  it("releases a lifecycle approval when a queued write is paused", async () => {
    const b = await createBoard("Lifecycle pause");
    const agent = (await createToken("lifecycle-pause", session, "admin"))
      .token;
    const url = `/api/v1/boards/${b}/shares`;
    const pending = await server()
      .post(url)
      .set(auth(agent))
      .send({ mode: "live" })
      .expect(409);
    await server()
      .post(`/api/v1/boards/${b}/approvals/${pending.body.approvalId}/decision`)
      .set(auth(session))
      .send({ decision: "approve", planHash: pending.body.planHash })
      .expect(200);
    const shares = app.get(ShareService);
    const original = shares.create.bind(shares);
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let proceed!: () => void;
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const spy = jest
      .spyOn(shares, "create")
      .mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return original(...args);
      });
    const request = server()
      .post(url)
      .set(auth(agent))
      .set("X-Approval-Id", pending.body.approvalId)
      .send({ mode: "live" })
      .then((res) => res);
    try {
      await reached;
      await server()
        .post(`/api/v1/boards/${b}/agents/pause`)
        .set(auth(session))
        .send({})
        .expect(200);
    } finally {
      proceed();
    }
    const response = await request;
    spy.mockRestore();
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("agent_paused");
    expect(
      (
        await prisma.approvalRequest.findUniqueOrThrow({
          where: { id: pending.body.approvalId },
        })
      ).status,
    ).toBe("approved");
    expect(await prisma.boardShare.count({ where: { boardId: b } })).toBe(0);
  });

  it("is PAT-only for creation and session-only for decisions", async () => {
    const cardId = await createCard(await createColumn("RBAC"), "RBAC");
    const browserCreate = await createApproval(
      { kind: "destructive", plan: deletePlan([cardId]) },
      { token: session },
    );
    // The helper forces the JWT into the bearer field: it is not a PAT.
    expect(browserCreate.status).toBe(403);
    expect(browserCreate.body.code).toBe("pat_required");

    const approval = (
      await createApproval({
        kind: "destructive",
        plan: deletePlan([cardId]),
      }).expect(201)
    ).body as ApprovalRequestDto;
    const patDecision = await server()
      .post(`/api/v1/boards/${boardId}/approvals/${approval.id}/decision`)
      .set(auth(token))
      .send({ decision: "approve", planHash: approval.planHash });
    expect(patDecision.status).toBe(403);
    expect(patDecision.body.code).toBe("pat_forbidden");
  });

  it("lists and reads approvals by board ADMIN or requesting token", async () => {
    const cardId = await createCard(await createColumn("List"), "List");
    const approval = (
      await createApproval({
        kind: "destructive",
        plan: deletePlan([cardId]),
      }).expect(201)
    ).body as ApprovalRequestDto;

    const adminList = await server()
      .get(`/api/v1/boards/${boardId}/approvals?status=pending`)
      .set(auth(session))
      .expect(200);
    expect(
      (adminList.body as ApprovalRequestDto[]).some(
        (entry) => entry.id === approval.id,
      ),
    ).toBe(true);

    const tokenList = await server()
      .get(`/api/v1/boards/${boardId}/approvals`)
      .set(auth(token))
      .expect(200);
    expect(
      (tokenList.body as ApprovalRequestDto[]).every(
        (entry) => entry.requestedByTokenId === tokenId,
      ),
    ).toBe(true);
    expect(
      (tokenList.body as ApprovalRequestDto[]).some(
        (entry) =>
          entry.requestedByTokenId === otherTokenId ||
          entry.requestedByTokenId === memberTokenId,
      ),
    ).toBe(false);

    const detail = await server()
      .get(`/api/v1/boards/${boardId}/approvals/${approval.id}`)
      .set(auth(token))
      .expect(200);
    expect((detail.body as ApprovalRequestDto).plan).toEqual(approval.plan);

    const otherDetail = await server()
      .get(`/api/v1/boards/${boardId}/approvals/${approval.id}`)
      .set(auth(memberToken));
    expect(otherDetail.status).toBe(403);
    expect(otherDetail.body.code).toBe("approval_owner_mismatch");
  });
});
