import { INestApplication } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import type {
  Board,
  CreateUserTokenResponse,
  UserTokenDto,
} from "@janosik/shared";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "token-edit-owner@example.com";
const OTHER_EMAIL = "token-edit-other@example.com";
const PASSWORD = "correct horse battery";

/**
 * TASK-166.15 `PATCH /users/me/tokens/:id`: the owner edits the
 * human-facing scope/limits from a browser session. The secret never appears
 * in the response, a PAT is refused with `pat_forbidden`, another user's
 * token is `404`, and the change is audited.
 */
describe("API token owner edit (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerSession: string;
  let otherSession: string;
  let boardId: string;
  let otherBoardId: string;
  let tokenId: string;
  let pat: string;

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
    otherSession = (await register(OTHER_EMAIL, "Other")).accessToken;
    boardId = await createBoard(ownerSession, "Owner board");
    otherBoardId = await createBoard(otherSession, "Other board");
    const created = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerSession))
      .send({
        name: "editable key",
        expiresAt: null,
        scopePreset: "worker",
        boardId: null,
        readOnly: false,
        trustedCi: false,
        rateLimitPerMinute: 120,
      })
      .expect(201);
    const body = created.body as CreateUserTokenResponse;
    tokenId = body.apiToken.id;
    pat = body.token;
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

  function createBoard(session: string, title: string): Promise<string> {
    return server()
      .post("/api/v1/boards")
      .set(auth(session))
      .send({ title })
      .expect(201)
      .then((res) => (res.body as Board).id);
  }

  function patch(body: object, session = ownerSession, id = tokenId) {
    return server()
      .patch(`/api/v1/users/me/tokens/${id}`)
      .set(auth(session))
      .send(body);
  }

  it("edits scope, board scope and rate limit without returning a secret", async () => {
    const response = await patch({
      name: "renamed key",
      boardId,
      scopePreset: "reviewer",
      trustedCi: true,
      readOnly: false,
      rateLimitPerMinute: 250,
    }).expect(200);
    const updated = response.body as UserTokenDto;
    expect(updated).toMatchObject({
      id: tokenId,
      name: "renamed key",
      boardId,
      scopePreset: "reviewer",
      trustedCi: true,
      readOnly: false,
      rateLimitPerMinute: 250,
      effectiveTokenScope: "reviewer",
    });
    expect(JSON.stringify(response.body)).not.toContain(pat);
    expect(response.body).not.toHaveProperty("tokenHash");

    const listed = await server()
      .get("/api/v1/users/me/tokens")
      .set(auth(ownerSession))
      .expect(200);
    expect(
      (listed.body as UserTokenDto[]).find((token) => token.id === tokenId),
    ).toMatchObject({
      name: "renamed key",
      scopePreset: "reviewer",
      boardId,
      rateLimitPerMinute: 250,
    });

    const audit = await prisma.securityAuditLog.findFirst({
      where: { action: "token.updated", targetId: tokenId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).toMatchObject({
      after: { name: "renamed key", scopePreset: "reviewer" },
    });
  });

  it("clears the board scope and rate limit with explicit nulls", async () => {
    const response = await patch({
      boardId: null,
      rateLimitPerMinute: null,
    }).expect(200);
    expect(response.body).toMatchObject({
      boardId: null,
      rateLimitPerMinute: null,
      // Omitted fields keep their value.
      scopePreset: "reviewer",
      name: "renamed key",
    });
  });

  it("rejects trusted CI for an Observer/read-only key", async () => {
    await patch({ scopePreset: "observer", trustedCi: true }).expect(400);
    await patch({ readOnly: true, trustedCi: true }).expect(400);
    // Turning read-only on while trustedCi is already true is refused too.
    await patch({ trustedCi: true }).expect(200);
    await patch({ readOnly: true }).expect(400);
    await patch({ readOnly: true, trustedCi: false }).expect(200);
  });

  it("validates the board scope and rate bounds", async () => {
    const foreign = await patch({ boardId: otherBoardId });
    expect(foreign.status).toBe(400);
    expect((foreign.body as { field?: string }).field).toBe("boardId");
    await patch({ boardId: "missing-board" }).expect(400);
    await patch({ rateLimitPerMinute: 0 }).expect(400);
    await patch({ rateLimitPerMinute: 100_001 }).expect(400);
  });

  it("is session-only and owner-only", async () => {
    // Restore a writable token: a read-only PAT is refused earlier by the
    // read-only gate (`pat_read_only`), while a normal PAT must reach the
    // session-only refusal this route promises.
    await patch({ readOnly: false, trustedCi: false }).expect(200);
    const denied = await patch({ name: "agent edit" }, pat);
    expect(denied.status).toBe(403);
    expect((denied.body as { code?: string }).code).toBe("pat_forbidden");

    await patch({ name: "stolen" }, otherSession).expect(404);
  });

  it("refuses to edit a revoked token", async () => {
    await server()
      .delete(`/api/v1/users/me/tokens/${tokenId}`)
      .set(auth(ownerSession))
      .expect(200);
    const response = await patch({ name: "after revoke" });
    expect(response.status).toBe(409);
    expect((response.body as { code?: string }).code).toBe("token_revoked");
  });
});
