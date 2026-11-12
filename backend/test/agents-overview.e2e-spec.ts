import { createHash, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import type {
  AgentsOverviewApprovalsResponse,
  AgentsOverviewRunsResponse,
  AgentsOverviewSessionsResponse,
  AgentsOverviewResponse,
  CreateUserTokenResponse,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const PASSWORD = "correct horse battery";
const OWNER_EMAIL = "agents-overview-owner@example.com";
const OTHER_EMAIL = "agents-overview-other@example.com";
const GHOST_EMAIL = "agents-overview-ghost@example.com";

interface UserSession {
  id: string;
  accessToken: string;
}

interface Token {
  id: string;
  token: string;
  name: string;
}

interface ApprovalSeed {
  id: string;
  summary: string;
  status: string;
  expiresAt: Date;
  decidedAt?: Date | null;
}

/**
 * TASK-179.10 — read-only `/agents/overview` contract.
 *
 * The suite seeds the DB directly so it can exercise every membership edge
 * (pending/expired/revoked/deleted/archived), mixed roles, effective expiry,
 * stable cursor ordering, search disclosure and the no-writes promise without
 * depending on unrelated write paths.
 */
describe("Agents overview aggregation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: UserSession;
  let other: UserSession;
  let ghost: UserSession;
  let ownerToken: Token;
  let ownerToken2: Token;
  let otherToken: Token;
  let ghostToken: Token;

  let alpha: string;
  let beta: string;
  let gamma: string;
  let expiredBoard: string;
  let pendingBoard: string;
  let deletedBoard: string;
  let revokedBoard: string;
  let archivedBoard: string;
  let isolationBoard: string;

  let alphaCard: string;
  let deletedAlphaCard: string;
  let betaCard: string;
  let gammaCard: string;
  let isolationCard: string;

  let alphaSession1: string;
  let alphaSession2: string;
  let alphaSession3: string;
  let alphaSession4: string;
  let alphaForeignSession: string;
  let betaSession: string;
  let gammaSession: string;

  let alphaRun1: string;
  let alphaRun2: string;
  let alphaRun3: string;
  let alphaForeignRun: string;
  let alphaGhostRun: string;
  let betaRun: string;
  let gammaRun: string;

  const approvals: Record<string, ApprovalSeed> = {};
  const NOW = new Date();
  const minutes = (value: number): Date =>
    new Date(NOW.getTime() + value * 60_000);

  beforeAll(async () => {
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

    owner = await register(OWNER_EMAIL, "Owner Admin");
    other = await register(OTHER_EMAIL, "Other Admin");
    ghost = await register(GHOST_EMAIL, "Ghost User");
    ownerToken = await createToken(owner.accessToken, "Owner Claude");
    ownerToken2 = await createToken(owner.accessToken, "Owner CI");
    otherToken = await createToken(other.accessToken, "Other Release Bot");
    ghostToken = {
      id: (
        await prisma.apiToken.create({
          data: {
            userId: ghost.id,
            name: "Ghost Bot",
            tokenHash: randomUUID(),
          },
        })
      ).id,
      token: "",
      name: "Ghost Bot",
    };

    alpha = (await createBoard("Alpha Board")).id;
    beta = (await createBoard("Beta Board")).id;
    gamma = (await createBoard("Gamma Board")).id;
    expiredBoard = (await createBoard("Expired Board")).id;
    pendingBoard = (await createBoard("Pending Board")).id;
    deletedBoard = (await createBoard("Deleted Board")).id;
    revokedBoard = (await createBoard("Revoked Board")).id;
    archivedBoard = (await createBoard("Archived Board")).id;
    isolationBoard = (await createBoard("Isolation Board")).id;

    await member(alpha, owner.id, Role.ADMIN);
    await member(alpha, other.id, Role.MEMBER);
    await member(beta, owner.id, Role.MEMBER);
    await member(beta, other.id, Role.ADMIN);
    await member(gamma, owner.id, Role.VIEWER);
    await member(gamma, other.id, Role.ADMIN);
    await member(expiredBoard, owner.id, Role.VIEWER, {
      expiresAt: minutes(-60),
    });
    await member(expiredBoard, other.id, Role.ADMIN);
    await member(pendingBoard, owner.id, Role.MEMBER, { pending: true });
    await member(pendingBoard, other.id, Role.ADMIN);
    await member(deletedBoard, owner.id, Role.ADMIN);
    await member(deletedBoard, other.id, Role.ADMIN);
    await member(revokedBoard, owner.id, Role.ADMIN);
    await member(revokedBoard, other.id, Role.ADMIN);
    await member(archivedBoard, owner.id, Role.ADMIN);
    await member(archivedBoard, other.id, Role.ADMIN);
    await member(isolationBoard, other.id, Role.ADMIN);

    await prisma.board.update({
      where: { id: deletedBoard },
      data: { deletedAt: minutes(-10) },
    });
    await prisma.board.update({
      where: { id: archivedBoard },
      data: { archivedAt: minutes(-10) },
    });
    await prisma.boardMember.deleteMany({
      where: { boardId: revokedBoard, userId: owner.id },
    });

    const alphaColumn = await createColumn(alpha, "Alpha todo");
    const betaColumn = await createColumn(beta, "Beta todo");
    const gammaColumn = await createColumn(gamma, "Gamma todo");
    const isolationColumn = await createColumn(
      isolationBoard,
      "Isolation todo",
    );
    alphaCard = (await createCard(alphaColumn, "Alpha card")).id;
    deletedAlphaCard = (
      await createCard(alphaColumn, "Deleted alpha card", minutes(-1))
    ).id;
    betaCard = (await createCard(betaColumn, "Beta card")).id;
    gammaCard = (await createCard(gammaColumn, "Gamma card")).id;
    isolationCard = (await createCard(isolationColumn, "Isolation card")).id;

    alphaSession1 = (
      await createSession({
        boardId: alpha,
        userId: owner.id,
        apiTokenId: ownerToken.id,
        name: "Refactor approval flow",
        status: "waiting_approval",
        startedAt: minutes(-10),
        lastHeartbeatAt: minutes(-0.2),
        currentCardId: alphaCard,
      })
    ).id;
    alphaSession2 = (
      await createSession({
        boardId: alpha,
        userId: owner.id,
        apiTokenId: ownerToken.id,
        name: "Landing page rewrite",
        status: "active",
        startedAt: minutes(-20),
        lastHeartbeatAt: minutes(-10),
      })
    ).id;
    alphaSession3 = (
      await createSession({
        boardId: alpha,
        userId: owner.id,
        apiTokenId: ownerToken2.id,
        name: "Docs sweep",
        status: "idle",
        startedAt: minutes(-30),
        lastHeartbeatAt: minutes(-1),
      })
    ).id;
    alphaSession4 = (
      await createSession({
        boardId: alpha,
        userId: owner.id,
        apiTokenId: ownerToken.id,
        name: "Finished",
        status: "completed",
        startedAt: minutes(-120),
        lastHeartbeatAt: minutes(-120),
        endedAt: minutes(-60),
      })
    ).id;
    alphaForeignSession = (
      await createSession({
        boardId: alpha,
        userId: other.id,
        apiTokenId: otherToken.id,
        name: "Other session",
        status: "active",
        startedAt: minutes(-5),
        lastHeartbeatAt: minutes(-0.2),
        currentCardId: alphaCard,
      })
    ).id;
    await createSession({
      boardId: alpha,
      userId: owner.id,
      apiTokenId: ownerToken.id,
      name: "Paused by admin",
      status: "active",
      startedAt: minutes(-15),
      lastHeartbeatAt: minutes(-0.2),
      pausedAt: minutes(-5),
    });
    betaSession = (
      await createSession({
        boardId: beta,
        userId: other.id,
        apiTokenId: otherToken.id,
        name: "Beta session",
        status: "active",
        startedAt: minutes(-3),
        lastHeartbeatAt: minutes(-0.2),
      })
    ).id;
    gammaSession = (
      await createSession({
        boardId: gamma,
        userId: other.id,
        apiTokenId: otherToken.id,
        name: "Gamma session",
        status: "active",
        startedAt: minutes(-4),
        lastHeartbeatAt: minutes(-0.2),
      })
    ).id;
    for (const boardId of [
      expiredBoard,
      pendingBoard,
      deletedBoard,
      revokedBoard,
      archivedBoard,
      isolationBoard,
    ]) {
      await createSession({
        boardId,
        userId: other.id,
        apiTokenId: otherToken.id,
        name: `Hidden ${boardId}`,
        status: "active",
        startedAt: minutes(-6),
        lastHeartbeatAt: minutes(-0.2),
      });
    }

    alphaRun1 = (
      await createRun({
        boardId: alpha,
        actorId: owner.id,
        apiTokenId: ownerToken.id,
        agentSessionId: alphaSession1,
        kind: "batch",
        status: "applied",
        createdAt: minutes(-10),
        appliedAt: minutes(-9.98),
        commandCount: 2,
      })
    ).id;
    alphaRun2 = (
      await createRun({
        boardId: alpha,
        actorId: owner.id,
        apiTokenId: ownerToken2.id,
        agentSessionId: alphaSession3,
        kind: "single",
        status: "reverted",
        createdAt: minutes(-20),
        appliedAt: minutes(-19.6),
        revertedAt: minutes(-15),
      })
    ).id;
    alphaRun3 = (
      await createRun({
        boardId: alpha,
        actorId: owner.id,
        apiTokenId: ownerToken.id,
        agentSessionId: null,
        kind: "plan",
        status: "failed",
        createdAt: minutes(-30),
        appliedAt: minutes(-29.2),
      })
    ).id;
    alphaForeignRun = (
      await createRun({
        boardId: alpha,
        actorId: other.id,
        apiTokenId: otherToken.id,
        agentSessionId: alphaForeignSession,
        kind: "batch",
        status: "applied",
        createdAt: minutes(-5),
        appliedAt: minutes(-4.9),
      })
    ).id;
    alphaGhostRun = (
      await createRun({
        boardId: alpha,
        actorId: ghost.id,
        apiTokenId: ghostToken.id,
        agentSessionId: null,
        kind: "single",
        status: "applied",
        createdAt: minutes(-7),
        appliedAt: minutes(-6.8),
      })
    ).id;
    betaRun = (
      await createRun({
        boardId: beta,
        actorId: other.id,
        apiTokenId: otherToken.id,
        agentSessionId: betaSession,
        kind: "batch",
        status: "applied",
        createdAt: minutes(-3),
        appliedAt: minutes(-2.9),
      })
    ).id;
    gammaRun = (
      await createRun({
        boardId: gamma,
        actorId: other.id,
        apiTokenId: otherToken.id,
        agentSessionId: gammaSession,
        kind: "batch",
        status: "applied",
        createdAt: minutes(-4),
        appliedAt: minutes(-3.9),
      })
    ).id;
    for (const boardId of [
      expiredBoard,
      pendingBoard,
      deletedBoard,
      revokedBoard,
      archivedBoard,
      isolationBoard,
    ]) {
      await createRun({
        boardId,
        actorId: other.id,
        apiTokenId: otherToken.id,
        agentSessionId: null,
        kind: "batch",
        status: "applied",
        createdAt: minutes(-6),
        appliedAt: minutes(-5.9),
      });
    }

    const baseApproval = {
      requestedByTokenId: ownerToken.id,
      requestedBy: owner.id,
      actionType: "DELETE_CARD",
      kind: "destructive",
      risk: "medium",
      planHash: hash("alpha-plan"),
      plan: plan(alpha, alphaCard),
    };
    approvals.pendingEarly = await createApproval({
      ...baseApproval,
      summary: "Delete card “Alpha card”",
      status: "pending",
      expiresAt: minutes(5),
      cardId: alphaCard,
      agentSessionId: alphaSession1,
    });
    approvals.pendingLate = await createApproval({
      ...baseApproval,
      summary: "Archive column “Old alpha”",
      status: "pending",
      expiresAt: minutes(10),
      agentSessionId: alphaSession2,
    });
    approvals.pendingTie1 = await createApproval({
      ...baseApproval,
      summary: "Tie one",
      status: "pending",
      expiresAt: minutes(15),
    });
    approvals.pendingTie2 = await createApproval({
      ...baseApproval,
      summary: "Tie two",
      status: "pending",
      expiresAt: minutes(15),
    });
    approvals.pendingForeign = await createApproval({
      boardId: alpha,
      requestedBy: other.id,
      requestedByTokenId: otherToken.id,
      summary: "Move card to Done",
      status: "pending",
      expiresAt: minutes(7),
      cardId: alphaCard,
      agentSessionId: alphaForeignSession,
      plan: plan(alpha, alphaCard),
    });
    approvals.deletedCard = await createApproval({
      ...baseApproval,
      summary: "Remove stale card",
      status: "pending",
      expiresAt: minutes(20),
      cardId: deletedAlphaCard,
    });
    approvals.cyrillic = await createApproval({
      ...baseApproval,
      summary: "Удалить карточку «Альфа»",
      status: "pending",
      expiresAt: minutes(25),
    });
    approvals.ghost = await createApproval({
      boardId: alpha,
      requestedBy: ghost.id,
      requestedByTokenId: ghostToken.id,
      summary: "Ghost request",
      status: "pending",
      expiresAt: minutes(30),
      plan: plan(alpha, alphaCard),
    });
    approvals.operations = await createApproval({
      ...baseApproval,
      summary: "Delete board operation",
      status: "pending",
      expiresAt: minutes(35),
      plan: {
        schemaVersion: 1,
        boardId: alpha,
        operations: [{ op: "board.delete", target: {}, body: {} }],
      },
    });
    approvals.overduePending = await createApproval({
      ...baseApproval,
      summary: "Overdue pending",
      status: "pending",
      expiresAt: minutes(-10),
    });
    approvals.overdueApproved = await createApproval({
      ...baseApproval,
      summary: "Overdue approved",
      status: "approved",
      expiresAt: minutes(-5),
      decidedBy: owner.id,
      decidedAt: minutes(-90),
    });
    approvals.approved = await createApproval({
      ...baseApproval,
      summary: "Move “Alpha card” to Done",
      status: "approved",
      expiresAt: minutes(20),
      decidedBy: owner.id,
      decidedAt: minutes(-60),
    });
    approvals.rejected = await createApproval({
      ...baseApproval,
      summary: "Rejected alpha",
      status: "rejected",
      expiresAt: minutes(-180),
      decidedBy: ghost.id,
      decidedAt: minutes(-120),
    });
    approvals.cancelled = await createApproval({
      ...baseApproval,
      summary: "Cancelled alpha",
      status: "cancelled",
      expiresAt: minutes(-240),
      decidedAt: minutes(-180),
    });
    approvals.consumed = await createApproval({
      ...baseApproval,
      summary: "Consumed alpha",
      status: "consumed",
      expiresAt: minutes(-300),
      decidedAt: minutes(-240),
      consumedAt: minutes(-240),
      runId: alphaRun1,
    });
    approvals.expiredStored = await createApproval({
      ...baseApproval,
      summary: "Stored expired",
      status: "expired",
      expiresAt: minutes(-360),
    });

    await createApproval({
      boardId: beta,
      requestedBy: other.id,
      requestedByTokenId: otherToken.id,
      summary: "Beta secret approval",
      status: "pending",
      expiresAt: minutes(3),
      cardId: betaCard,
      agentSessionId: betaSession,
      plan: plan(beta, betaCard),
    });
    await createApproval({
      boardId: gamma,
      requestedBy: other.id,
      requestedByTokenId: otherToken.id,
      summary: "Gamma hidden approval",
      status: "pending",
      expiresAt: minutes(2),
      plan: plan(gamma, gammaCard),
    });
    await createApproval({
      boardId: isolationBoard,
      requestedBy: other.id,
      requestedByTokenId: otherToken.id,
      summary: "Isolation secret approval",
      status: "pending",
      expiresAt: minutes(1),
      plan: plan(isolationBoard, isolationCard),
    });
    for (const boardId of [
      expiredBoard,
      pendingBoard,
      deletedBoard,
      revokedBoard,
      archivedBoard,
    ]) {
      await createApproval({
        boardId,
        requestedBy: other.id,
        requestedByTokenId: otherToken.id,
        summary: `Hidden approval ${boardId}`,
        status: "pending",
        expiresAt: minutes(4),
        plan: plan(boardId, isolationCard),
      });
    }
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function register(email: string, displayName: string): Promise<UserSession> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => ({
        id: res.body.user.id as string,
        accessToken: res.body.accessToken as string,
      }));
  }

  async function createToken(session: string, name: string): Promise<Token> {
    const body = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ name, expiresAt: null, scopePreset: "admin", trustedCi: false })
      .expect(201)
      .then((res) => res.body as CreateUserTokenResponse);
    return { id: body.apiToken.id, token: body.token, name };
  }

  async function createBoard(title: string): Promise<{ id: string }> {
    return prisma.board.create({ data: { title }, select: { id: true } });
  }

  async function member(
    boardId: string,
    userId: string,
    role: Role,
    options: { pending?: boolean; expiresAt?: Date } = {},
  ): Promise<void> {
    await prisma.boardMember.create({
      data: {
        boardId,
        userId,
        role,
        acceptedAt: options.pending === true ? null : minutes(-1),
        expiresAt: options.expiresAt ?? null,
      },
    });
  }

  async function createColumn(boardId: string, title: string): Promise<string> {
    const column = await prisma.column.create({
      data: { id: randomUUID(), boardId, title, position: 0 },
    });
    return column.id;
  }

  async function createCard(
    columnId: string,
    title: string,
    deletedAt: Date | null = null,
  ): Promise<{ id: string }> {
    return prisma.card.create({
      data: {
        id: randomUUID(),
        columnId,
        title,
        position: 0,
        deletedAt,
      },
      select: { id: true },
    });
  }

  async function createSession(input: {
    boardId: string;
    userId: string;
    apiTokenId: string;
    name: string;
    status: string;
    startedAt: Date;
    lastHeartbeatAt: Date;
    endedAt?: Date;
    currentCardId?: string;
    pausedAt?: Date;
  }): Promise<{ id: string }> {
    return prisma.agentSession.create({
      data: {
        boardId: input.boardId,
        userId: input.userId,
        apiTokenId: input.apiTokenId,
        name: input.name,
        status: input.status,
        startedAt: input.startedAt,
        lastHeartbeatAt: input.lastHeartbeatAt,
        endedAt: input.endedAt ?? null,
        currentCardId: input.currentCardId ?? null,
        pausedAt: input.pausedAt ?? null,
      },
      select: { id: true },
    });
  }

  async function createRun(input: {
    boardId: string;
    actorId: string;
    apiTokenId: string;
    agentSessionId: string | null;
    kind: string;
    status: string;
    createdAt: Date;
    appliedAt: Date;
    revertedAt?: Date;
    commandCount?: number;
  }): Promise<{ id: string }> {
    return prisma.agentRun.create({
      data: {
        boardId: input.boardId,
        actorId: input.actorId,
        apiTokenId: input.apiTokenId,
        agentSessionId: input.agentSessionId,
        kind: input.kind,
        status: input.status,
        createdAt: input.createdAt,
        appliedAt: input.appliedAt,
        revertedAt: input.revertedAt ?? null,
        commandCount: input.commandCount ?? 1,
      },
      select: { id: true },
    });
  }

  async function createApproval(input: {
    boardId?: string;
    requestedBy: string;
    requestedByTokenId: string;
    summary: string;
    status: string;
    expiresAt: Date;
    decidedBy?: string;
    decidedAt?: Date;
    consumedAt?: Date;
    cardId?: string;
    agentSessionId?: string;
    actionType?: string;
    kind?: string;
    risk?: string;
    planHash?: string;
    plan?: Record<string, unknown>;
    runId?: string;
  }): Promise<ApprovalSeed> {
    const row = await prisma.approvalRequest.create({
      data: {
        boardId: input.boardId ?? alpha,
        requestedBy: input.requestedBy,
        requestedByTokenId: input.requestedByTokenId,
        summary: input.summary,
        status: input.status,
        expiresAt: input.expiresAt,
        decidedBy: input.decidedBy ?? null,
        decidedAt: input.decidedAt ?? null,
        consumedAt: input.consumedAt ?? null,
        cardId: input.cardId ?? null,
        agentSessionId: input.agentSessionId ?? null,
        actionType: input.actionType ?? "DELETE_CARD",
        kind: input.kind ?? "destructive",
        risk: input.risk ?? "medium",
        planHash: input.planHash ?? hash(input.summary),
        plan: (input.plan ?? plan(alpha, alphaCard)) as never,
        runId: input.runId ?? null,
      },
    });
    return {
      id: row.id,
      summary: row.summary,
      status: row.status,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
    };
  }

  function plan(boardId: string, cardId: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      boardId,
      commands: [
        {
          commandId: randomUUID(),
          action: { type: "DELETE_CARD", cardId },
        },
      ],
    };
  }

  function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function overview(
    session: string,
    params: Record<string, string | number | null | undefined> = {},
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const suffix = query.toString();
    return server()
      .get(`/api/v1/agents/overview${suffix ? `?${suffix}` : ""}`)
      .set(auth(session));
  }

  async function approvalsPage(
    session: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<AgentsOverviewApprovalsResponse> {
    return overview(session, { section: "approvals", ...params })
      .expect(200)
      .then((res) => res.body as AgentsOverviewApprovalsResponse);
  }

  async function sessionsPage(
    session: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<AgentsOverviewSessionsResponse> {
    return overview(session, { section: "sessions", ...params })
      .expect(200)
      .then((res) => res.body as AgentsOverviewSessionsResponse);
  }

  async function runsPage(
    session: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<AgentsOverviewRunsResponse> {
    return overview(session, { section: "runs", ...params })
      .expect(200)
      .then((res) => res.body as AgentsOverviewRunsResponse);
  }

  async function allPages<T extends AgentsOverviewResponse>(
    session: string,
    params: Record<string, string | number | null | undefined>,
  ): Promise<T["items"]> {
    const items: unknown[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page: T = await overview(session, { ...params, cursor }).then(
        (res) => res.body as T,
      );
      items.push(...(page.items as unknown[]));
      if (page.nextCursor === null) return items as T["items"];
      cursor = page.nextCursor;
    }
    throw new Error("cursor did not terminate");
  }

  it("rejects every PAT before reading any board scope", async () => {
    for (const token of [ownerToken.token, otherToken.token]) {
      const response = await overview(token).expect(403);
      expect(response.body).toMatchObject({
        code: "pat_forbidden",
        retryable: false,
        requestId: response.headers["x-request-id"],
      });
      expect(response.body).not.toHaveProperty("stack");
    }
    const scoped = await overview(ownerToken.token, {
      boardId: alpha,
      section: "approvals",
    }).expect(403);
    expect(scoped.body.code).toBe("pat_forbidden");
  });

  it("keeps cross-board isolation and mixed roles in the same scope", async () => {
    const response = await approvalsPage(owner.accessToken, { status: "all" });
    expect(response.scope).toEqual({
      boardId: null,
      boardTitle: null,
      role: null,
      canViewApprovals: true,
    });
    expect(response.refreshedAt).toEqual(expect.any(Number));
    expect(response.counts.boards.map((row) => row.id).sort()).toEqual(
      [alpha, beta, gamma].sort(),
    );
    expect(
      response.counts.boards.find((row) => row.id === alpha),
    ).toMatchObject({ role: "ADMIN", pendingApprovals: 9 });
    expect(response.counts.boards.find((row) => row.id === beta)).toMatchObject(
      { role: "MEMBER", pendingApprovals: null },
    );
    expect(
      response.counts.boards.find((row) => row.id === gamma),
    ).toMatchObject({ role: "VIEWER", pendingApprovals: null });
    expect(response.counts.approvals).toEqual({
      pending: 9,
      decided: 7,
      total: 16,
    });
    expect(response.items.every((row) => row.boardId === alpha)).toBe(true);
    expect(
      response.items.some((row) =>
        [beta, gamma, isolationBoard].includes(row.boardId),
      ),
    ).toBe(false);

    const memberBoardApprovals = await overview(owner.accessToken, {
      section: "approvals",
      boardId: beta,
    }).expect(403);
    expect(memberBoardApprovals.body).toMatchObject({
      code: "scope_denied",
      requiredRoles: ["ADMIN"],
    });

    const viewerBoardSessions = await sessionsPage(owner.accessToken, {
      boardId: gamma,
    });
    expect(viewerBoardSessions.items.map((row) => row.id)).toEqual([
      gammaSession,
    ]);

    const otherApprovals = await approvalsPage(other.accessToken, {
      status: "all",
    });
    expect(new Set(otherApprovals.items.map((row) => row.boardId))).toEqual(
      new Set([
        beta,
        gamma,
        isolationBoard,
        expiredBoard,
        pendingBoard,
        revokedBoard,
      ]),
    );
    expect(otherApprovals.items.every((row) => row.boardRole === "ADMIN")).toBe(
      true,
    );
    expect(
      otherApprovals.counts.boards.find((row) => row.id === alpha),
    ).toMatchObject({ role: "MEMBER", pendingApprovals: null });
    expect(
      otherApprovals.counts.boards.find((row) => row.id === beta),
    ).toMatchObject({ role: "ADMIN", pendingApprovals: 1 });
    expect(otherApprovals.items.some((row) => row.boardId === alpha)).toBe(
      false,
    );
  });

  it("excludes pending, expired, revoked, deleted and archived memberships without writing", async () => {
    const expiredBefore = await prisma.boardMember.findUniqueOrThrow({
      where: {
        boardId_userId: { boardId: expiredBoard, userId: owner.id },
      },
    });
    const pendingBefore = await prisma.boardMember.findUniqueOrThrow({
      where: {
        boardId_userId: { boardId: pendingBoard, userId: owner.id },
      },
    });
    const activityBefore = await prisma.activity.count();
    const notificationsBefore = await prisma.attentionNotification.count();
    const auditBefore = await prisma.securityAuditLog.count();

    const sessions = await sessionsPage(owner.accessToken, { limit: 100 });
    expect(new Set(sessions.items.map((row) => row.boardId))).toEqual(
      new Set([alpha, beta, gamma]),
    );
    expect(sessions.items.some((row) => row.id === alphaSession4)).toBe(true);
    expect(
      sessions.items.some((row) =>
        [
          expiredBoard,
          pendingBoard,
          deletedBoard,
          revokedBoard,
          archivedBoard,
          isolationBoard,
        ].includes(row.boardId),
      ),
    ).toBe(false);

    for (const hidden of [
      expiredBoard,
      pendingBoard,
      deletedBoard,
      revokedBoard,
      archivedBoard,
      isolationBoard,
    ]) {
      const response = await overview(owner.accessToken, {
        boardId: hidden,
        section: "sessions",
      }).expect(404);
      expect(response.body).toMatchObject({
        code: "not_found",
        resource: "board",
      });
    }

    const expiredAfter = await prisma.boardMember.findUniqueOrThrow({
      where: {
        boardId_userId: { boardId: expiredBoard, userId: owner.id },
      },
    });
    const pendingAfter = await prisma.boardMember.findUniqueOrThrow({
      where: {
        boardId_userId: { boardId: pendingBoard, userId: owner.id },
      },
    });
    expect(expiredAfter).toEqual(expiredBefore);
    expect(pendingAfter).toEqual(pendingBefore);
    expect(await prisma.activity.count()).toBe(activityBefore);
    expect(await prisma.attentionNotification.count()).toBe(
      notificationsBefore,
    );
    expect(await prisma.securityAuditLog.count()).toBe(auditBefore);
  });

  it("computes effective approval expiry from one slice without the writing path", async () => {
    const storedBefore = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvals.overduePending.id },
    });
    const activityBefore = await prisma.activity.count();
    const notificationsBefore = await prisma.attentionNotification.count();
    const auditBefore = await prisma.securityAuditLog.count();

    const pending = await approvalsPage(owner.accessToken, {
      status: "pending",
      limit: 100,
    });
    expect(pending.total).toBe(9);
    expect(pending.counts.approvals.pending).toBe(9);
    expect(
      pending.items.some((row) => row.id === approvals.overduePending.id),
    ).toBe(false);

    const expired = await approvalsPage(owner.accessToken, {
      status: "expired",
      limit: 100,
    });
    expect(expired.total).toBe(3);
    const overdue = expired.items.find(
      (row) => row.id === approvals.overduePending.id,
    );
    expect(overdue).toMatchObject({
      status: "expired",
      storedStatus: "pending",
    });
    const overdueApproved = expired.items.find(
      (row) => row.id === approvals.overdueApproved.id,
    );
    expect(overdueApproved).toMatchObject({
      status: "expired",
      storedStatus: "approved",
    });
    expect(
      expired.items.find((row) => row.id === approvals.expiredStored.id),
    ).toMatchObject({
      status: "expired",
      storedStatus: "expired",
    });

    const all = await approvalsPage(owner.accessToken, {
      status: "all",
      limit: 100,
    });
    expect(
      all.items.find((row) => row.id === approvals.overduePending.id)?.status,
    ).toBe("expired");
    expect(all.total).toBe(16);

    const storedAfter = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvals.overduePending.id },
    });
    expect(storedAfter).toEqual(storedBefore);
    expect(storedAfter.status).toBe("pending");
    expect(await prisma.activity.count()).toBe(activityBefore);
    expect(await prisma.attentionNotification.count()).toBe(
      notificationsBefore,
    );
    expect(await prisma.securityAuditLog.count()).toBe(auditBefore);
  });

  it("orders pending by expiry and decided by decision across pages", async () => {
    const expectedPending = await prisma.approvalRequest.findMany({
      where: {
        boardId: alpha,
        status: "pending",
        expiresAt: { gt: NOW },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, expiresAt: true },
    });
    const pending = await allPages<AgentsOverviewApprovalsResponse>(
      owner.accessToken,
      { section: "approvals", status: "pending", limit: 2 },
    );
    expect(pending.map((row) => row.id)).toEqual(
      expectedPending.map((row) => row.id),
    );
    expect(pending[0]?.id).toBe(approvals.pendingEarly.id);
    expect(pending[1]?.id).toBe(approvals.pendingForeign.id);
    expect(
      pending.every(
        (row, index) =>
          index === 0 || row.expiresAt >= (pending[index - 1]?.expiresAt ?? 0),
      ),
    ).toBe(true);

    const expectedDecided = await prisma.approvalRequest.findMany({
      where: {
        boardId: alpha,
        NOT: { status: "pending", expiresAt: { gt: NOW } },
      },
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      select: { id: true },
    });
    const decided = await allPages<AgentsOverviewApprovalsResponse>(
      owner.accessToken,
      { section: "approvals", status: "decided", limit: 2 },
    );
    expect(decided.map((row) => row.id)).toEqual(
      expectedDecided.map((row) => row.id),
    );

    const all = await allPages<AgentsOverviewApprovalsResponse>(
      owner.accessToken,
      { section: "approvals", status: "all", limit: 4 },
    );
    expect(all).toHaveLength(16);
    expect(all.slice(0, 9).map((row) => row.id)).toEqual(
      pending.map((row) => row.id),
    );
    expect(all.slice(9).map((row) => row.id)).toEqual(
      expectedDecided.map((row) => row.id),
    );
  });

  it("keeps sessions and runs stable across pages and filters", async () => {
    const expectedSessions = await prisma.agentSession.findMany({
      where: { boardId: { in: [alpha, beta, gamma] } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const sessions = await allPages<AgentsOverviewSessionsResponse>(
      owner.accessToken,
      { section: "sessions", limit: 2 },
    );
    expect(sessions.map((row) => row.id)).toEqual(
      expectedSessions.map((row) => row.id),
    );

    const expectedRuns = await prisma.agentRun.findMany({
      where: { boardId: { in: [alpha, beta, gamma] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const runs = await allPages<AgentsOverviewRunsResponse>(owner.accessToken, {
      section: "runs",
      limit: 2,
    });
    expect(runs.map((row) => row.id)).toEqual(
      expectedRuns.map((row) => row.id),
    );

    const sessionsFirstPage = await sessionsPage(owner.accessToken, {
      limit: 2,
    });
    expect(sessionsFirstPage.total).toBe(8);
    expect(sessionsFirstPage.nextCursor).toEqual(expect.any(String));
    const runsFirstPage = await runsPage(owner.accessToken, { limit: 2 });
    expect(runsFirstPage.total).toBe(7);
    expect(runsFirstPage.nextCursor).toEqual(expect.any(String));

    const stale = await sessionsPage(owner.accessToken, { status: "stale" });
    expect(stale.items.map((row) => row.id)).toEqual([alphaSession2]);
    expect(stale.counts.sessions.stale).toBe(1);
    expect(stale.counts.sessions.paused).toBe(1);
    expect(stale.counts.sessions.total).toBe(8);
    expect(stale.counts.runs.total).toBe(7);

    const failed = await runsPage(owner.accessToken, { status: "failed" });
    expect(failed.items.map((row) => row.id)).toEqual([alphaRun3]);
    const reverted = await runsPage(owner.accessToken, { status: "reverted" });
    expect(reverted.items.map((row) => row.id)).toEqual([alphaRun2]);
  });

  it("applies the section filter whitelist and stable cursor binding", async () => {
    const pending = await approvalsPage(owner.accessToken, {
      status: "pending",
      limit: 2,
    });
    expect(pending.nextCursor).toEqual(expect.any(String));
    const wrongFilter = await overview(owner.accessToken, {
      section: "approvals",
      status: "decided",
      cursor: pending.nextCursor,
    }).expect(400);
    expect(wrongFilter.body.code).toBe("invalid_cursor");

    const wrongBoard = await overview(owner.accessToken, {
      section: "approvals",
      boardId: beta,
      cursor: pending.nextCursor,
    }).expect(403);
    expect(wrongBoard.body.code).toBe("scope_denied");

    const sessionCursor = await sessionsPage(owner.accessToken, { limit: 2 });
    const wrongSection = await overview(owner.accessToken, {
      section: "runs",
      cursor: sessionCursor.nextCursor,
    }).expect(400);
    expect(wrongSection.body.code).toBe("invalid_cursor");

    const invalidStatus = await overview(owner.accessToken, {
      section: "approvals",
      status: "live",
    }).expect(400);
    expect(invalidStatus.body.code).toBe("invalid_filter");
    const invalidKind = await overview(owner.accessToken, {
      section: "sessions",
      kind: "batch",
    }).expect(400);
    expect(invalidKind.body.code).toBe("invalid_filter");
    const invalidRange = await overview(owner.accessToken, {
      section: "sessions",
      from: 2,
      to: 1,
    }).expect(400);
    expect(invalidRange.body.code).toBe("invalid_range");
  });

  it("searches only fields and names the caller can already see", async () => {
    const cardTitle = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Alpha card",
    });
    expect(cardTitle.items.map((row) => row.id).sort()).toEqual(
      [
        approvals.pendingEarly.id,
        approvals.pendingForeign.id,
        approvals.approved.id,
      ].sort(),
    );

    const cyrillic = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Удалить",
    });
    expect(cyrillic.items.map((row) => row.id)).toEqual([
      approvals.cyrillic.id,
    ]);
    expect(cyrillic.total).toBe(1);

    const ownToken = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Owner Claude",
    });
    expect(ownToken.items.length).toBeGreaterThan(0);
    expect(
      ownToken.items.every((row) => row.tokenName === "Owner Claude"),
    ).toBe(true);

    const visibleMember = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Other Admin",
    });
    expect(visibleMember.items.map((row) => row.id)).toEqual([
      approvals.pendingForeign.id,
    ]);
    expect(visibleMember.items[0]).toMatchObject({
      requestedByName: "Other Admin",
      requestedByEmail: OTHER_EMAIL,
    });

    const foreignTokenName = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Other Release Bot",
    });
    expect(foreignTokenName.items).toEqual([]);
    expect(foreignTokenName.total).toBe(0);

    const ghostName = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Ghost User",
    });
    expect(ghostName.items).toEqual([]);

    const isolation = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Isolation",
    });
    expect(isolation.items).toEqual([]);
    expect(isolation.total).toBe(0);

    const hiddenBoard = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Beta secret",
    });
    expect(hiddenBoard.items).toEqual([]);

    const deletedCardTitle = await approvalsPage(owner.accessToken, {
      status: "all",
      q: "Deleted alpha",
    });
    expect(deletedCardTitle.items).toEqual([]);

    const sessionByCard = await sessionsPage(owner.accessToken, {
      q: "Alpha card",
    });
    expect(sessionByCard.total).toBe(2);
    expect(sessionByCard.items.map((row) => row.id).sort()).toEqual(
      [alphaSession1, alphaForeignSession].sort(),
    );
    const sessionByForeignToken = await sessionsPage(owner.accessToken, {
      q: "Other Release Bot",
    });
    expect(sessionByForeignToken.items).toEqual([]);
    const sessionByMember = await sessionsPage(owner.accessToken, {
      q: "Other Admin",
    });
    expect(sessionByMember.items.map((row) => row.id).sort()).toEqual(
      [alphaForeignSession, betaSession, gammaSession].sort(),
    );

    const runBySession = await runsPage(owner.accessToken, {
      q: "Other session",
    });
    expect(runBySession.total).toBe(1);
    expect(runBySession.items.map((row) => row.id)).toEqual([alphaForeignRun]);
    const runByActor = await runsPage(owner.accessToken, {
      q: "Other Admin",
    });
    expect(runByActor.items.map((row) => row.id).sort()).toEqual(
      [alphaForeignRun, betaRun, gammaRun].sort(),
    );
    const runByForeignToken = await runsPage(owner.accessToken, {
      q: "Other Release Bot",
    });
    expect(runByForeignToken.items).toEqual([]);
  });

  it("discloses names only for visible boards, cards, sessions and active members", async () => {
    const response = await approvalsPage(owner.accessToken, {
      status: "all",
      limit: 100,
    });
    const own = response.items.find(
      (row) => row.id === approvals.pendingEarly.id,
    );
    expect(own).toMatchObject({
      boardTitle: "Alpha Board",
      boardRole: "ADMIN",
      cardTitle: "Alpha card",
      sessionName: "Refactor approval flow",
      tokenName: "Owner Claude",
      requestedByName: "Owner Admin",
      requestedByEmail: OWNER_EMAIL,
      commandCount: 1,
      operationCount: 0,
    });
    const foreign = response.items.find(
      (row) => row.id === approvals.pendingForeign.id,
    );
    expect(foreign).toMatchObject({
      tokenName: null,
      requestedByName: "Other Admin",
      requestedByEmail: OTHER_EMAIL,
      sessionName: "Other session",
      cardTitle: "Alpha card",
    });
    const ghost = response.items.find((row) => row.id === approvals.ghost.id);
    expect(ghost).toMatchObject({
      tokenName: null,
      requestedByName: null,
      requestedByEmail: null,
    });
    const deletedCard = response.items.find(
      (row) => row.id === approvals.deletedCard.id,
    );
    expect(deletedCard?.cardTitle).toBeNull();
    const operations = response.items.find(
      (row) => row.id === approvals.operations.id,
    );
    expect(operations).toMatchObject({
      commandCount: 0,
      operationCount: 1,
    });
    expect(
      response.items.find((row) => row.id === approvals.approved.id)
        ?.decidedByName,
    ).toBe("Owner Admin");
    expect(
      response.items.find((row) => row.id === approvals.rejected.id)
        ?.decidedByName,
    ).toBeNull();

    const sessions = await sessionsPage(owner.accessToken, { limit: 100 });
    const foreignSession = sessions.items.find(
      (row) => row.id === alphaForeignSession,
    );
    expect(foreignSession).toMatchObject({
      boardTitle: "Alpha Board",
      boardRole: "ADMIN",
      tokenName: null,
      cardTitle: "Alpha card",
    });
    expect(
      sessions.items.find((row) => row.id === alphaSession1)?.tokenName,
    ).toBe("Owner Claude");

    const runs = await runsPage(owner.accessToken, { limit: 100 });
    const foreignRun = runs.items.find((row) => row.id === alphaForeignRun);
    expect(foreignRun).toMatchObject({
      boardTitle: "Alpha Board",
      boardRole: "ADMIN",
      tokenName: null,
      actorName: "Other Admin",
      sessionName: "Other session",
    });
    expect(foreignRun?.durationMs).toBeGreaterThan(0);
    expect(
      runs.items.find((row) => row.id === alphaGhostRun)?.actorName,
    ).toBeNull();
  });

  it("returns named facets without leaking foreign token names", async () => {
    const response = await approvalsPage(owner.accessToken, {
      status: "all",
      limit: 1,
    });
    const own = response.facets.tokens.find(
      (token) => token.id === ownerToken.id,
    );
    expect(own).toEqual({
      id: ownerToken.id,
      name: "Owner Claude",
      own: true,
    });
    const foreign = response.facets.tokens.find(
      (token) => token.id === otherToken.id,
    );
    expect(foreign).toEqual({
      id: otherToken.id,
      name: null,
      own: false,
    });
    expect(
      response.facets.sessions.find(
        (session) => session.id === alphaForeignSession,
      ),
    ).toMatchObject({
      name: "Other session",
      boardId: alpha,
      boardTitle: "Alpha Board",
    });
    expect(response.facets.tokensTruncated).toBe(false);
    expect(response.facets.sessionsTruncated).toBe(false);
  });
});
