import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { AddressInfo } from "node:net";
import type { ReadableStreamReadResult } from "node:stream/web";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";

const OWNER_EMAIL = "events-owner@example.com";
const MEMBER_EMAIL = "events-member@example.com";
const VIEWER_EMAIL = "events-viewer@example.com";
const OUTSIDER_EMAIL = "events-outsider@example.com";
const PENDING_EMAIL = "events-pending@example.com";
const PASSWORD = "correct horse battery";

interface SseFrame {
  type: string;
  seq?: number;
  actorId?: string;
  action?: { type: string };
  touches?: string[];
  users?: { id: string; displayName: string; avatarColor: string | null }[];
  boardId?: string;
  userId?: string;
  change?: string;
  /** Activity frames (TASK-37). */
  id?: string;
  cardId?: string;
  kind?: string;
  detail?: string;
}

/**
 * Board events over SSE (TASK-30).
 *
 * The stream carries committed commands as `{type:"command", seq, action,
 * actorId}`; a client resumes from its last applied seq via `?since=` and
 * receives the missed delta before live events — exactly once, in order.
 * Since TASK-36 it also carries `presence` rosters (no seq, not buffered):
 * every connection receives one on join, changes and a 30 s heartbeat.
 */
describe("Board events SSE (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let ownerToken: string;
  let memberToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let pendingToken: string;
  let ownerId: string;
  let memberId: string;
  let boardId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    prisma = app.get(PrismaService);
    await wipe(prisma);

    const owner = await register(OWNER_EMAIL, "Owner");
    ownerToken = owner.accessToken;
    ownerId = owner.id;
    const member = await register(MEMBER_EMAIL, "Member");
    memberToken = member.accessToken;
    memberId = member.id;
    viewerToken = (await register(VIEWER_EMAIL, "Viewer")).accessToken;
    outsiderToken = (await register(OUTSIDER_EMAIL, "Outsider")).accessToken;
    pendingToken = (await register(PENDING_EMAIL, "Pending")).accessToken;

    const created = await server()
      .post("/api/v1/boards")
      .set(auth(ownerToken))
      .send({ title: "Events board" })
      .expect(201);
    boardId = created.body.id as string;

    await invite(boardId, MEMBER_EMAIL, "MEMBER");
    await accept(await invitationId(memberToken), memberToken);
    await invite(boardId, VIEWER_EMAIL, "VIEWER");
    await accept(await invitationId(viewerToken), viewerToken);
    await invite(boardId, PENDING_EMAIL, "MEMBER");
  });

  afterAll(async () => {
    await wipe(prisma);
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

  async function invite(
    board: string,
    email: string,
    role: "ADMIN" | "MEMBER" | "VIEWER",
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${board}/members`)
      .set(auth(ownerToken))
      .send({ email, role })
      .expect(201);
  }

  /** The invitee's pending invitation id for this board. */
  async function invitationId(token: string): Promise<string> {
    const res = await server()
      .get("/api/v1/invitations")
      .set(auth(token))
      .expect(200);
    const row = (res.body as Array<{ id: string; boardId: string }>).find(
      (entry) => entry.boardId === boardId,
    );
    if (!row) throw new Error("No invitation found");
    return row.id;
  }

  async function accept(invitationId: string, token: string): Promise<void> {
    await server()
      .post(`/api/v1/invitations/${invitationId}/accept`)
      .set(auth(token))
      .expect(200);
  }

  /** The seq the aggregate reflects (`X-Board-Seq`), the stream baseline. */
  async function boardSeq(token: string): Promise<number> {
    const res = await server()
      .get(`/api/v1/boards/${boardId}`)
      .set(auth(token))
      .expect(200);
    return Number(res.headers["x-board-seq"]);
  }

  /** `POST /boards/:id/commands` — returns the committed seq. */
  async function command(
    token: string,
    action: Record<string, unknown>,
    commandId: string,
  ): Promise<number> {
    const res = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(token))
      .send({ commandId, action });
    if (res.status !== 200) {
      throw new Error(
        `Command rejected (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.seq as number;
  }

  async function openStream(
    token: string | null,
    since: number,
    clientId?: string,
  ): Promise<Response> {
    const client = clientId === undefined ? "" : `&client=${clientId}`;
    return fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}${client}`,
      {
        headers: {
          Accept: "text/event-stream",
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
      },
    );
  }

  /** An SSE reader that survives several `next()` calls (presence tests). */
  function openReader(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let closed = false;
    /** Frames of other types already parsed — kept for a later `next`. */
    const pending: SseFrame[] = [];

    /** Move up to `count` parked frames of `type` back into the result. */
    const takePending = (count: number, type: string): SseFrame[] => {
      const taken: SseFrame[] = [];
      for (let i = 0; i < pending.length && taken.length < count;) {
        if (pending[i].type === type) {
          taken.push(pending.splice(i, 1)[0]);
        } else {
          i += 1;
        }
      }
      return taken;
    };

    const next = async (
      count: number,
      type = "command",
      timeoutMs = 12_000,
    ): Promise<SseFrame[]> => {
      const frames: SseFrame[] = takePending(count, type);
      const deadline = Date.now() + timeoutMs;
      while (frames.length < count) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(
            `Timed out: got ${frames.length}/${count} ${type} frames (${JSON.stringify(frames)})`,
          );
        }
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) {
          throw new Error(
            `Stream ended after ${frames.length}/${count} frames`,
          );
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        for (;;) {
          const separator = buffer.indexOf("\n\n");
          if (separator === -1) break;
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "ping") continue;
            const frame = JSON.parse(payload) as SseFrame;
            if (frame.type === type) frames.push(frame);
            else pending.push(frame);
          }
        }
      }
      return frames;
    };

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await reader.cancel().catch(() => undefined);
      await response.body?.cancel().catch(() => undefined);
    };

    /** Drain until the server ends the stream (or the timeout runs out). */
    const ended = async (timeoutMs = 12_000): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) return true;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    return { next, close, ended };
  }

  /** Read `count` frames of one type from an SSE response, then close it. */
  async function readFrames(
    response: Response,
    count: number,
    type = "command",
    timeoutMs = 12_000,
  ): Promise<SseFrame[]> {
    const stream = openReader(response);
    try {
      return await stream.next(count, type, timeoutMs);
    } finally {
      await stream.close();
    }
  }

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

  it("reports the aggregate's seq in X-Board-Seq", async () => {
    const before = await boardSeq(ownerToken);
    const seq = await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: "col-live",
        title: "Live",
        at: Date.now(),
      },
      "evt-cmd-1",
    );
    expect(seq).toBeGreaterThan(before);
    expect(await boardSeq(ownerToken)).toBe(seq);
  });

  it("streams committed commands to a member, in order", async () => {
    const baseline = await boardSeq(ownerToken);
    const response = await openStream(memberToken, baseline);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    // TASK-38a: the stream tells nginx not to buffer, so realtime works
    // behind a default proxy (a buffered stream would freeze silently).
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    // Commands committed after the stream opened — live delivery.
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: "card-live",
        columnId: "col-live",
        title: "Live card",
        at: Date.now(),
      },
      "evt-cmd-2",
    );
    await command(
      ownerToken,
      {
        type: "RENAME_COLUMN",
        columnId: "col-live",
        title: "Renamed",
        at: Date.now(),
      },
      "evt-cmd-3",
    );

    const frames = await readFrames(response, 2);
    expect(frames.map((frame) => frame.seq)).toEqual([
      baseline + 1,
      baseline + 2,
    ]);
    expect(frames.map((frame) => frame.type)).toEqual(["command", "command"]);
    expect(frames[0].action?.type).toBe("ADD_CARD");
    expect(frames[0].actorId).toBe(ownerId);
    // `touches` (TASK-30.1): the entities the command wrote, so subscribers
    // mark their undo history foreign without diffing the board.
    expect(frames[0].touches).toContain(`card:card-live`);
    expect(frames[0].touches).toContain(`board:${boardId}`);
    expect(frames[1].touches).toContain(`column:col-live`);
  }, 20_000);

  it("broadcasts comment activity frames: added and deleted (TASK-37)", async () => {
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: "col-comment",
        title: "Comments",
        at: Date.now(),
      },
      "evt-cmd-comment-1",
    );
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: "card-comment",
        columnId: "col-comment",
        title: "Commented",
        at: Date.now(),
      },
      "evt-cmd-comment-2",
    );
    const baseline = await boardSeq(ownerToken);
    const reader = openReader(await openStream(memberToken, baseline));

    const created = await server()
      .post("/api/v1/cards/card-comment/comments")
      .set(auth(memberToken))
      .send({ text: "Live note" })
      .expect(201);
    const [added] = await reader.next(1, "activity");
    expect(added).toMatchObject({
      type: "activity",
      boardId,
      cardId: "card-comment",
      actorId: memberId,
      kind: "comment_added",
      detail: created.body.id,
    });

    await server()
      .delete(`/api/v1/comments/${created.body.id}`)
      .set(auth(memberToken))
      .expect(200);
    const [removed] = await reader.next(1, "activity");
    expect(removed).toMatchObject({
      type: "activity",
      kind: "comment_deleted",
      detail: created.body.id,
      actorId: memberId,
    });
    await reader.close();
  }, 20_000);

  it("catches up the missed delta before going live", async () => {
    const baseline = await boardSeq(ownerToken);
    // Nothing is connected here: these two commands are the "gap".
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: "card-gap",
        columnId: "col-live",
        title: "Gap card",
        at: Date.now(),
      },
      "evt-cmd-4",
    );
    await command(
      ownerToken,
      {
        type: "RENAME_COLUMN",
        columnId: "col-live",
        title: "After gap",
        at: Date.now(),
      },
      "evt-cmd-5",
    );

    const response = await openStream(memberToken, baseline);
    const frames = await readFrames(response, 2);
    expect(frames.map((frame) => frame.seq)).toEqual([
      baseline + 1,
      baseline + 2,
    ]);
    expect(frames[0].action?.type).toBe("ADD_CARD");
    // The catch-up delta carries the same `touches` contract as live frames.
    expect(frames[0].touches).toContain(`card:card-gap`);
  }, 20_000);

  it("broadcasts presence: join, dedup across tabs, leave", async () => {
    const baseline = await boardSeq(ownerToken);
    const owner1 = openReader(
      await openStream(ownerToken, baseline, "tab-owner-1"),
    );
    const first = await owner1.next(1, "presence");
    expect(first[0].users).toEqual([
      {
        id: ownerId,
        displayName: "Owner",
        avatarColor: null,
        avatarPath: null,
      },
    ]);

    const memberStream = openReader(
      await openStream(memberToken, baseline, "tab-member-1"),
    );
    const memberSees = await memberStream.next(1, "presence");
    expect(memberSees[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);
    const ownerSees = await owner1.next(1, "presence");
    expect(ownerSees[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);

    // A second tab of the same user broadcasts again but lists them once.
    const owner2 = openReader(
      await openStream(ownerToken, baseline, "tab-owner-2"),
    );
    const owner2Sees = await owner2.next(1, "presence");
    expect(owner2Sees[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);
    const memberAgain = await memberStream.next(1, "presence");
    expect(memberAgain[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);

    // Closing one tab keeps the user on the roster; the last one removes them.
    await owner1.close();
    await owner2.close();
    const afterLeave = await memberStream.next(1, "presence");
    expect(afterLeave[0].users?.map((user) => user.id)).toEqual([memberId]);
    await memberStream.close();
  }, 30_000);

  it("carries the chosen avatar color on the roster", async () => {
    await server()
      .patch("/api/v1/users/me")
      .set(auth(ownerToken))
      .send({ avatarColor: "orange" })
      .expect(200);

    const stream = openReader(
      await openStream(ownerToken, await boardSeq(ownerToken), "color-tab-1"),
    );
    const frames = await stream.next(1, "presence");
    expect(frames[0].users).toEqual([
      {
        id: ownerId,
        displayName: "Owner",
        avatarColor: "orange",
        avatarPath: null,
      },
    ]);
    await stream.close();
  }, 20_000);

  it("propagates a profile change to every open tab and member list", async () => {
    const baseline = await boardSeq(ownerToken);
    const ownerStream = openReader(
      await openStream(ownerToken, baseline, "rename-owner-1"),
    );
    const memberStream = openReader(
      await openStream(memberToken, baseline, "rename-member-1"),
    );
    await ownerStream.next(1, "presence");
    await memberStream.next(1, "presence");
    // The owner also sees the member join — drain it, so the next roster
    // frame on both streams is the one the profile change produces.
    await ownerStream.next(1, "presence");

    await server()
      .patch("/api/v1/users/me")
      .set(auth(ownerToken))
      .send({ displayName: "Renamed Owner", avatarColor: "teal" })
      .expect(200);

    // The roster is rewritten in place — no reconnect — for both sides.
    const ownerRoster = await ownerStream.next(1, "presence");
    expect(ownerRoster[0].users).toContainEqual({
      id: ownerId,
      displayName: "Renamed Owner",
      avatarColor: "teal",
      avatarPath: null,
    });
    const memberRoster = await memberStream.next(1, "presence");
    expect(memberRoster[0].users).toContainEqual({
      id: ownerId,
      displayName: "Renamed Owner",
      avatarColor: "teal",
      avatarPath: null,
    });

    // And every open member list re-reads the directory.
    const ownerMembership = await ownerStream.next(1, "membership");
    expect(ownerMembership[0]).toMatchObject({
      boardId,
      userId: ownerId,
      change: "updated",
    });
    const memberMembership = await memberStream.next(1, "membership");
    expect(memberMembership[0]).toMatchObject({
      boardId,
      userId: ownerId,
      change: "updated",
    });

    await ownerStream.close();
    await memberStream.close();
  }, 20_000);

  it("accepts a presence heartbeat for open sessions only", async () => {
    const baseline = await boardSeq(ownerToken);
    const stream = openReader(
      await openStream(ownerToken, baseline, "ping-client-1"),
    );
    await stream.next(1, "presence");

    await server()
      .post(`/api/v1/boards/${boardId}/presence`)
      .set(auth(ownerToken))
      .send({ clientId: "ping-client-1" })
      .expect(204);

    // Unknown sessions are no-ops: a ping never conjures a presence entry.
    await server()
      .post(`/api/v1/boards/${boardId}/presence`)
      .set(auth(ownerToken))
      .send({ clientId: "unknown-session-1" })
      .expect(204);

    // The id shape is validated strictly.
    await server()
      .post(`/api/v1/boards/${boardId}/presence`)
      .set(auth(ownerToken))
      .send({ clientId: "no" })
      .expect(400);

    // Non-members cannot heartbeat into someone else's board.
    await server()
      .post(`/api/v1/boards/${boardId}/presence`)
      .set(auth(outsiderToken))
      .send({ clientId: "ping-outsider-1" })
      .expect(403);

    await stream.close();
  }, 20_000);

  it("lets a VIEWER watch the stream but not post commands", async () => {
    const response = await openStream(viewerToken, await boardSeq(ownerToken));
    expect(response.status).toBe(200);
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(viewerToken))
      .send({
        commandId: "evt-cmd-viewer",
        action: {
          type: "ADD_COLUMN",
          newColumnId: "col-viewer",
          title: "Nope",
          at: Date.now(),
        },
      })
      .expect(403);
    await response.body?.cancel().catch(() => undefined);
  });

  it("rejects the stream without a token, for outsiders and pending invites", async () => {
    const anonymous = await openStream(null, 0);
    expect(anonymous.status).toBe(401);

    const outsider = await openStream(outsiderToken, 0);
    expect(outsider.status).toBe(403);

    const pending = await openStream(pendingToken, 0);
    expect(pending.status).toBe(403);
  });

  it("rejects a garbage since value", async () => {
    const res = await fetch(`${baseUrl}/boards/${boardId}/events?since=hello`, {
      headers: auth(ownerToken),
    });
    expect(res.status).toBe(400);
    await res.body?.cancel().catch(() => undefined);
  });

  it("announces an accepted invitation on the board's streams", async () => {
    const stream = openReader(
      await openStream(ownerToken, await boardSeq(ownerToken), "accept-tab-1"),
    );
    await stream.next(1, "presence");

    // The pending invitee accepts: a board-scoped member directory change,
    // so every open member list refreshes without a reload.
    await accept(await invitationId(pendingToken), pendingToken);

    const frames = await stream.next(1, "membership");
    expect(frames[0].boardId).toBe(boardId);
    expect(frames[0].change).toBe("accepted");
    expect(typeof frames[0].userId).toBe("string");
    await stream.close();
  }, 20_000);

  it("tells a removed member's stream to stop, then refuses it", async () => {
    const stream = openReader(
      await openStream(
        memberToken,
        await boardSeq(ownerToken),
        "revoked-tab-1",
      ),
    );
    await stream.next(1, "presence");

    await server()
      .delete(`/api/v1/boards/${boardId}/members/${memberId}`)
      .set(auth(ownerToken))
      .expect(200);

    // The removed user gets one last frame (who was removed) and the server
    // ends the stream, so a connected tab drops the board instead of
    // silently following a board it can no longer touch.
    const frames = await stream.next(1, "membership");
    expect(frames[0].boardId).toBe(boardId);
    expect(frames[0].userId).toBe(memberId);
    expect(frames[0].change).toBe("removed");
    expect(await stream.ended()).toBe(true);
    await stream.close();

    // The membership is gone for good: the next connection is 403.
    const retry = await openStream(memberToken, 0, "revoked-tab-2");
    expect(retry.status).toBe(403);
    await retry.body?.cancel().catch(() => undefined);
  }, 20_000);

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.comment.deleteMany();
    await db.activity.deleteMany();
    await db.command.deleteMany();
    await db.card.deleteMany();
    await db.column.deleteMany();
    await db.label.deleteMany();
    await db.boardMember.deleteMany();
    await db.boardShare.deleteMany();
    await db.board.deleteMany();
    await db.apiToken.deleteMany();
    await db.refreshToken.deleteMany();
    await db.user.deleteMany();
  }
});
