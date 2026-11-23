import type { BoardSseEvent } from "@janosik/shared";
import {
  RealtimeService,
  type CacheInvalidation,
  type RealtimeRedisClient,
} from "./realtime.service";

/**
 * TASK-200.12: two API replicas, one in-memory pub/sub bus. This is the
 * cheap smoke that the SSE fan-out and the control channel really cross the
 * process boundary: a frame published on replica A reaches subscribers on
 * replica B exactly once, and a throttler-limit change reaches B too. No
 * Redis server or Docker is needed.
 */
class FakeHub {
  private readonly channels = new Map<string, Set<FakeRedis>>();
  private readonly clients = new Set<FakeRedis>();

  readonly factory = (): RealtimeRedisClient => {
    const client = new FakeRedis(this);
    this.clients.add(client);
    return client;
  };

  add(channel: string, client: FakeRedis): void {
    let members = this.channels.get(channel);
    if (members === undefined) {
      members = new Set();
      this.channels.set(channel, members);
    }
    members.add(client);
  }

  remove(channel: string, client: FakeRedis): void {
    this.channels.get(channel)?.delete(client);
  }

  drop(client: FakeRedis): void {
    this.clients.delete(client);
    for (const members of this.channels.values()) members.delete(client);
  }

  publish(channel: string, payload: string): void {
    for (const client of this.channels.get(channel) ?? []) {
      client.deliver(channel, payload);
    }
  }
}

class FakeRedis implements RealtimeRedisClient {
  private listener: ((channel: string, payload: string) => void) | undefined;

  constructor(private readonly hub: FakeHub) {}

  async publish(channel: string, payload: string): Promise<number> {
    this.hub.publish(channel, payload);
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    this.hub.add(channel, this);
    return 1;
  }

  async unsubscribe(channel: string): Promise<number> {
    this.hub.remove(channel, this);
    return 0;
  }

  on(
    event: "message",
    listener: (channel: string, payload: string) => void,
  ): this {
    if (event === "message") this.listener = listener;
    return this;
  }

  async quit(): Promise<"OK"> {
    this.hub.drop(this);
    return "OK";
  }

  deliver(channel: string, payload: string): void {
    this.listener?.(channel, payload);
  }
}

function replica(hub: FakeHub): RealtimeService {
  return new RealtimeService({
    redisUrl: "redis://fake",
    createRedis: hub.factory,
  });
}

describe("Realtime across API replicas (TASK-200.12)", () => {
  it("fans a board frame out to a subscriber on another replica, once", () => {
    const hub = new FakeHub();
    const a = replica(hub);
    const b = replica(hub);
    a.onModuleInit();
    b.onModuleInit();

    const seenA: BoardSseEvent[] = [];
    const seenB: BoardSseEvent[] = [];
    const subA = a.watch("board-1").subscribe((event) => seenA.push(event));
    const subB = b.watch("board-1").subscribe((event) => seenB.push(event));

    const frame: BoardSseEvent = { type: "resync" };
    a.publish("board-1", frame);

    expect(seenA).toEqual([frame]);
    expect(seenB).toEqual([frame]);

    subA.unsubscribe();
    subB.unsubscribe();
    void a.onModuleDestroy();
    void b.onModuleDestroy();
  });

  it("carries a cache/throttle invalidation to the other replica", () => {
    const hub = new FakeHub();
    const a = replica(hub);
    const b = replica(hub);
    a.onModuleInit();
    b.onModuleInit();

    const peer: CacheInvalidation[] = [];
    b.onInvalidation((event) => peer.push(event));
    a.publishInvalidation({ kind: "throttle", limit: 450 });

    expect(peer).toEqual([{ kind: "throttle", limit: 450 }]);
    void a.onModuleDestroy();
    void b.onModuleDestroy();
  });

  it("does not fan out when no Redis is configured", () => {
    const hub = new FakeHub();
    const local = new RealtimeService({
      redisUrl: "",
      createRedis: hub.factory,
    });
    local.onModuleInit();
    const seen: BoardSseEvent[] = [];
    const sub = local.watch("board-1").subscribe((event) => seen.push(event));
    local.publish("board-1", { type: "resync" });
    expect(seen).toEqual([{ type: "resync" }]);
    sub.unsubscribe();
    void local.onModuleDestroy();
  });
});
