import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ShareService } from "@/share/share.service";
import { BoardsService } from "@/boards/boards.service";
import { ApiTokenService } from "@/auth/api-token.service";
import { ApprovalsService } from "@/approvals/approvals.service";
import * as pause from "@/auth/agent-pause";
import * as revocation from "@/auth/token-revocation";
import { wipeAll } from "./support/wipe";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("Agent review hardening (e2e)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let jwt: string;
  let board: string;
  let pat: string;
  let tokenId: string;
  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.listen(0);
    db = app.get(PrismaService);
    await wipeAll(db);
    jwt = (
      await server()
        .post("/api/v1/auth/register")
        .send({
          email: "agent-review-hardening@example.com",
          password: "correct horse battery",
          displayName: "Owner",
        })
        .expect(201)
    ).body.accessToken as string;
  });
  beforeEach(async () => {
    board = (
      await server()
        .post("/api/v1/boards")
        .set(auth(jwt))
        .send({ title: "review hardening" })
        .expect(201)
    ).body.id as string;
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(jwt))
      .send({
        name: randomUUID(),
        scopePreset: "admin",
        trustedCi: true,
        expiresAt: null,
      })
      .expect(201);
    pat = created.body.token as string;
    tokenId = created.body.apiToken.id as string;
  });
  afterAll(async () => {
    await wipeAll(db);
    await app.close();
  });
  afterEach(() => jest.restoreAllMocks());

  async function cardOnBoard() {
    const col = randomUUID(),
      card = randomUUID();
    for (const action of [
      { type: "ADD_COLUMN", newColumnId: col, title: "Todo" },
      { type: "ADD_CARD", columnId: col, newCardId: card, title: "card" },
    ]) {
      await server()
        .post(`/api/v1/boards/${board}/commands`)
        .set(auth(jwt))
        .send({
          commandId: randomUUID(),
          action: { boardId: board, at: Date.now(), ...action },
        })
        .expect(200);
    }
    return card;
  }

  it("does not leave a newly created claim behind after revocation", async () => {
    const card = await cardOnBoard();
    const reached = barrier(),
      proceed = barrier(),
      revokeEntered = barrier();
    const gate = pause.assertAgentCanWriteInTransaction;
    jest
      .spyOn(pause, "assertAgentCanWriteInTransaction")
      .mockImplementationOnce(async (...args) => {
        await gate(...args);
        reached.release();
        await proceed.promise;
      });
    const revoke = revocation.revokeApiTokens;
    jest
      .spyOn(revocation, "revokeApiTokens")
      .mockImplementationOnce(async (...args) => {
        revokeEntered.release();
        return revoke(...args);
      });
    const claim = server()
      .post(`/api/v1/boards/${board}/commands`)
      .set(auth(pat))
      .send({
        commandId: randomUUID(),
        action: {
          boardId: board,
          at: Date.now(),
          type: "CLAIM_CARD",
          cardId: card,
          claimedBy: "ignored",
          leaseUntil: Date.now() + 60_000,
        },
      })
      .then((res) => res);
    await reached.promise;
    const kill = server()
      .delete(`/api/v1/users/me/tokens/${tokenId}`)
      .set(auth(jwt))
      .then((res) => res);
    try {
      await revokeEntered.promise;
    } finally {
      proceed.release();
    }
    expect((await claim).status).toBe(200);
    expect((await kill).status).toBe(200);
    expect(
      (await db.card.findUniqueOrThrow({ where: { id: card } }))
        .claimedByTokenId,
    ).toBeNull();
  });

  it("preserves the key after an uncertain post-commit failure", async () => {
    const boards = app.get(BoardsService);
    const original = boards.getAggregate.bind(boards);
    jest
      .spyOn(boards, "getAggregate")
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error("after commit");
      });
    const title = `once-${randomUUID()}`;
    const send = () =>
      server()
        .post("/api/v1/boards")
        .set(auth(jwt))
        .set("Idempotency-Key", "review-post-commit-key")
        .send({ title });
    await send().expect(500);
    const retry = await send().expect(409);
    expect(retry.body.code).toBe("idempotency_in_progress");
    expect(await db.board.count({ where: { title } })).toBe(1);
  });

  it("serializes concurrent token edits and validates their final combination", async () => {
    const locked = barrier(),
      release = barrier(),
      calls = barrier();
    const held = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ApiToken" WHERE id = ${tokenId} FOR UPDATE`;
      locked.release();
      await release.promise;
    });
    await locked.promise;
    const service = app.get(ApiTokenService);
    const original = service.update.bind(service);
    let arrived = 0;
    jest.spyOn(service, "update").mockImplementation(async (...args) => {
      arrived++;
      if (arrived === 2) calls.release();
      return original(...args);
    });
    const rename = server()
      .patch(`/api/v1/users/me/tokens/${tokenId}`)
      .set(auth(jwt))
      .send({ name: "renamed" })
      .then((r) => r);
    const restrict = server()
      .patch(`/api/v1/users/me/tokens/${tokenId}`)
      .set(auth(jwt))
      .send({ scopePreset: "observer", trustedCi: false })
      .then((r) => r);
    try {
      await calls.promise;
    } finally {
      release.release();
    }
    await held;
    expect((await rename).status).toBe(200);
    expect((await restrict).status).toBe(200);
    expect(
      await db.apiToken.findUniqueOrThrow({ where: { id: tokenId } }),
    ).toMatchObject({
      name: "renamed",
      scopePreset: "observer",
      trustedCi: false,
    });
  });

  it("rechecks lifecycle policy under the board lock", async () => {
    const service = app.get(ShareService);
    const original = service.create.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest.spyOn(service, "create").mockImplementationOnce(async (...args) => {
      reached.release();
      await proceed.promise;
      return original(...args);
    });
    const write = server()
      .post(`/api/v1/boards/${board}/shares`)
      .set(auth(pat))
      .send({ mode: "live" })
      .then((r) => r);
    try {
      await reached.promise;
      const policy = await server()
        .get(`/api/v1/boards/${board}/agent-policy`)
        .set(auth(jwt))
        .expect(200);
      await server()
        .patch(`/api/v1/boards/${board}/agent-policy`)
        .set(auth(jwt))
        .send({
          version: policy.body.version,
          policy: { ...policy.body.effective, destructive: "deny" },
        })
        .expect(200);
    } finally {
      proceed.release();
    }
    const denied = await write;
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("destructive_denied");
    expect(await db.boardShare.count({ where: { boardId: board } })).toBe(0);
  });

  it("releases an approval when policy changes before the lifecycle write", async () => {
    const agent = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(jwt))
      .send({
        name: randomUUID(),
        scopePreset: "admin",
        trustedCi: false,
        expiresAt: null,
      })
      .expect(201);
    const agentToken = agent.body.token as string;
    const pending = await server()
      .post(`/api/v1/boards/${board}/shares`)
      .set(auth(agentToken))
      .send({ mode: "live" })
      .expect(409);
    await server()
      .post(
        `/api/v1/boards/${board}/approvals/${pending.body.approvalId}/decision`,
      )
      .set(auth(jwt))
      .send({ decision: "approve", planHash: pending.body.planHash })
      .expect(200);
    const service = app.get(ShareService);
    const original = service.create.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest.spyOn(service, "create").mockImplementationOnce(async (...args) => {
      reached.release();
      await proceed.promise;
      return original(...args);
    });
    const write = server()
      .post(`/api/v1/boards/${board}/shares`)
      .set(auth(agentToken))
      .set("X-Approval-Id", pending.body.approvalId as string)
      .send({ mode: "live" })
      .then((r) => r);
    try {
      await reached.promise;
      const policy = await server()
        .get(`/api/v1/boards/${board}/agent-policy`)
        .set(auth(jwt))
        .expect(200);
      await server()
        .patch(`/api/v1/boards/${board}/agent-policy`)
        .set(auth(jwt))
        .send({
          version: policy.body.version,
          policy: { ...policy.body.effective, destructive: "deny" },
        })
        .expect(200);
    } finally {
      proceed.release();
    }
    expect((await write).body.code).toBe("destructive_denied");
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: pending.body.approvalId as string },
        })
      ).status,
    ).toBe("approved");
    expect(await db.boardShare.count({ where: { boardId: board } })).toBe(0);
  });

  it("releases an idempotency key after approval is required", async () => {
    const agent = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(jwt))
      .send({
        name: randomUUID(),
        scopePreset: "admin",
        trustedCi: false,
        expiresAt: null,
      })
      .expect(201);
    const agentToken = agent.body.token as string;
    const send = () =>
      server()
        .post(`/api/v1/boards/${board}/shares`)
        .set(auth(agentToken))
        .set("Idempotency-Key", "approval-before-write-key")
        .send({ mode: "live" });
    const pending = await send().expect(409);
    expect(pending.body.code).toBe("approval_required");
    await server()
      .post(
        `/api/v1/boards/${board}/approvals/${pending.body.approvalId}/decision`,
      )
      .set(auth(jwt))
      .send({ decision: "approve", planHash: pending.body.planHash })
      .expect(200);
    await send()
      .set("X-Approval-Id", pending.body.approvalId as string)
      .expect(201);
    expect(await db.boardShare.count({ where: { boardId: board } })).toBe(1);
  });

  it("rechecks token pause before creating a board", async () => {
    const service = app.get(BoardsService);
    const original = service.createBoard.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest
      .spyOn(service, "createBoard")
      .mockImplementationOnce(async (...args) => {
        reached.release();
        await proceed.promise;
        return original(...args);
      });
    const title = `paused-${randomUUID()}`;
    const write = server()
      .post("/api/v1/boards")
      .set(auth(pat))
      .send({ title })
      .then((r) => r);
    try {
      await reached.promise;
      await server()
        .post(`/api/v1/users/me/tokens/${tokenId}/pause`)
        .set(auth(jwt))
        .send({})
        .expect(200);
    } finally {
      proceed.release();
    }
    const denied = await write;
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("agent_paused");
    expect(await db.board.count({ where: { title } })).toBe(0);
  });

  it("rechecks token pause before importing boards", async () => {
    const exported = await server()
      .get(`/api/v1/boards/${board}/export`)
      .set(auth(jwt))
      .expect(200);
    const service = app.get(BoardsService);
    const original = service.importBoards.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest
      .spyOn(service, "importBoards")
      .mockImplementationOnce(async (...args) => {
        reached.release();
        await proceed.promise;
        return original(...args);
      });
    const before = await db.board.count();
    const write = server()
      .post("/api/v1/boards/import")
      .set(auth(pat))
      .send(exported.body)
      .then((r) => r);
    try {
      await reached.promise;
      await server()
        .post(`/api/v1/users/me/tokens/${tokenId}/pause`)
        .set(auth(jwt))
        .send({})
        .expect(200);
    } finally {
      proceed.release();
    }
    const denied = await write;
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("agent_paused");
    expect(await db.board.count()).toBe(before);
  });

  it("rejects a queued account write when token permissions change", async () => {
    const service = app.get(BoardsService);
    const original = service.createBoard.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest
      .spyOn(service, "createBoard")
      .mockImplementationOnce(async (...args) => {
        reached.release();
        await proceed.promise;
        return original(...args);
      });
    const title = `restricted-${randomUUID()}`;
    const write = server()
      .post("/api/v1/boards")
      .set(auth(pat))
      .send({ title })
      .then((r) => r);
    try {
      await reached.promise;
      await server()
        .patch(`/api/v1/users/me/tokens/${tokenId}`)
        .set(auth(jwt))
        .send({ scopePreset: "observer", trustedCi: false })
        .expect(200);
    } finally {
      proceed.release();
    }
    const denied = await write;
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("scope_denied");
    expect(await db.board.count({ where: { title } })).toBe(0);
  });

  it("rechecks board pause before refreshing a snapshot", async () => {
    const share = (
      await server()
        .post(`/api/v1/boards/${board}/shares`)
        .set(auth(jwt))
        .send({ mode: "snapshot" })
        .expect(201)
    ).body;
    const before = await db.boardShare.findUniqueOrThrow({
      where: { id: share.id as string },
    });
    const service = app.get(ShareService);
    const original = service.refreshSnapshot.bind(service);
    const reached = barrier(),
      proceed = barrier();
    jest
      .spyOn(service, "refreshSnapshot")
      .mockImplementationOnce(async (...args) => {
        reached.release();
        await proceed.promise;
        return original(...args);
      });
    const write = server()
      .post(`/api/v1/boards/${board}/shares/${share.id}/refresh`)
      .set(auth(pat))
      .send({})
      .then((r) => r);
    try {
      await reached.promise;
      await server()
        .post(`/api/v1/boards/${board}/agents/pause`)
        .set(auth(jwt))
        .send({})
        .expect(200);
    } finally {
      proceed.release();
    }
    const denied = await write;
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("agent_paused");
    expect(
      (
        await db.boardShare.findUniqueOrThrow({
          where: { id: share.id as string },
        })
      ).snapshot,
    ).toEqual(before.snapshot);
  });

  it("releases approval if another actor removes the attachment first", async () => {
    const card = await cardOnBoard();
    const writer = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(jwt))
      .send({ name: randomUUID(), scopePreset: "worker", expiresAt: null })
      .expect(201);
    const attachment = await server()
      .post(`/api/v1/cards/${card}/attachments`)
      .set(auth(writer.body.token as string))
      .attach("file", Buffer.from("example"), "example.txt")
      .expect(201);
    const agent = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(jwt))
      .send({
        name: randomUUID(),
        scopePreset: "admin",
        trustedCi: false,
        expiresAt: null,
      })
      .expect(201);
    const agentToken = agent.body.token as string;
    const url = `/api/v1/attachments/${attachment.body.id}`;
    const pending = await server()
      .delete(url)
      .set(auth(agentToken))
      .expect(409);
    await server()
      .post(
        `/api/v1/boards/${board}/approvals/${pending.body.approvalId}/decision`,
      )
      .set(auth(jwt))
      .send({ decision: "approve", planHash: pending.body.planHash })
      .expect(200);
    const approvals = app.get(ApprovalsService);
    const original = approvals.performOperation.bind(approvals);
    const reached = barrier(),
      proceed = barrier();
    jest
      .spyOn(approvals, "performOperation")
      .mockImplementationOnce(async (...args) => {
        reached.release();
        await proceed.promise;
        return original(...args);
      });
    const write = server()
      .delete(url)
      .set(auth(agentToken))
      .set("X-Approval-Id", pending.body.approvalId as string)
      .then((r) => r);
    try {
      await reached.promise;
      await server().delete(url).set(auth(jwt)).expect(200);
    } finally {
      proceed.release();
    }
    expect((await write).status).toBe(404);
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: pending.body.approvalId as string },
        })
      ).status,
    ).toBe("approved");
  });
});
