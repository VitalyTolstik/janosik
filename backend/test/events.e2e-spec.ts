import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import type { AddressInfo } from "node:net";
import type { ReadableStreamReadResult } from "node:stream/web";
import { AppModule } from "@/app.module";
import "@/config/env";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RealtimeService } from "@/realtime/realtime.service";
import { SseFrameStore } from "@/realtime/sse-frames";
import { sseTiming } from "@/realtime/sse-timing";

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
  action?: { type: string; boardId?: string };
  touches?: string[];
  op?: "sync" | "join" | "leave" | "update";
  user?: {
    id: string;
    displayName: string;
    avatarColor: string | null;
    avatarPath: string | null;
  };
  users?: {
    id: string;
    displayName: string;
    avatarColor: string | null;
    avatarPath: string | null;
  }[];
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

  /** Commit `count` 64 KiB `UPDATE_CARD` commands in one batch. */
  async function updateBatch(
    tag: string,
    cardId: string,
    count = 100,
  ): Promise<void> {
    await server()
      .post(`/api/v1/boards/${boardId}/commands/batch`)
      .set(auth(ownerToken))
      .send({
        commands: Array.from({ length: count }, (_, index) => {
          const prefix = `${tag}-${index}-`;
          return {
            commandId: `evt-${tag}-${index}`,
            action: {
              type: "UPDATE_CARD",
              cardId,
              // LIMITS.description is exactly 64 000 characters.
              description: prefix + "x".repeat(64_000 - prefix.length),
              at: Date.now() + index,
            },
          };
        }),
      })
      .expect(200);
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

  /**
   * An agent-shaped stream: no presence roster and no presence frames, so the
   * first block on the wire is the event under test.
   */
  function openQuietStream(token: string, since: number): Promise<Response> {
    return fetch(
      `${baseUrl}/boards/${boardId}/events?since=${since}&presence=0`,
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
      },
    );
  }

  /** Raw blocks (headers included) for byte-for-byte fan-out assertions. */
  function openRawReader(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let closed = false;

    const next = async (
      predicate: (block: string) => boolean,
      timeoutMs = 12_000,
    ): Promise<string> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        for (;;) {
          const separator = buffer.indexOf("\n\n");
          if (separator === -1) break;
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          if (predicate(block)) return block;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`Timed out waiting for an SSE block (${buffer})`);
        }
        const chunk = await readWithTimeout(reader, remaining);
        if (chunk.done) throw new Error("Stream ended before the SSE block");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await reader.cancel().catch(() => undefined);
      await response.body?.cancel().catch(() => undefined);
    };

    return { next, close };
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
            if (frame.type === "keepalive") continue;
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

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for a condition");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
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

  it("builds a published frame once and writes identical bytes to every subscriber", async () => {
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: "col-fanout",
        title: "Fan-out",
        at: Date.now(),
      },
      "evt-fanout-col",
    );
    const baseline = await boardSeq(ownerToken);
    const frames = app.get(SseFrameStore);
    const realtime = app.get(RealtimeService);
    const subscribersBefore = realtime.subscriberCount;

    const [ownerStream, memberStream] = await Promise.all([
      openQuietStream(ownerToken, baseline),
      openQuietStream(memberToken, baseline),
    ]);
    expect(ownerStream.status).toBe(200);
    expect(memberStream.status).toBe(200);
    // `fetch` resolves once the headers are out, but wait for both admissions
    // so a setup frame cannot move `builtCount` inside the measurement.
    await waitFor(
      () => realtime.subscriberCount === subscribersBefore + 2,
      5_000,
    );
    let ownerReader: ReturnType<typeof openRawReader> | undefined;
    let memberReader: ReturnType<typeof openRawReader> | undefined;
    try {
      ownerReader = openRawReader(ownerStream);
      memberReader = openRawReader(memberStream);
      const owner = ownerReader;
      const member = memberReader;
      const isCommand = (block: string): boolean =>
        block.includes("data:") && !block.includes('"type":"keepalive"');
      const seqOf = (block: string): number =>
        (
          JSON.parse(
            block
              .split("\n")
              .find((line) => line.startsWith("data:"))
              ?.slice(5)
              .trim() ?? "null",
          ) as { seq: number }
        ).seq;

      // Ready handshake: both subscribers must deliver a live frame before
      // the build counter becomes the measurement.
      const warmSeq = await command(
        ownerToken,
        {
          type: "RENAME_COLUMN",
          columnId: "col-fanout",
          title: "Fan-out warm",
          at: Date.now(),
        },
        "evt-fanout-warm",
      );
      const [warmOwner, warmMember] = await Promise.all([
        owner.next(isCommand),
        member.next(isCommand),
      ]);
      expect(seqOf(warmOwner)).toBe(warmSeq);
      expect(seqOf(warmMember)).toBe(warmSeq);
      const buildsBefore = frames.builtCount;

      const firstSeq = await command(
        ownerToken,
        {
          type: "ADD_CARD",
          newCardId: "card-fanout",
          columnId: "col-fanout",
          title: "Fan-out card",
          at: Date.now(),
        },
        "evt-fanout-card",
      );
      const secondSeq = await command(
        ownerToken,
        {
          type: "RENAME_COLUMN",
          columnId: "col-fanout",
          title: "Fan-out renamed",
          at: Date.now(),
        },
        "evt-fanout-rename",
      );

      const readTwo = async (
        reader: ReturnType<typeof openRawReader>,
      ): Promise<string[]> => [
        await reader.next(isCommand),
        await reader.next(isCommand),
      ];
      const [ownerBlocks, memberBlocks] = await Promise.all([
        readTwo(owner),
        readTwo(member),
      ]);

      // Same bytes, same ids, same order: one Buffer was written to both.
      expect(ownerBlocks).toEqual(memberBlocks);
      const payloads = ownerBlocks.map(
        (block) =>
          JSON.parse(
            block
              .split("\n")
              .find((line) => line.startsWith("data:"))
              ?.slice(5)
              .trim() ?? "null",
          ) as { type: string; seq: number },
      );
      expect(payloads.map((frame) => frame.seq)).toEqual([firstSeq, secondSeq]);
      // Two published commands, two frames built — not one per subscriber.
      expect(frames.builtCount - buildsBefore).toBe(2);
    } finally {
      await ownerReader?.close();
      await memberReader?.close();
    }
  }, 20_000);

  it("shares one 10-frame large catch-up across three subscribers", async () => {
    const columnId = "col-catchup";
    const cardId = "card-catchup";
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "Catch-up",
        at: Date.now(),
      },
      "evt-catchup-col",
    );
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Catch-up card",
        at: Date.now(),
      },
      "evt-catchup-card",
    );
    const baseline = await boardSeq(ownerToken);
    // Ten 64 KiB updates fit the process-wide 32 MiB catch-up budget across
    // three simultaneous subscribers; 100 would (correctly) resync two of
    // them, which the unit budget test covers.
    await updateBatch("catchup", cardId, 10);
    const frames = app.get(SseFrameStore);
    const buildsBefore = frames.builtCount;

    const [first, second, third] = await Promise.all([
      openQuietStream(ownerToken, baseline),
      openQuietStream(memberToken, baseline),
      openQuietStream(viewerToken, baseline),
    ]);
    const readers: Array<ReturnType<typeof openRawReader>> = [];
    try {
      readers.push(
        openRawReader(first),
        openRawReader(second),
        openRawReader(third),
      );
      const isCommand = (block: string): boolean =>
        block.includes("data:") && !block.includes('"type":"keepalive"');
      const readPage = async (
        reader: ReturnType<typeof openRawReader>,
      ): Promise<string[]> => {
        const blocks: string[] = [];
        for (let index = 0; index < 10; index += 1) {
          blocks.push(await reader.next(isCommand, 30_000));
        }
        return blocks;
      };
      const [a, b, c] = await Promise.all(readers.map(readPage));

      // Three independent delta queries, one build per command seq and the
      // same Buffers for all three subscribers.
      expect(a).toEqual(b);
      expect(b).toEqual(c);
      expect(frames.builtCount - buildsBefore).toBe(10);
    } finally {
      await Promise.all(readers.map((reader) => reader.close()));
      // Reclaim the board column slot; the suite has a fixed column budget
      // and later cases create their own.
      await command(
        ownerToken,
        { type: "DELETE_COLUMN", columnId, at: Date.now() },
        "evt-catchup-cleanup",
      ).catch(() => undefined);
    }
  }, 90_000);

  it("resyncs a catch-up delta above the hard byte guard", async () => {
    const columnId = "col-oversize";
    const cardId = "card-oversize";
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "Oversize",
        at: Date.now(),
      },
      "evt-oversize-col",
    );
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Oversize card",
        at: Date.now(),
      },
      "evt-oversize-card",
    );
    const baseline = await boardSeq(ownerToken);
    // 300 x 64 KiB is ~19.2 MiB: above the 16 MiB catch-up guard but below
    // the 5 000-command count cap, so only the byte bound can resync it.
    await updateBatch("oversize-a", cardId);
    await updateBatch("oversize-b", cardId);
    await updateBatch("oversize-c", cardId);

    // The REST delta catch-up uses the same guard/budget and returns the
    // existing resync signal instead of loading the 19 MiB page.
    const delta = await server()
      .get(`/api/v1/boards/${boardId}/commands?since=${baseline}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(delta.headers["x-delta-resync"]).toBe("1");
    expect(delta.body).toEqual([]);

    const stream = openReader(await openQuietStream(memberToken, baseline));
    try {
      const [frame] = await stream.next(1, "resync", 30_000);
      expect(frame.type).toBe("resync");
    } finally {
      await stream.close();
      await command(
        ownerToken,
        { type: "DELETE_COLUMN", columnId, at: Date.now() },
        "evt-oversize-cleanup",
      ).catch(() => undefined);
    }
  }, 120_000);

  it.each([10, 100])(
    "survives a healthy live %i-command burst of 64 KiB descriptions",
    async (count) => {
      const columnId = `col-burst-${count}`;
      const cardId = `card-burst-${count}`;
      await command(
        ownerToken,
        {
          type: "ADD_COLUMN",
          newColumnId: columnId,
          title: `Burst ${count}`,
          at: Date.now(),
        },
        `evt-burst-col-${count}`,
      );
      await command(
        ownerToken,
        {
          type: "ADD_CARD",
          newCardId: cardId,
          columnId,
          title: "Burst card",
          at: Date.now(),
        },
        `evt-burst-card-${count}`,
      );
      const baseline = await boardSeq(ownerToken);
      const stream = openReader(await openQuietStream(memberToken, baseline));
      let reading: Promise<SseFrame[]> | undefined;
      try {
        // A healthy reader is already draining while the batch publishes; the
        // server may queue the burst but must not drop this subscriber.
        reading = stream.next(
          count,
          "command",
          count === 100 ? 60_000 : 30_000,
        );
        const response = await server()
          .post(`/api/v1/boards/${boardId}/commands/batch`)
          .set(auth(ownerToken))
          .send({
            commands: Array.from({ length: count }, (_, index) => {
              const prefix = `burst-${count}-${index}-`;
              return {
                commandId: `evt-burst-${count}-${index}`,
                action: {
                  type: "UPDATE_CARD",
                  cardId,
                  // LIMITS.description is exactly 64 000 characters.
                  description: prefix + "x".repeat(64_000 - prefix.length),
                  at: Date.now() + index,
                },
              };
            }),
          })
          .expect(200);
        const frames = await reading;
        const expected = (
          response.body as { results: Array<{ seq: number }> }
        ).results.map((result) => result.seq);
        expect(frames.map((frame) => frame.seq)).toEqual(expected);
        expect(frames).toHaveLength(count);
      } finally {
        // Close before awaiting a failed read: otherwise the pending reader
        // rejects after the test has already moved on.
        await reading?.catch(() => undefined);
        await stream.close();
      }
    },
    90_000,
  );

  it("resumes a dropped quiet stream from its last applied seq", async () => {
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: "col-reconnect",
        title: "Reconnect",
        at: Date.now(),
      },
      "evt-reconnect-col",
    );
    const baseline = await boardSeq(ownerToken);
    const first = openReader(await openQuietStream(ownerToken, baseline));
    const firstSeq = await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: "card-reconnect",
        columnId: "col-reconnect",
        title: "Before drop",
        at: Date.now(),
      },
      "evt-reconnect-before",
    );
    const [applied] = await first.next(1, "command");
    expect(applied.seq).toBe(firstSeq);
    // Simulate the disconnect a slow-consumer drop produces.
    await first.close();

    const missedSeq = await command(
      ownerToken,
      {
        type: "RENAME_COLUMN",
        columnId: "col-reconnect",
        title: "While away",
        at: Date.now(),
      },
      "evt-reconnect-missed",
    );
    const resumed = openReader(
      await openQuietStream(ownerToken, applied.seq as number),
    );
    try {
      const [missed] = await resumed.next(1, "command");
      expect(missed.seq).toBe(missedSeq);
      expect(missed.action?.type).toBe("RENAME_COLUMN");
    } finally {
      await resumed.close();
    }
  }, 20_000);

  it("keeps an idle quiet stream alive through the shared writer", async () => {
    const previous = sseTiming.keepAliveMs;
    let reader: ReturnType<typeof openRawReader> | undefined;
    try {
      sseTiming.keepAliveMs = 100;
      const response = await openQuietStream(
        ownerToken,
        await boardSeq(ownerToken),
      );
      reader = openRawReader(response);
      const block = await reader.next((frame) =>
        frame.includes('"type":"keepalive"'),
      );
      expect(block).toContain("data:");
      expect(block).toContain('"type":"keepalive"');
    } finally {
      sseTiming.keepAliveMs = previous;
      await reader?.close();
    }
  }, 20_000);

  it("scopes live events by the route board when a REST caller omits boardId", async () => {
    const baseline = await boardSeq(ownerToken);
    const stream = openReader(await openStream(memberToken, baseline));
    try {
      // `boardId` is optional on the wire (BoardScopedAction), so a REST
      // caller may omit it. The route is authoritative: the live frame and
      // the stored delta must both name the board the command actually ran
      // on, otherwise the UI's realtime bridge silently drops the event.
      const seq = await command(
        ownerToken,
        {
          type: "ADD_COLUMN",
          newColumnId: "col-routed",
          title: "Routed",
          at: Date.now(),
        },
        "evt-cmd-routed",
      );

      const [frame] = await stream.next(1, "command");
      expect(frame.seq).toBe(seq);
      expect(frame.action).toMatchObject({ type: "ADD_COLUMN", boardId });

      const delta = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${baseline}`)
        .set(auth(ownerToken))
        .expect(200);
      const stored = (
        delta.body as Array<{
          commandId: string;
          action: { boardId?: string };
        }>
      ).find((entry) => entry.commandId === "evt-cmd-routed");
      expect(stored?.action.boardId).toBe(boardId);
    } finally {
      await stream.close();
    }
  }, 20_000);

  it("overwrites a client-supplied boardId that disagrees with the route", async () => {
    const baseline = await boardSeq(ownerToken);
    const stream = openReader(await openStream(memberToken, baseline));
    try {
      const seq = await command(
        ownerToken,
        {
          type: "ADD_COLUMN",
          boardId: "some-other-board",
          newColumnId: "col-mismatched",
          title: "Mismatched",
          at: Date.now(),
        },
        "evt-cmd-mismatched",
      );

      const [frame] = await stream.next(1, "command");
      expect(frame.seq).toBe(seq);
      expect(frame.action).toMatchObject({ type: "ADD_COLUMN", boardId });

      const delta = await server()
        .get(`/api/v1/boards/${boardId}/commands?since=${baseline}`)
        .set(auth(ownerToken))
        .expect(200);
      const stored = (
        delta.body as Array<{
          commandId: string;
          action: { boardId?: string };
        }>
      ).find((entry) => entry.commandId === "evt-cmd-mismatched");
      expect(stored?.action.boardId).toBe(boardId);
    } finally {
      await stream.close();
    }
  }, 20_000);

  it("replays and normalizes a legacy command whose payload lacks boardId", async () => {
    const baseline = await boardSeq(ownerToken);
    const commandId = "evt-cmd-legacy-board";
    const action = {
      type: "ADD_COLUMN",
      newColumnId: "col-legacy",
      title: "Legacy",
      at: Date.now(),
    };
    const seq = await command(ownerToken, action, commandId);

    // Simulate a row written before ingress stamping: the action was stored
    // exactly as sent, without `boardId`.
    const stored = await prisma.command.findUniqueOrThrow({
      where: { id: commandId },
    });
    const payload = { ...(stored.payload as Record<string, unknown>) };
    delete payload.boardId;
    await prisma.command.update({
      where: { id: commandId },
      data: { payload: payload as Prisma.InputJsonValue },
    });

    // An honest retry still returns the stored result…
    const retry = await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({ commandId, action })
      .expect(200);
    expect(retry.body.seq).toBe(seq);

    // …while a changed body is still refused.
    await server()
      .post(`/api/v1/boards/${boardId}/commands`)
      .set(auth(ownerToken))
      .send({ commandId, action: { ...action, title: "Changed" } })
      .expect(409);

    // The delta mapper scopes the legacy payload to the queried board.
    const delta = await server()
      .get(`/api/v1/boards/${boardId}/commands?since=${baseline}`)
      .set(auth(ownerToken))
      .expect(200);
    const entry = (
      delta.body as Array<{
        commandId: string;
        action: { boardId?: string };
      }>
    ).find((row) => row.commandId === commandId);
    expect(entry?.action.boardId).toBe(boardId);
  }, 20_000);

  it("stamps the route board on batch command frames", async () => {
    const baseline = await boardSeq(ownerToken);
    const stream = openReader(await openStream(memberToken, baseline));
    try {
      const res = await server()
        .post(`/api/v1/boards/${boardId}/commands/batch`)
        .set(auth(ownerToken))
        .send({
          commands: [
            {
              commandId: "evt-cmd-batch-routed",
              action: {
                type: "ADD_COLUMN",
                newColumnId: "col-batch-routed",
                title: "Batch routed",
                at: Date.now(),
              },
            },
          ],
        })
        .expect(200);

      const [frame] = await stream.next(1, "command");
      expect(frame.seq).toBe(res.body.results[0].seq);
      expect(frame.action).toMatchObject({ type: "ADD_COLUMN", boardId });
    } finally {
      await stream.close();
    }
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
      commentId: created.body.id,
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
      commentId: created.body.id,
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

  it("broadcasts presence deltas: sync on connect, join/leave per user", async () => {
    const baseline = await boardSeq(ownerToken);
    const owner1 = openReader(
      await openStream(ownerToken, baseline, "tab-owner-1"),
    );
    const firstSync = await owner1.next(1, "presence");
    expect(firstSync[0].op).toBe("sync");
    expect(firstSync[0].users).toEqual([
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
    // The new stream gets the full roster once…
    const memberSync = await memberStream.next(1, "presence");
    expect(memberSync[0].op).toBe("sync");
    expect(memberSync[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);
    // …while the existing stream only receives a small `join` delta.
    const ownerSeesJoin = await owner1.next(1, "presence");
    expect(ownerSeesJoin[0].op).toBe("join");
    expect(ownerSeesJoin[0].user).toMatchObject({ id: memberId });

    // A second tab of the same user syncs itself but does not re-announce
    // the user — no `join` reaches the other streams.
    const owner2 = openReader(
      await openStream(ownerToken, baseline, "tab-owner-2"),
    );
    const owner2Sync = await owner2.next(1, "presence");
    expect(owner2Sync[0].op).toBe("sync");
    expect(owner2Sync[0].users?.map((user) => user.id)).toEqual([
      ownerId,
      memberId,
    ]);

    // Closing one tab keeps the user present; the last one publishes `leave`.
    await owner1.close();
    await owner2.close();
    const afterLeave = await memberStream.next(1, "presence");
    expect(afterLeave[0].op).toBe("leave");
    expect(afterLeave[0].userId).toBe(ownerId);
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

    // A small `update` delta is published to both sides — no reconnect, no
    // full-roster copy.
    const ownerUpdate = await ownerStream.next(1, "presence");
    expect(ownerUpdate[0].op).toBe("update");
    expect(ownerUpdate[0].user).toEqual({
      id: ownerId,
      displayName: "Renamed Owner",
      avatarColor: "teal",
      avatarPath: null,
    });
    const memberUpdate = await memberStream.next(1, "presence");
    expect(memberUpdate[0].op).toBe("update");
    expect(memberUpdate[0].user).toEqual({
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

    // A ping for a session the stream never opened — or one already swept —
    // is `410`: the client reopens the stream and rejoins (TASK-145). It
    // still never conjures a presence entry.
    await server()
      .post(`/api/v1/boards/${boardId}/presence`)
      .set(auth(ownerToken))
      .send({ clientId: "unknown-session-1" })
      .expect(410);

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

  it("rejects a garbage since value without leaking an SSE slot", async () => {
    const realtime = app.get(RealtimeService);
    const before = realtime.subscriberCount;
    const res = await fetch(`${baseUrl}/boards/${boardId}/events?since=hello`, {
      headers: auth(ownerToken),
    });
    expect(res.status).toBe(400);
    await res.body?.cancel().catch(() => undefined);
    // The admission is taken before the Observable exists; a throw after it
    // used to leak the slot forever (TASK-147 follow-up).
    expect(realtime.subscriberCount).toBe(before);
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

  it("closes a voluntary leaver's stream with change: left", async () => {
    const stream = openReader(
      await openStream(viewerToken, await boardSeq(ownerToken), "left-tab-1"),
    );
    await stream.next(1, "presence");

    await server()
      .delete(`/api/v1/boards/${boardId}/members/me`)
      .set(auth(viewerToken))
      .expect(200);

    // A voluntary leave is distinguishable from an admin removal, so the
    // other tab can say "You left the board" instead of "access revoked".
    const frames = await stream.next(1, "membership");
    expect(frames[0].boardId).toBe(boardId);
    expect(frames[0].change).toBe("left");
    expect(await stream.ended()).toBe(true);
    await stream.close();

    const retry = await openStream(viewerToken, 0, "left-tab-2");
    expect(retry.status).toBe(403);
    await retry.body?.cancel().catch(() => undefined);
  }, 20_000);

  it("publishes comment_restored and attachment_restored activity frames", async () => {
    const columnId = "col-1777-restore";
    const cardId = "card-1777-restore";
    await command(
      ownerToken,
      {
        type: "ADD_COLUMN",
        newColumnId: columnId,
        title: "Restore",
        at: Date.now(),
      },
      "evt-1777-col",
    );
    await command(
      ownerToken,
      {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId,
        title: "Restore card",
        at: Date.now(),
      },
      "evt-1777-card",
    );
    const comment = await server()
      .post(`/api/v1/cards/${cardId}/comments`)
      .set(auth(ownerToken))
      .send({ text: "Restore this comment" })
      .expect(201);
    const file = await server()
      .post(`/api/v1/cards/${cardId}/attachments`)
      .set(auth(ownerToken))
      .attach("file", Buffer.from("hello"), {
        filename: "restore.txt",
        contentType: "text/plain",
      })
      .expect(201);

    const stream = openReader(
      await openStream(ownerToken, await boardSeq(ownerToken), "restore-tab-1"),
    );
    await stream.next(1, "presence");

    await server()
      .delete(`/api/v1/comments/${comment.body.id}`)
      .set(auth(ownerToken))
      .expect(200);
    await server()
      .post(
        `/api/v1/boards/${boardId}/deleted/comments/${comment.body.id}/restore`,
      )
      .set(auth(ownerToken))
      .expect(200);
    await server()
      .delete(`/api/v1/attachments/${file.body.id}`)
      .set(auth(ownerToken))
      .expect(200);
    await server()
      .post(
        `/api/v1/boards/${boardId}/deleted/attachments/${file.body.id}/restore`,
      )
      .set(auth(ownerToken))
      .expect(200);

    const frames = await stream.next(4, "activity");
    expect(frames.map((frame) => frame.kind)).toEqual([
      "comment_deleted",
      "comment_restored",
      "attachment_deleted",
      "attachment_restored",
    ]);
    expect(frames[1]?.detail).toBe(comment.body.id);
    expect(frames[3]?.detail).toBe(file.body.id);
    await stream.close();
  }, 30_000);

  async function wipe(db: PrismaService): Promise<void> {
    await db.attachment.deleteMany();
    await db.cardLink.deleteMany();
    await db.cardLabel.deleteMany();
    await db.checklistItem.deleteMany();
    await db.checklist.deleteMany();
    await db.commentRevision.deleteMany();
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
