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

  it("broadcasts the roster on join and deduplicates users across tabs", () => {
    const seen = collector(realtime);

    presence.join("b1", "client-alice-1", alice);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      type: "presence",
      users: [
        {
          id: "u-alice",
          displayName: "Alice",
          avatarColor: "blue",
          avatarPath: null,
        },
      ],
    });

    // A second tab broadcasts again — the fresh connection needs the
    // current roster — but the user still appears exactly once.
    presence.join("b1", "client-alice-2", alice);
    expect(seen).toHaveLength(2);
    expect(seen[1].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);

    presence.join("b1", "client-bob-1", bob);
    expect(seen).toHaveLength(3);
    expect(seen[2].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
      {
        id: "u-bob",
        displayName: "bob@x.io",
        avatarColor: null,
        avatarPath: null,
      },
    ]);
  });

  it("keeps the user while another tab lives, broadcasts when the last leaves", () => {
    const seen = collector(realtime);
    presence.join("b1", "a1", alice);
    presence.join("b1", "a2", alice);
    seen.length = 0;

    presence.leave("b1", "a1");
    expect(seen).toHaveLength(0);
    expect(presence.roster("b1")).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);

    presence.leave("b1", "a2");
    expect(seen).toHaveLength(1);
    expect(seen[0].users).toEqual([]);
    expect(presence.roster("b1")).toEqual([]);
  });

  it("keeps join order stable across reconnects and renames", () => {
    presence.join("b1", "b1", bob);
    presence.join("b1", "a1", alice);
    jest.setSystemTime(Date.now() + 5_000);
    presence.join("b1", "b1", { ...bob, displayName: "Bobby" });

    expect(presence.roster("b1")).toEqual([
      {
        id: "u-bob",
        displayName: "Bobby",
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);
  });

  it("rewrites a user's identity on every live board, silently on no-ops", () => {
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
    expect(b1).toHaveLength(1);
    expect(b1[0].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alicia",
        avatarColor: "pink",
        avatarPath: null,
      },
      {
        id: "u-bob",
        displayName: "bob@x.io",
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    expect(b2).toHaveLength(1);
    expect(b2[0].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alicia",
        avatarColor: "pink",
        avatarPath: null,
      },
    ]);

    // A user with no sessions and an unchanged patch stay silent.
    b1.length = 0;
    b2.length = 0;
    presence.updateUser("u-nobody", { displayName: "Ghost" });
    presence.updateUser("u-alice", { displayName: "Alicia" });
    expect(b1).toHaveLength(0);
    expect(b2).toHaveLength(0);
  });

  it("touch refreshes the TTL, sweep drops stale sessions and broadcasts", () => {
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

    presence.sweep(t0 + PRESENCE_TTL_MS + 1);
    expect(seen).toHaveLength(1);
    expect(seen[0].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);

    presence.sweep(t0 + PRESENCE_TTL_MS * 3);
    expect(seen).toHaveLength(2);
    expect(seen[1].users).toEqual([]);
    expect(presence.roster("b1")).toEqual([]);
  });

  it("refuses a clientId already held by another user (TASK-102)", () => {
    presence.join("b1", "shared", alice);
    expect(() => presence.join("b1", "shared", bob)).toThrow();
    // The rightful owner keeps the slot.
    expect(presence.roster("b1")).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);
  });

  it("ignores a stale teardown after a reconnect (TASK-102)", () => {
    const first = presence.join("b1", "a1", alice);
    const second = presence.join("b1", "a1", alice);
    presence.leave("b1", "a1", first);
    expect(presence.roster("b1")).toHaveLength(1);
    presence.leave("b1", "a1", second);
    expect(presence.roster("b1")).toHaveLength(0);
  });

  it("only the owning user may refresh a ping (TASK-102)", () => {
    presence.join("b1", "a1", alice);
    expect(presence.touch("b1", "a1", "u-bob")).toBe(false);
    expect(presence.touch("b1", "a1", "u-alice")).toBe(true);
  });

  it("heartbeat re-broadcasts only boards with fresh connections", () => {
    const seen = collector(realtime);
    const other = collector(realtime, "b2");
    presence.join("b1", "a1", alice);
    seen.length = 0;

    presence.heartbeat();
    expect(seen).toHaveLength(1);
    expect(seen[0].users).toEqual([
      {
        id: "u-alice",
        displayName: "Alice",
        avatarColor: "blue",
        avatarPath: null,
      },
    ]);
    expect(other).toHaveLength(0);

    presence.sweep(Date.now() + PRESENCE_TTL_MS + 1);
    seen.length = 0;
    presence.heartbeat();
    expect(seen).toHaveLength(0);
  });
});
