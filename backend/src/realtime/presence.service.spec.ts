import type { BoardSseEvent, PresenceSseEvent } from "@janosik/shared";
import { PresenceService, PRESENCE_TTL_MS } from "./presence.service";
import { RealtimeService } from "./realtime.service";

const alice = {
  id: "u-alice",
  displayName: "Alice",
  email: "alice@x.io",
  avatarColor: "blue" as const,
  avatarPath: null,
};
const bob = {
  id: "u-bob",
  displayName: null,
  email: "bob@x.io",
  avatarColor: null,
  avatarPath: null,
};

const aliceWire = {
  id: "u-alice",
  displayName: "Alice",
  avatarColor: "blue",
  avatarPath: null,
};
const bobWire = {
  id: "u-bob",
  displayName: "bob@x.io",
  avatarColor: null,
  avatarPath: null,
};

/** Presence frames published to one board, in order. */
function collector(realtime: RealtimeService, boardId = "b1") {
  const seen: PresenceSseEvent[] = [];
  realtime.watch(boardId).subscribe((event: BoardSseEvent) => {
    if (event.type === "presence") seen.push(event);
  });
  return seen;
}

describe("PresenceService", () => {
  let realtime: RealtimeService;
  let presence: PresenceService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    realtime = new RealtimeService();
    presence = new PresenceService(realtime);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes a join delta for the first session; dedups tabs; syncs the roster", () => {
    const seen = collector(realtime);

    const first = presence.join("b1", "client-alice-1", alice);
    expect(first.roster).toEqual([aliceWire]);
    expect(seen).toEqual([{ type: "presence", op: "join", user: aliceWire }]);

    // A second tab of the same user must not re-announce them, but its
    // sync still lists the user exactly once.
    const second = presence.join("b1", "client-alice-2", alice);
    expect(second.roster).toEqual([aliceWire]);
    expect(seen).toHaveLength(1);

    const bobJoin = presence.join("b1", "client-bob-1", bob);
    expect(bobJoin.roster).toEqual([aliceWire, bobWire]);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ type: "presence", op: "join", user: bobWire });
  });

  it("publishes leave only when the last session of a user goes away", () => {
    const seen = collector(realtime);
    presence.join("b1", "a1", alice);
    presence.join("b1", "a2", alice);
    seen.length = 0;

    presence.leave("b1", "a1");
    expect(seen).toHaveLength(0);
    expect(presence.roster("b1")).toEqual([aliceWire]);

    presence.leave("b1", "a2");
    expect(seen).toEqual([
      { type: "presence", op: "leave", userId: "u-alice" },
    ]);
    expect(presence.roster("b1")).toEqual([]);
  });

  it("keeps join order stable across reconnects and renames", () => {
    presence.join("b1", "b1", bob);
    presence.join("b1", "a1", alice);
    jest.setSystemTime(Date.now() + 5_000);
    presence.join("b1", "b1", { ...bob, displayName: "Bobby" });

    expect(presence.roster("b1")).toEqual([
      { ...bobWire, displayName: "Bobby" },
      aliceWire,
    ]);
  });

  it("publishes update on an identity change, per board; silent on no-ops", () => {
    const b1 = collector(realtime, "b1");
    const b2 = collector(realtime, "b2");
    presence.join("b1", "a1", alice);
    presence.join("b2", "a2", alice);
    presence.join("b1", "b1", bob);
    b1.length = 0;
    b2.length = 0;

    presence.updateUser("u-alice", {
      displayName: "Alicia",
      avatarColor: "pink",
    });
    const aliciaWire = {
      id: "u-alice",
      displayName: "Alicia",
      avatarColor: "pink",
      avatarPath: null,
    };
    expect(b1).toEqual([{ type: "presence", op: "update", user: aliciaWire }]);
    expect(b2).toEqual([{ type: "presence", op: "update", user: aliciaWire }]);

    // A user with no sessions and an unchanged patch stay silent.
    b1.length = 0;
    b2.length = 0;
    presence.updateUser("u-nobody", { displayName: "Ghost" });
    presence.updateUser("u-alice", { displayName: "Alicia" });
    expect(b1).toHaveLength(0);
    expect(b2).toHaveLength(0);
  });

  it("touch refreshes the TTL; sweep publishes a leave per vanished user", () => {
    const seen = collector(realtime);
    const t0 = Date.now();
    presence.join("b1", "a1", alice);
    presence.join("b1", "b1", bob);
    seen.length = 0;

    expect(presence.touch("b1", "a1")).toBe(true);
    expect(presence.touch("b1", "nope")).toBe(false);

    jest.setSystemTime(t0 + PRESENCE_TTL_MS / 2);
    expect(presence.touch("b1", "a1")).toBe(true);

    presence.sweep(t0 + PRESENCE_TTL_MS - 1);
    expect(seen).toHaveLength(0);
    expect(presence.roster("b1")).toHaveLength(2);

    // At one TTL only bob (never touched) is stale; alice was refreshed.
    presence.sweep(t0 + PRESENCE_TTL_MS + 1);
    expect(seen).toEqual([{ type: "presence", op: "leave", userId: "u-bob" }]);
    expect(presence.roster("b1")).toEqual([aliceWire]);

    // Another TTL later alice is stale too.
    presence.sweep(t0 + PRESENCE_TTL_MS * 2);
    expect(seen.at(-1)).toEqual({
      type: "presence",
      op: "leave",
      userId: "u-alice",
    });
    expect(presence.roster("b1")).toEqual([]);
  });

  it("refuses a clientId already held by another user (TASK-102)", () => {
    presence.join("b1", "shared", alice);
    expect(() => presence.join("b1", "shared", bob)).toThrow();
    expect(presence.roster("b1")).toEqual([aliceWire]);
  });

  it("ignores a stale teardown after a reconnect (TASK-102)", () => {
    const first = presence.join("b1", "a1", alice);
    const second = presence.join("b1", "a1", alice);
    presence.leave("b1", "a1", first.token);
    expect(presence.roster("b1")).toHaveLength(1);
    presence.leave("b1", "a1", second.token);
    expect(presence.roster("b1")).toHaveLength(0);
  });

  it("only the owning user may refresh a ping (TASK-102)", () => {
    presence.join("b1", "a1", alice);
    expect(presence.touch("b1", "a1", "u-bob")).toBe(false);
    expect(presence.touch("b1", "a1", "u-alice")).toBe(true);
  });
});
