import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import type { ReadableStreamReadResult } from "node:stream/web";
import request from "supertest";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { CardAccessGuard } from "@/common/card-access.guard";
import {
  HOT_PATH_CACHE_CONFIG,
  type HotPathCacheConfig,
} from "@/common/hot-path-cache.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import { sseTiming } from "@/realtime/sse-timing";
import { wipeAll } from "./support/wipe";

const OWNER_EMAIL = "cache-owner@example.com";
const MEMBER_EMAIL = "cache-member@example.com";
const PASSWORD = "correct horse battery";
/** Long enough for the "immediate" assertions, short enough for the wait. */
const CACHE_TTL_MS = 3000;

interface SseFrame {
  type?: string;
  op?: string;
  users?: unknown[];
}

/**
 * TASK-200.5 end-to-end: PAT/membership/flag TTL caches and the agent SSE
 * default. The config provider is overridden to a 3 s window (tests normally
 * run with caches off), so each case exercises the real guard/service path.
 */
describe("Auth hot-path caches + SSE presence (e2e, TASK-200.5)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let ownerToken: string;
  let memberToken: string;
  let memberId: string;
  let boardId: string;

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HOT_PATH_CACHE_CONFIG)
      .useValue({
        patTtlMs: CACHE_TTL_MS,
        membershipTtlMs: CACHE_TTL_MS,
        streamMembershipTtlMs: CACHE_TTL_MS,
        flagsTtlMs: CACHE_TTL_MS,
        patMaxEntries: 100,
        membershipMaxEntries: 100,
        streamMembershipMaxEntries: 100,
        flagsMaxEntries: 10,
      } satisfies HotPathCacheConfig)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    await wipeAll(prisma);

    const owner = await register(OWNER_EMAIL, "Owner");
    ownerToken = owner.accessToken;
    const member = await register(MEMBER_EMAIL, "Member");
    memberToken = member.accessToken;
    memberId = member.userId;

    const created = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Cache board" })
      .expect(201);
    boardId = created.body.id as string;

    await server()
      .post(`/api/v1/boards/${boardId}/members`)
      .set(auth(ownerToken))
      .send({ email: MEMBER_EMAIL, role: "VIEWER" })
      .expect(201);
    const invitations = await server()
      .get("/api/v1/invitations")
      .set(auth(memberToken))
      .expect(200);
    const invitation = (
      invitations.body as Array<{ id: string; boardId: string }>
    ).find((row) => row.boardId === boardId);
    await server()
      .post(`/api/v1/invitations/${invitation!.id}/accept`)
      .set(auth(memberToken))
      .expect(200);
  });

  afterAll(async () => {
    await wipeAll(prisma);
    await app.close();
  });

  async function register(
    email: string,
    displayName: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const response = await server()
      .post("/api/v1/auth/register")
      .send({ email, password: PASSWORD, displayName })
      .expect(201);
    return {
      accessToken: response.body.accessToken as string,
      userId: response.body.user.id as string,
    };
  }

  async function createPat(
    ownerSession: string,
    name: string,
  ): Promise<{ token: string; id: string }> {
    const response = await server()
      .post("/api/v1/users/me/tokens")
      .set(auth(ownerSession))
      .send({ name, expiresAt: null, scopePreset: "worker" })
      .expect(201);
    return {
      token: response.body.token as string,
      id: response.body.apiToken.id as string,
    };
  }

  function readToken(token: string) {
    return server().get(`/api/v1/boards/${boardId}`).set(auth(token));
  }

  async function boardSeq(): Promise<number> {
    const response = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(ownerToken))
      .expect(200);
    return Number(response.headers["x-board-seq"]);
  }

  it("boots the real application with the card access guard resolved", () => {
    // A `import type` on HotPathCacheService would leave Nest without a
    // runtime constructor token here; resolving the guard proves the module
    // graph, not just TypeScript, is intact.
    expect(app.get(CardAccessGuard)).toBeInstanceOf(CardAccessGuard);
  });

  it("invalidates a membership snapshot the moment a role changes", async () => {
    // Warm the cache as VIEWER: the ADMIN-only share directory answers 403
    // but the resolved membership is remembered.
    await server()
      .get(`/api/v1/boards/${boardId}/shares`)
      .set(auth(memberToken))
      .expect(403);
    await server()
      .patch(`/api/v1/boards/${boardId}/members/${memberId}`)
      .set(auth(ownerToken))
      .send({ role: "ADMIN" })
      .expect(200);

    // Without the realtime invalidation this would still be the cached
    // VIEWER row for the next 3 s.
    await server()
      .get(`/api/v1/boards/${boardId}/shares`)
      .set(auth(memberToken))
      .expect(200);
  });

  it("keeps a revoked PAT valid only until its bounded TTL", async () => {
    const pat = await createPat(memberToken, "ttl");
    await readToken(pat.token).expect(200);

    // Revoke below the service, bypassing the invalidation bus: only the
    // window can protect the cached entry.
    await prisma.apiToken.update({
      where: { id: pat.id },
      data: { revokedAt: new Date() },
    });
    await readToken(pat.token).expect(200);

    await new Promise((resolve) => setTimeout(resolve, CACHE_TTL_MS + 200));
    await readToken(pat.token).expect(401);
  }, 20_000);

  it("makes an API revoke visible immediately through the bus", async () => {
    const pat = await createPat(memberToken, "revoked");
    await readToken(pat.token).expect(200);

    await server()
      .delete(`/api/v1/users/me/tokens/${pat.id}`)
      .set(auth(memberToken))
      .expect(200);

    // No wait: the local invalidation ran before the response.
    await readToken(pat.token).expect(401);
  });

  it("applies a board pause to the next PAT write immediately", async () => {
    const pat = await createPat(memberToken, "paused");
    await readToken(pat.token).expect(200);

    await server()
      .post(`/api/v1/boards/${boardId}/agents/pause`)
      .set(auth(ownerToken))
      .send({ reason: "e2e pause" })
      .expect(200);

    try {
      const blocked = await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth(pat.token))
        .send({
          commandId: randomUUID(),
          action: { type: "ADD_COLUMN", newColumnId: "never", title: "Never" },
        });
      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({ code: "agent_paused" });
    } finally {
      await server()
        .post(`/api/v1/boards/${boardId}/agents/resume`)
        .set(auth(ownerToken))
        .send({})
        .expect(200);
    }
  });

  it("defaults a PAT stream to no presence and a JWT stream to presence", async () => {
    const ownerPat = await createPat(ownerToken, "streamer");
    const ownerPatStream = await openStream(ownerPat.token, await boardSeq());
    const humanStream = await openStream(ownerToken, await boardSeq());
    const optedIn = await openStream(
      ownerPat.token,
      await boardSeq(),
      "presence=1",
    );
    try {
      // A human stream keeps the historical default: a presence sync.
      const humanFrame = await humanStream.next("presence");
      expect(humanFrame).toMatchObject({ type: "presence", op: "sync" });

      // A PAT stream defaults to presence=0 — no sync, no roster — but it is
      // still a working command stream.
      await server()
        .post(`/api/v1/boards/${boardId}/commands`)
        .set(auth(ownerToken))
        .send({
          commandId: randomUUID(),
          action: {
            type: "ADD_COLUMN",
            newColumnId: "col-sse-default",
            title: "SSE default",
            at: Date.now(),
          },
        })
        .expect(200);
      const patCommand = await ownerPatStream.next("command");
      expect(patCommand.type).toBe("command");
      expect(
        ownerPatStream.frames.some((frame) => frame.type === "presence"),
      ).toBe(false);

      // `?presence=1` opts an agent stream back in.
      const explicit = await optedIn.next("presence");
      expect(explicit).toMatchObject({ type: "presence", op: "sync" });
    } finally {
      await Promise.all([
        ownerPatStream.close(),
        humanStream.close(),
        optedIn.close(),
      ]);
    }
  });

  it("invalidates a feature-flag row on update", async () => {
    const flags = app.get(FeatureFlagsService);
    await expect(flags.isEnabled("realtime_sse")).resolves.toBe(true);
    await flags.update("realtime_sse", { enabled: false }, "e2e-admin");
    await expect(flags.isEnabled("realtime_sse")).resolves.toBe(false);
    await flags.update("realtime_sse", { enabled: true }, "e2e-admin");
    await expect(flags.isEnabled("realtime_sse")).resolves.toBe(true);
  });

  it("denies a removed member on the next read, despite the snapshot", async () => {
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(memberToken))
      .expect(200);
    await server()
      .delete(`/api/v1/boards/${boardId}/members/${memberId}`)
      .set(auth(ownerToken))
      .expect(200);
    await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(memberToken))
      .expect(403);
  });

  it("closes an open stream and drops PATs immediately after a password change", async () => {
    const ownerPat = await createPat(ownerToken, "pre-password-change");
    await server().get("/api/v1/auth/me").set(auth(ownerPat.token)).expect(200);

    const previous = sseTiming.keepAliveMs;
    sseTiming.keepAliveMs = 100;
    const stream = await openStream(ownerToken, await boardSeq());
    try {
      await stream.next("presence");
      await server()
        .post("/api/v1/auth/password")
        .set(auth(ownerToken))
        .send({
          currentPassword: PASSWORD,
          newPassword: "new correct horse battery",
        })
        .expect(200);

      // The 100 ms tick reads the fresh password hash and closes the stream.
      await expect(stream.ended(5000)).resolves.toBe(true);
      // AuthService invalidated the PAT cache in the same operation.
      await server()
        .get("/api/v1/auth/me")
        .set(auth(ownerPat.token))
        .expect(401);
    } finally {
      sseTiming.keepAliveMs = previous;
      await stream.close();
    }
  }, 20_000);

  // ------------------------------------------------------------------ SSE

  async function openStream(
    token: string,
    since: number,
    extra = "",
  ): Promise<{
    frames: SseFrame[];
    next: (type: string) => Promise<SseFrame>;
    ended: (timeoutMs?: number) => Promise<boolean>;
    close: () => Promise<void>;
  }> {
    const query = `since=${since}${extra === "" ? "" : `&${extra}`}`;
    const response = await fetch(
      `${baseUrl}/boards/${boardId}/events?${query}`,
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    const frames: SseFrame[] = [];
    let buffer = "";
    let closed = false;

    const parse = (): void => {
      for (;;) {
        const separator = buffer.indexOf("\n\n");
        if (separator === -1) return;
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "ping") continue;
          try {
            frames.push(JSON.parse(payload) as SseFrame);
          } catch {
            /* a comment/partial frame */
          }
        }
      }
    };

    const next = async (type: string, timeoutMs = 8000): Promise<SseFrame> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = frames.find((frame) => frame.type === type);
        if (found !== undefined) return found;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(
            `Timed out waiting for ${type}; got ${JSON.stringify(frames)}`,
          );
        }
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) throw new Error(`Stream ended before ${type}`);
        buffer += decoder.decode(chunk.value, { stream: true });
        parse();
      }
    };

    return {
      frames,
      next,
      ended: async (timeoutMs = 8000): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return false;
          try {
            const chunk = await readWithTimeout(reader, remaining);
            if (chunk.done) return true;
            buffer += decoder.decode(chunk.value, { stream: true });
            parse();
          } catch {
            return false;
          }
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await reader.cancel().catch(() => undefined);
      },
    };
  }
});

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for SSE data")),
      ms,
    );
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
