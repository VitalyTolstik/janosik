import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type {
  BoardAgentPolicyStateDto,
  CreateUserTokenResponse,
} from "@janosik/shared";
import { DEFAULT_BOARD_AGENT_POLICY } from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "policy-owner@example.com";
const MEMBER_EMAIL = "policy-member@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.15 board agent policy (ADR §6.3): session-only board ADMIN,
 * strict validation, CAS on `agentPolicyVersion`, `null` reset, Activity and
 * SecurityAudit rows, and a PAT that cannot read or change it.
 */
describe("Board agent policy (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerSession: string;
  let memberSession: string;
  let boardId: string;
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
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    ownerSession = (await register(OWNER_EMAIL, "Owner")).accessToken;
    memberSession = (await register(MEMBER_EMAIL, "Member")).accessToken;
    boardId = await server()
      .post("/api/v1/boards")
      .set(auth(ownerSession))
      .send({ title: "Policy board" })
      .expect(201)
      .then((res) => res.body.id as string);
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerSession))
      .send({ email: MEMBER_EMAIL, role: "MEMBER" })
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
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerSession))
      .send({ name: "policy-agent", expiresAt: null, scopePreset: "worker" })
      .expect(201);
    workerToken = (created.body as CreateUserTokenResponse).token;
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
  ): Promise<{ accessToken: string }> {
    return server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201)
      .then((res) => ({ accessToken: res.body.accessToken as string }));
  }

  function getPolicy(token = ownerSession) {
    return server()
      .get(`/api/v1/boards/${boardId}/agent-policy`)
      .set(auth(token));
  }

  function patchPolicy(body: object, token = ownerSession) {
    return server()
      .patch(`/api/v1/boards/${boardId}/agent-policy`)
      .set(auth(token))
      .send(body);
  }

  function policy(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      destructive: "approval",
      requireApprovalFor: ["delete_card", "member.invite"],
      approverRoles: ["ADMIN"],
      maxCommandsPerRun: 25,
      maxCardsPerRun: 10,
      approvalTtlMinutes: 30,
      ...overrides,
    };
  }

  it("returns the safe defaults and version 1 for a fresh board", async () => {
    const response = await getPolicy().expect(200);
    const state = response.body as BoardAgentPolicyStateDto;
    expect(state.policy).toBeNull();
    expect(state.version).toBe(1);
    expect(state.paused).toBe(false);
    expect(state.effective).toEqual(DEFAULT_BOARD_AGENT_POLICY);
    expect(state.lastSavedBy).toBeNull();
    expect(state.lastSavedAt).toBeNull();
  });

  it("rejects unknown fields and values outside the ADR ranges", async () => {
    const invalid = [
      policy({ destructive: "maybe" }),
      policy({ requireApprovalFor: ["unknown.action"] }),
      policy({ requireApprovalFor: ["delete_card", "delete_card"] }),
      policy({ approverRoles: ["MEMBER"] }),
      policy({ maxCommandsPerRun: 0 }),
      policy({ maxCommandsPerRun: 101 }),
      policy({ maxCardsPerRun: 0 }),
      policy({ maxCardsPerRun: 51 }),
      policy({ approvalTtlMinutes: 4 }),
      policy({ approvalTtlMinutes: 1441 }),
      policy({ schemaVersion: 2 }),
    ];
    for (const body of invalid) {
      const response = await patchPolicy({ policy: body, version: 1 });
      expect(response.status).toBe(400);
      expect((response.body as { field?: string }).field).toBe("policy");
    }
    // Mandatory shape: a missing `policy` is not "reset".
    await patchPolicy({ version: 1 }).expect(400);
    // A string / array is not a policy.
    await patchPolicy({ policy: "deny-all", version: 1 }).expect(400);
  });

  it("saves a valid policy, increments the version and audits it", async () => {
    const response = await patchPolicy({
      policy: policy(),
      version: 1,
    }).expect(200);
    const state = response.body as BoardAgentPolicyStateDto;
    expect(state.policy).toMatchObject({
      destructive: "approval",
      requireApprovalFor: ["delete_card", "member.invite"],
      maxCommandsPerRun: 25,
      maxCardsPerRun: 10,
      approvalTtlMinutes: 30,
      approverRoles: ["ADMIN"],
    });
    expect(state.version).toBe(2);
    expect(state.effective.maxCommandsPerRun).toBe(25);
    expect(state.lastSavedBy).toBe("Owner");
    expect(typeof state.lastSavedAt).toBe("number");

    const activity = await prisma.activity.findFirst({
      where: { boardId, type: "agent_policy_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(activity).not.toBeNull();
    expect(activity?.details).toMatchObject({ version: 2, reset: false });

    const audit = await prisma.securityAuditLog.findFirst({
      where: { action: "board.agent_policy_changed", targetId: boardId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).toMatchObject({ version: 2 });
  });

  it("refuses a stale version with 409 version_conflict", async () => {
    const response = await patchPolicy({ policy: policy(), version: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "version_conflict",
      conflict: "version",
      currentVersion: 2,
      details: { currentVersion: 2 },
    });
    // Nothing changed.
    const state = (await getPolicy().expect(200))
      .body as BoardAgentPolicyStateDto;
    expect(state.version).toBe(2);
    expect(state.policy?.maxCommandsPerRun).toBe(25);
  });

  it("restores defaults with policy: null and still increments the version", async () => {
    const response = await patchPolicy({ policy: null, version: 2 }).expect(
      200,
    );
    const state = response.body as BoardAgentPolicyStateDto;
    expect(state.policy).toBeNull();
    expect(state.version).toBe(3);
    expect(state.effective).toEqual(DEFAULT_BOARD_AGENT_POLICY);
    const stored = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { agentPolicy: true, agentPolicyVersion: true },
    });
    expect(stored.agentPolicy).toBeNull();
    expect(stored.agentPolicyVersion).toBe(3);
  });

  it("is session-only board ADMIN: members and API keys are refused", async () => {
    await getPolicy(memberSession).expect(403);
    await patchPolicy({ policy: policy(), version: 3 }, memberSession).expect(
      403,
    );

    const patRead = await getPolicy(workerToken);
    expect(patRead.status).toBe(403);
    expect((patRead.body as { code?: string }).code).toBe("pat_forbidden");

    const patWrite = await patchPolicy(
      { policy: policy(), version: 3 },
      workerToken,
    );
    expect(patWrite.status).toBe(403);
    expect((patWrite.body as { code?: string }).code).toBe("pat_forbidden");
  });
});
