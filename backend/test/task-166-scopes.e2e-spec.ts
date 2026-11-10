import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ApiTokenIdentityDto,
  CreateUserTokenResponse,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DEFAULT_BOARD_AGENT_POLICY } from "@/auth/token-scope";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "task-166-scopes@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.2 — token presets, board isolation and the destructive gate.
 *
 * The matrix is pinned at unit level in `auth/token-scope.spec.ts`; this suite
 * proves the same decisions are actually reached through REST: a new token is
 * a worker, board-scoped tokens stay on their board and lose account routes,
 * reviewer gates done transitions, and destructive work needs approval unless
 * the token is trustedCi (or grandfathered legacy admin+trustedCi).
 */
describe("TASK-166 token scopes and destructive gate (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let session: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    session = await server()
      .post("/api/v1/auth/register")
      .send({ email: OWNER_EMAIL, password: PASSWORD, displayName: "Owner" })
      .expect(201)
      .then((res) => res.body.accessToken as string);
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
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  async function createColumn(
    boardId: string,
    title = "Todo",
  ): Promise<string> {
    const columnId = randomUUID();
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(session))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "ADD_COLUMN",
          newColumnId: columnId,
          title,
        },
      })
      .expect(200);
    return columnId;
  }

  async function createCard(
    boardId: string,
    columnId: string,
    title = "Card",
  ): Promise<string> {
    const cardId = randomUUID();
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(session))
      .send({
        commandId: randomUUID(),
        action: {
          boardId,
          at: Date.now(),
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title,
        },
      })
      .expect(200);
    return cardId;
  }

  async function createToken(
    body: Record<string, unknown>,
  ): Promise<CreateUserTokenResponse> {
    return server()
      .post("/api/v1/users/me/tokens")
      .set(auth(session))
      .send({ expiresAt: null, ...body })
      .expect(201)
      .then((res) => res.body as CreateUserTokenResponse);
  }

  /** Register a second human and add them to the board as a member/viewer. */
  async function addMember(
    boardId: string,
    role: "MEMBER" | "VIEWER" = "MEMBER",
  ): Promise<{ session: string; email: string }> {
    const email = `task-166-member-${randomUUID()}@example.com`;
    const memberSession = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName: "Member" })
      .expect(201)
      .then((res) => res.body.accessToken as string);
    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(session))
      .send({ email, role })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(memberSession))
      .expect(200);
    const invitation = (
      invitations.body as Array<{ id: string; boardId: string }>
    ).find((row) => row.boardId === boardId);
    if (invitation === undefined) throw new Error("invitation not found");
    await server()
      .post(`/api/v1/invitations/${invitation.id}/accept`)
      .set(auth(memberSession))
      .expect(200);
    return { session: memberSession, email };
  }

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050201009a61d11b0000000049454e44ae426082",
    "hex",
  );

  async function uploadAttachment(
    token: string,
    cardId: string,
  ): Promise<string> {
    return server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(token))
      .attach("file", png, { filename: "pixel.png", contentType: "image/png" })
      .expect(201)
      .then((res) => res.body.id as string);
  }

  function command(
    token: string,
    boardId: string,
    action: Record<string, unknown>,
  ) {
    return server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({
        commandId: randomUUID(),
        action: { boardId, at: Date.now(), ...action },
      });
  }

  it("creates new tokens as worker without trustedCi", async () => {
    const created = await createToken({ name: "default" });
    expect(created.apiToken).toMatchObject({
      scopePreset: "worker",
      trustedCi: false,
      effectiveTokenScope: "worker",
      readOnly: false,
    });

    const me = await server()
      .get("/api/v1/auth/me")
      .set(auth(created.token))
      .expect(200);
    expect(me.body.token as ApiTokenIdentityDto).toMatchObject({
      scopePreset: "worker",
      trustedCi: false,
      effectiveTokenScope: "worker",
    });
  });

  it("keeps an observer read-only while it can read the board", async () => {
    const boardId = await createBoard("Observer");
    const observer = await createToken({
      name: "observer",
      scopePreset: "observer",
    });

    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(observer.token))
      .expect(200);

    const denied = await command(observer.token, boardId, {
      type: "ADD_COLUMN",
      newColumnId: randomUUID(),
      title: "Nope",
    }).expect(403);
    expect(denied.body.code).toBe("scope_denied");
    expect(denied.body.requiredScope).toBe("worker");
  });

  it("lets a worker write content but not administer the board", async () => {
    const boardId = await createBoard("Worker");
    const worker = await createToken({
      name: "worker",
      scopePreset: "worker",
    });

    const columnId = await createColumn(boardId, "Todo");
    await createCard(boardId, columnId, "Allowed");

    const shares = await server()
      .get(`/api/v1/boards/${boardId}/shares`)
      .set(auth(worker.token))
      .expect(403);
    expect(shares.body.code).toBe("scope_denied");
    expect(shares.body.requiredScope).toBe("admin");

    const deletion = await server()
      .delete(`/api/v1/boards/${boardId}`)
      .set(auth(worker.token))
      .expect(403);
    expect(deletion.body.code).toBe("scope_denied");
  });

  it("applies the board role before the token preset", async () => {
    const boardId = await createBoard("Role first");
    const memberEmail = `task-166-member-${randomUUID()}@example.com`;
    const memberSession = await server()
      .post("/api/v1/auth/register")
      .send({
        email: memberEmail,
        password: PASSWORD,
        displayName: "Member",
      })
      .expect(201)
      .then((res) => res.body.accessToken as string);

    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(session))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(memberSession))
      .expect(200);
    const invitation = (
      invitations.body as Array<{ id: string; boardId: string }>
    ).find((row) => row.boardId === boardId);
    expect(invitation).toBeDefined();
    await server()
      .post(`/api/v1/invitations/${invitation!.id}/accept`)
      .set(auth(memberSession))
      .expect(200);

    const memberAdminToken = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(memberSession))
      .send({
        name: "member-admin",
        expiresAt: null,
        scopePreset: "admin",
        trustedCi: true,
      })
      .expect(201)
      .then((res) => res.body.token as string);

    // The token is admin and trusted, but the owner is only a MEMBER: the
    // board role is checked first and wins.
    const denied = await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(memberAdminToken))
      .send({ email: "role-first@example.com", role: "MEMBER" })
      .expect(403);
    expect(denied.body.message).toBe("Insufficient board role");
    expect(denied.body.code).toBe("scope_denied");
    expect(denied.body.requiredRoles).toEqual(["ADMIN"]);
  });

  it("keeps a board-scoped token on its board and out of account routes", async () => {
    const boardA = await createBoard("Scoped A");
    const boardB = await createBoard("Scoped B");
    const scoped = await createToken({
      name: "scoped",
      boardId: boardA,
      scopePreset: "admin",
    });

    await server()
      .get(`/api/v1/boards/${boardA}`)
      .set(auth(scoped.token))
      .expect(200);
    const otherBoard = await server()
      .get(`/api/v1/boards/${boardB}`)
      .set(auth(scoped.token))
      .expect(403);
    expect(otherBoard.body.code).toBe("scope_denied");
    // A nonexistent board answers exactly like a foreign one: the board scope
    // is checked before the board lookup, so it is not an existence oracle.
    const missingBoard = await server()
      .get(`/api/v1/boards/${randomUUID()}`)
      .set(auth(scoped.token))
      .expect(403);
    expect(missingBoard.body).toMatchObject({
      code: "scope_denied",
      message: otherBoard.body.message,
    });

    const list = await server()
      .get("/api/v1/boards")
      .set(auth(scoped.token))
      .expect(200);
    expect(
      (list.body as Array<{ id: string }>).map((board) => board.id),
    ).toEqual([boardA]);

    for (const response of [
      await server()
        .post("/api/v1/boards")
        .set(auth(scoped.token))
        .send({ title: "Outside" }),
      await server()
        .post("/api/v1/boards/import")
        .set(auth(scoped.token))
        .send({ boards: [] }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("scope_denied");
    }

    // D22: account reads/writes are session-only, even for a grandfathered
    // admin token. A board-scoped PAT cannot list invitations or accept one.
    const accountRoutes: Array<() => request.Test> = [
      () => server().get("/api/v1/users/me/tokens").set(auth(scoped.token)),
      () => server().get("/api/v1/invitations").set(auth(scoped.token)),
      () =>
        server()
          .patch("/api/v1/users/me")
          .set(auth(scoped.token))
          .send({ displayName: "Changed" }),
      () =>
        server()
          .post("/api/v1/invitations/anything/accept")
          .set(auth(scoped.token)),
    ];
    for (const pending of accountRoutes) {
      const response = await pending();
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("pat_forbidden");
    }
  });

  it("requires reviewer for a done-column transition", async () => {
    const boardId = await createBoard("Done gate");
    const todo = await createColumn(boardId, "Todo");
    const done = await createColumn(boardId, "Done");
    const cardId = await createCard(boardId, todo, "Finish me");
    await prisma.board.update({
      where: { id: boardId },
      data: {
        workflow: {
          schemaVersion: 1,
          enabled: false,
          doneColumnIds: [done],
          transitions: [],
        },
      },
    });

    const worker = await createToken({
      name: "worker-done",
      scopePreset: "worker",
    });
    const reviewer = await createToken({
      name: "reviewer-done",
      scopePreset: "reviewer",
    });

    const denied = await command(worker.token, boardId, {
      type: "MOVE_CARD",
      cardId,
      fromColumnId: todo,
      fromIndex: 0,
      toColumnId: done,
      toIndex: 0,
    }).expect(403);
    expect(denied.body.code).toBe("scope_denied");
    expect(denied.body.requiredScope).toBe("reviewer");

    await command(reviewer.token, boardId, {
      type: "MOVE_CARD",
      cardId,
      fromColumnId: todo,
      fromIndex: 0,
      toColumnId: done,
      toIndex: 0,
    }).expect(200);

    const direct = await command(worker.token, boardId, {
      type: "ADD_CARD",
      newCardId: randomUUID(),
      columnId: done,
      title: "Direct done",
    }).expect(403);
    expect(direct.body.code).toBe("scope_denied");
  });

  it("resolves a bogus unarchive target exactly like the reducer", async () => {
    const boardId = await createBoard("Unarchive done first");
    // Done is the first column; an unknown `columnId` falls back to it in the
    // reducer, so a worker must not be able to bypass reviewer that way.
    const done = await createColumn(boardId, "Done");
    const todo = await createColumn(boardId, "Todo");
    const cardId = await createCard(boardId, todo, "Archived");
    await command(session, boardId, { type: "ARCHIVE_CARD", cardId }).expect(
      200,
    );
    await prisma.board.update({
      where: { id: boardId },
      data: {
        workflow: {
          schemaVersion: 1,
          enabled: false,
          doneColumnIds: [done],
          transitions: [],
        },
      },
    });

    const worker = await createToken({
      name: "worker-bogus-unarchive",
      scopePreset: "worker",
    });
    const denied = await command(worker.token, boardId, {
      type: "UNARCHIVE_CARD",
      cardId,
      columnId: randomUUID(),
    }).expect(403);
    expect(denied.body.code).toBe("scope_denied");
    expect(denied.body.requiredScope).toBe("reviewer");

    const stillArchived = await prisma.card.findUnique({
      where: { id: cardId },
      select: { archivedAt: true },
    });
    expect(stillArchived?.archivedAt).not.toBeNull();
  });

  it("refuses destructive work without approval and keeps the batch atomic", async () => {
    const boardId = await createBoard("Approval gate");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Keep me");
    const admin = await createToken({
      name: "admin-no-ci",
      scopePreset: "admin",
    });

    const denied = await command(admin.token, boardId, {
      type: "DELETE_CARD",
      cardId,
    }).expect(409);
    expect(denied.body.code).toBe("approval_required");
    expect(
      await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } }),
    ).not.toBeNull();

    const newCardId = randomUUID();
    const batch = await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(admin.token))
      .send({
        commands: [
          {
            commandId: randomUUID(),
            action: {
              boardId,
              at: Date.now(),
              type: "ADD_CARD",
              newCardId,
              columnId,
              title: "Never created",
            },
          },
          {
            commandId: randomUUID(),
            action: {
              boardId,
              at: Date.now(),
              type: "DELETE_CARD",
              cardId,
            },
          },
        ],
      })
      .expect(409);
    expect(batch.body.code).toBe("approval_required");
    expect(
      await prisma.card.findFirst({ where: { id: newCardId } }),
    ).toBeNull();
  });

  it("lets trustedCi and a legacy admin+trustedCi token delete", async () => {
    const boardId = await createBoard("Trusted CI");
    const columnId = await createColumn(boardId);
    const ci = await createToken({
      name: "trusted-ci",
      scopePreset: "admin",
      trustedCi: true,
    });
    const trustedCard = await createCard(boardId, columnId, "CI may delete");
    await command(ci.token, boardId, {
      type: "DELETE_CARD",
      cardId: trustedCard,
    }).expect(200);

    const legacy = await createToken({
      name: "legacy",
      scopePreset: "worker",
    });
    await prisma.apiToken.update({
      where: { id: legacy.apiToken.id },
      data: { scopePreset: "admin", trustedCi: true },
    });
    const legacyCard = await createCard(boardId, columnId, "Legacy may delete");
    await command(legacy.token, boardId, {
      type: "DELETE_CARD",
      cardId: legacyCard,
    }).expect(200);
  });

  it("hard-blocks destructive work under board policy destructive: deny", async () => {
    const boardId = await createBoard("Deny policy");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "Protected");
    await prisma.board.update({
      where: { id: boardId },
      data: {
        agentPolicy: {
          ...DEFAULT_BOARD_AGENT_POLICY,
          destructive: "deny",
        },
      },
    });

    const ci = await createToken({
      name: "deny-ci",
      scopePreset: "admin",
      trustedCi: true,
    });
    const denied = await command(ci.token, boardId, {
      type: "DELETE_CARD",
      cardId,
    }).expect(403);
    expect(denied.body.code).toBe("destructive_denied");
    expect(denied.body.reason).toBe("board_policy");
    expect(
      await prisma.card.findFirst({ where: { id: cardId, deletedAt: null } }),
    ).not.toBeNull();

    const deniedLifecycle = await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ci.token))
      .send({ email: "deny-invite@example.com", role: "MEMBER" })
      .expect(403);
    expect(deniedLifecycle.body.code).toBe("destructive_denied");
  });

  it("requires admin for workflow updates and approval unless trustedCi", async () => {
    const boardId = await createBoard("Workflow gate");
    const workflow = {
      schemaVersion: 1,
      enabled: false,
      doneColumnIds: [],
      transitions: [],
    };
    const worker = await createToken({
      name: "worker-workflow",
      scopePreset: "worker",
    });
    const admin = await createToken({
      name: "admin-workflow",
      scopePreset: "admin",
    });
    const ci = await createToken({
      name: "ci-workflow",
      scopePreset: "admin",
      trustedCi: true,
    });

    const denied = await command(worker.token, boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow,
    }).expect(403);
    expect(denied.body.code).toBe("scope_denied");
    expect(denied.body.requiredScope).toBe("admin");

    const approval = await command(admin.token, boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow,
    }).expect(409);
    expect(approval.body.code).toBe("approval_required");

    await command(ci.token, boardId, {
      type: "SET_BOARD_WORKFLOW",
      workflow,
    }).expect(200);
  });

  it("refuses browser undo (RESTORE_*) from any PAT", async () => {
    const boardId = await createBoard("Restore gate");
    const columnId = await createColumn(boardId);
    const ci = await createToken({
      name: "restore-ci",
      scopePreset: "admin",
      trustedCi: true,
    });
    const denied = await command(ci.token, boardId, {
      type: "RESTORE_CARD",
      card: {
        id: randomUUID(),
        title: "Restored",
        labelIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      columnId,
      index: 0,
    }).expect(403);
    expect(denied.body.code).toBe("scope_denied");
  });

  it("gates board deletion by approval and trustedCi", async () => {
    const untrustedBoard = await createBoard("Delete approval");
    const admin = await createToken({
      name: "delete-no-ci",
      scopePreset: "admin",
    });
    const denied = await server()
      .delete(`/api/v1/boards/${untrustedBoard}`)
      .set(auth(admin.token))
      .expect(409);
    expect(denied.body.code).toBe("approval_required");
    expect(
      await prisma.board.findFirst({
        where: { id: untrustedBoard, deletedAt: null },
      }),
    ).not.toBeNull();

    const trustedBoard = await createBoard("Delete trusted");
    const trusted = await createToken({
      name: "delete-ci",
      scopePreset: "admin",
      trustedCi: true,
    });
    await server()
      .delete(`/api/v1/boards/${trustedBoard}`)
      .set(auth(trusted.token))
      .expect(200);
    expect(
      await prisma.board.findFirst({
        where: { id: trustedBoard, deletedAt: null },
      }),
    ).toBeNull();
  });

  it("gates deleting another user's attachment by admin and approval", async () => {
    const boardId = await createBoard("Attachment gate");
    const columnId = await createColumn(boardId);
    const cardId = await createCard(boardId, columnId, "With files");
    const admin = await createToken({
      name: "attachment-admin",
      scopePreset: "admin",
    });

    // Own upload: worker-level, no approval.
    const own = await uploadAttachment(admin.token, cardId);
    await server()
      .delete(`/api/v1/attachments/${own}`)
      .set(auth(admin.token))
      .expect(200);

    // Another user's upload: admin preset and destructive approval.
    const member = await addMember(boardId);
    const foreign = await uploadAttachment(member.session, cardId);
    const denied = await server()
      .delete(`/api/v1/attachments/${foreign}`)
      .set(auth(admin.token))
      .expect(409);
    expect(denied.body.code).toBe("approval_required");

    const trusted = await createToken({
      name: "attachment-ci",
      scopePreset: "admin",
      trustedCi: true,
    });
    await server()
      .delete(`/api/v1/attachments/${foreign}`)
      .set(auth(trusted.token))
      .expect(200);
  });

  it("gates member and share lifecycle actions by preset and approval", async () => {
    const boardId = await createBoard("Lifecycle gate");
    const worker = await createToken({
      name: "worker-lifecycle",
      scopePreset: "worker",
    });
    const admin = await createToken({
      name: "admin-lifecycle",
      scopePreset: "admin",
    });
    const ci = await createToken({
      name: "ci-lifecycle",
      scopePreset: "admin",
      trustedCi: true,
    });

    const workerInvite = await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(worker.token))
      .send({ email: "worker-invite@example.com", role: "MEMBER" })
      .expect(403);
    expect(workerInvite.body.code).toBe("scope_denied");

    const approvalInvite = await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(admin.token))
      .send({ email: "approval-invite@example.com", role: "MEMBER" })
      .expect(409);
    expect(approvalInvite.body.code).toBe("approval_required");

    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ci.token))
      .send({ email: "ci-invite@example.com", role: "MEMBER" })
      .expect(201);

    const approvalShare = await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(admin.token))
      .send({ mode: "snapshot" })
      .expect(409);
    expect(approvalShare.body.code).toBe("approval_required");

    await server()
      .post(`/api/v1/boards/${boardId}/shares`)
      .set(auth(ci.token))
      .send({ mode: "snapshot" })
      .expect(201);
  });
});
