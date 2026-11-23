import assert from "node:assert/strict";
import test from "node:test";
import {
  boardWorkState,
  buildClaimAction,
  buildCommentBody,
  buildMoveAction,
  buildReleaseAction,
  findDoneColumn,
  isDoneTitle,
  jitteredDelay,
  mulberry32,
  newCommandId,
  performAgentCycle,
  pickWork,
  recycleDoneCards,
  releaseClaim,
  runMixedAgentLoop,
} from "./lib/agent.mjs";

function board() {
  return {
    id: "b1",
    columns: [
      { id: "todo", title: "To do", cardIds: ["c1", "c2"] },
      { id: "doing", title: "In progress", cardIds: ["c3"] },
      { id: "done", title: "Done", cardIds: ["c4"] },
    ],
    cards: {
      c1: {
        id: "c1",
        title: "claimed",
        claimedBy: "other",
        leaseUntil: Date.now() + 60_000,
        labelIds: [],
      },
      c2: { id: "c2", title: "free", labelIds: [] },
      c3: { id: "c3", title: "free too", labelIds: [] },
      c4: { id: "c4", title: "finished", labelIds: [] },
    },
  };
}

test("Done matching is Unicode-aware and works in a non-last column", () => {
  assert.equal(isDoneTitle("Готово"), true);
  assert.equal(isDoneTitle("Готово!"), true);
  assert.equal(isDoneTitle("Выполнено"), true);
  assert.equal(isDoneTitle("In progress"), false);
  assert.equal(
    findDoneColumn({
      columns: [
        { id: "todo", title: "Todo" },
        { id: "done-ru", title: "Готово" },
        { id: "archive", title: "Archive" },
      ],
    }).id,
    "done-ru",
  );
  assert.equal(
    findDoneColumn({
      columns: [
        { id: "todo", title: "Todo" },
        { id: "later", title: "Later" },
      ],
    }).id,
    "later",
  );
  assert.equal(findDoneColumn({ columns: [] }), null);
});

test("pickWork skips Done and live claims, rotates candidates", () => {
  const work0 = pickWork(board(), { startIndex: 0, now: Date.now() });
  const work1 = pickWork(board(), { startIndex: 1, now: Date.now() });
  assert.equal(work0.cardId, "c2");
  assert.equal(work0.fromColumnId, "todo");
  assert.equal(work0.toColumnId, "done");
  assert.equal(work0.toIndex, 1);
  assert.equal(work1.cardId, "c3");
  assert.equal(work1.fromColumnId, "doing");
});

test("pickWork allows expired leases and reports exhaustion and stranding", () => {
  const leased = board();
  leased.cards.c1.leaseUntil = Date.now() - 1_000;
  const work = pickWork(leased, { startIndex: 0, now: Date.now() });
  assert.equal(work.cardId, "c1");

  const empty = board();
  empty.columns[0].cardIds = [];
  empty.columns[1].cardIds = [];
  const state = boardWorkState(empty);
  assert.equal(state.exhausted, true);
  assert.equal(pickWork(empty), null);

  const stranded = board();
  stranded.columns[0].cardIds = ["c1"];
  stranded.columns[1].cardIds = [];
  stranded.cards.c1.leaseUntil = Date.now() + 60_000;
  const strandedState = boardWorkState(stranded);
  assert.equal(strandedState.stranded, true);
  assert.equal(strandedState.exhausted, false);
});

test("command bodies carry the real wire contract: type, at, boardId", () => {
  const at = 1_700_000_000_000;
  assert.deepEqual(
    buildClaimAction({
      cardId: "c1",
      userId: "u1",
      leaseUntil: at + 60_000,
      boardId: "b1",
      at,
    }),
    {
      type: "CLAIM_CARD",
      at,
      boardId: "b1",
      cardId: "c1",
      claimedBy: "u1",
      leaseUntil: at + 60_000,
    },
  );
  const work = {
    cardId: "c1",
    fromColumnId: "todo",
    fromIndex: 2,
    toColumnId: "done",
    toIndex: 5,
  };
  assert.deepEqual(buildMoveAction(work, { boardId: "b1", at }), {
    type: "MOVE_CARD",
    at,
    boardId: "b1",
    cardId: "c1",
    fromColumnId: "todo",
    fromIndex: 2,
    toColumnId: "done",
    toIndex: 5,
  });
  assert.deepEqual(buildReleaseAction({ cardId: "c1", boardId: "b1", at }), {
    type: "CLAIM_CARD",
    at,
    boardId: "b1",
    cardId: "c1",
    claimedBy: null,
    leaseUntil: null,
  });
  assert.deepEqual(buildCommentBody({ text: "hi", commandId: "x" }), {
    text: "hi",
    kind: "note",
    commandId: "x",
  });
});

test("command ids are idempotency-safe and unique", () => {
  const first = newCommandId("claim");
  const second = newCommandId("claim");
  assert.match(first, /^claim-[A-Za-z0-9-]+$/);
  assert.equal(first.length <= 64, true);
  assert.notEqual(first, second);
});

test("performAgentCycle retries a 409 and posts claim → comment → move", async () => {
  const calls = [];
  let claimCalls = 0;
  const client = {
    async readBoard() {
      calls.push("read");
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      claimCalls += 1;
      calls.push(`claim:${command.ifMatch}:${command.action.boardId}`);
      assert.equal(Number.isFinite(command.action.at), true);
      if (claimCalls === 1) return { status: 409, json: {} };
      return { status: 200, json: { seq: 11 } };
    },
    async comment(cardId, body) {
      calls.push(`comment:${cardId}:${body.commandId.startsWith("comment-")}`);
      return { status: 201 };
    },
    async move(_boardId, command) {
      calls.push(`move:${command.ifMatch}:${command.action.boardId}`);
      assert.equal(Number.isFinite(command.action.at), true);
      return { status: 200, json: { seq: 12 } };
    },
  };
  const result = await performAgentCycle({
    client,
    boardId: "b1",
    userId: "u1",
    leaseMs: 60_000,
    commentText: "probe",
  });
  assert.deepEqual(result, {
    idle: false,
    cycle: true,
    conflicts: 1,
    actions: 3,
    cardId: "c3",
    orphan: false,
  });
  assert.deepEqual(calls, [
    "read",
    "claim:10:b1",
    "read",
    "claim:10:b1",
    "comment:c3:true",
    "move:11:b1",
  ]);
});

test("a failed comment releases the claim and keeps the successful write counted", async () => {
  const actions = [];
  let release = null;
  let claimCalls = 0;
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      claimCalls += 1;
      if (claimCalls > 1) {
        release = command.action;
        return { status: 200, json: { seq: 12 } };
      }
      return { status: 200, json: { seq: 11 } };
    },
    async comment() {
      const error = new Error("comment.create -> 429");
      error.status = 429;
      throw error;
    },
    async move() {
      throw new Error("move must not run after a failed comment");
    },
  };
  const result = await performAgentCycle({
    client,
    boardId: "b1",
    userId: "u1",
    leaseMs: 60_000,
    commentText: "probe",
    onAction: (kind) => actions.push(kind),
  });
  assert.equal(result.failure.status, 429);
  assert.equal(result.actions, 1);
  assert.deepEqual(actions, ["write"]);
  assert.equal(result.orphan, false);
  assert.equal(release.claimedBy, null);
  assert.equal(release.leaseUntil, null);
});

test("a move 409 releases the claim and retries a fresh cycle", async () => {
  let moves = 0;
  let releases = 0;
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) {
        releases += 1;
        return { status: 200, json: { seq: 15 } };
      }
      return { status: 200, json: { seq: 11 } };
    },
    async comment() {
      return { status: 201 };
    },
    async move() {
      moves += 1;
      if (moves === 1) return { status: 409, json: {} };
      return { status: 200, json: { seq: 12 } };
    },
  };
  const result = await performAgentCycle({
    client,
    boardId: "b1",
    userId: "u1",
    leaseMs: 60_000,
    commentText: "probe",
  });
  assert.equal(result.cycle, true);
  assert.equal(result.conflicts, 1);
  assert.equal(result.actions, 5);
  assert.equal(releases, 1);
  assert.equal(result.orphan, false);
});

test("a claim validation 400 is an error, not a lease conflict", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim() {
      const error = new Error("command.claim -> 400");
      error.status = 400;
      error.body = JSON.stringify({
        message: "Invalid command (action.at): at is required",
        field: "action.at",
      });
      throw error;
    },
    async comment() {
      throw new Error("must not comment");
    },
    async move() {
      throw new Error("must not move");
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    /command\.claim -> 400/,
  );
});

test("an unknown claim outcome attempts a release before the next cycle", async () => {
  let releases = 0;
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) {
        releases += 1;
        return { status: 200, json: { seq: 12 } };
      }
      throw new Error("fetch failed after the server may have committed");
    },
    async comment() {
      throw new Error("must not comment");
    },
    async move() {
      throw new Error("must not move");
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) => error.orphan === false,
  );
  assert.equal(releases, 1);
});

test("an unknown claim outcome whose cleanup has no holder is not an orphan", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) return { status: 409 };
      throw new Error("network timeout");
    },
    async comment() {
      throw new Error("must not comment");
    },
    async move() {
      throw new Error("must not move");
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) => error.orphan === false,
  );
});

test("an unknown claim outcome whose cleanup fails server-side is an orphan", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) return { status: 500 };
      throw new Error("network timeout");
    },
    async comment() {
      throw new Error("must not comment");
    },
    async move() {
      throw new Error("must not move");
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) => error.orphan === true,
  );
});

test("a deadline-aborted claim releases through the cleanup client without an orphan", async () => {
  let cleanupReleases = 0;
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim() {
      const error = new Error("aborted by scenario deadline");
      error.status = -1;
      throw error;
    },
    async comment() {
      throw new Error("must not comment");
    },
    async move() {
      throw new Error("must not move");
    },
  };
  const cleanupClient = {
    async claim(_boardId, command) {
      assert.equal(command.action.claimedBy, null);
      cleanupReleases += 1;
      return { status: 200, json: { seq: 11 } };
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      cleanupClient,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) => error.orphan === false && error.cleanupAborted === false,
  );
  assert.equal(cleanupReleases, 1);
});

test("a deadline-aborted claim whose cleanup also fails is not an orphan", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim() {
      const error = new Error("aborted by scenario deadline");
      error.status = -1;
      throw error;
    },
  };
  const cleanupClient = {
    async claim() {
      const error = new Error("cleanup socket closed");
      error.status = -1;
      throw error;
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      cleanupClient,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) => error.orphan === false && error.cleanupAborted === true,
  );
});

test("cleanup status 0 is an unresolved lease, not a deadline abort", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim() {
      const error = new Error("aborted by scenario deadline");
      error.status = -1;
      throw error;
    },
  };
  const cleanupClient = {
    async claim() {
      return { status: 0 };
    },
  };
  await assert.rejects(
    performAgentCycle({
      client,
      cleanupClient,
      boardId: "b1",
      userId: "u1",
      leaseMs: 60_000,
      commentText: "probe",
    }),
    (error) =>
      error.cleanupAborted === false &&
      error.cleanupFailed === true &&
      error.orphan === false,
  );
});

test("S3 mixed loop propagates cleanupFailed from a write beat", async () => {
  const errors = [];
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim() {
      const error = new Error("claim timed out");
      error.status = -1;
      throw error;
    },
  };
  const cleanupClient = {
    async claim() {
      return { status: 0 };
    },
  };
  await runMixedAgentLoop({
    client,
    cleanupClient,
    userId: "u1",
    boardId: "b1",
    config: {
      id: "S3",
      mix: { reads: 0, writes: 1, comments: 0 },
      cadenceMs: 1,
      jitter: 0,
      leaseMs: 60_000,
    },
    deadline: Date.now() + 25,
    signal: new AbortController().signal,
    random: () => 0.5,
    onError: (entry) => errors.push(entry),
  });
  assert.equal(errors.length > 0, true);
  assert.equal(
    errors.every(
      (entry) => entry.cleanupFailed === true && entry.orphan === false,
    ),
    true,
  );
});

test("a network failure during the move releases the claim", async () => {
  let released = false;
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) {
        released = true;
        return { status: 200, json: { seq: 12 } };
      }
      return { status: 200, json: { seq: 11 } };
    },
    async comment() {
      return { status: 201 };
    },
    async move() {
      throw new Error("fetch failed");
    },
  };
  const result = await performAgentCycle({
    client,
    boardId: "b1",
    userId: "u1",
    leaseMs: 60_000,
    commentText: "probe",
  });
  assert.equal(released, true);
  assert.equal(result.actions, 2);
  assert.match(result.failure.message, /fetch failed/);
});

test("releaseClaim treats an allowed 409 as a failed release", async () => {
  assert.equal(
    await releaseClaim({
      client: {
        async claim() {
          return { status: 409 };
        },
      },
      boardId: "b1",
      cardId: "c1",
    }),
    false,
  );
});

test("a comment failure with a 409 release is surfaced as an orphan", async () => {
  const client = {
    async readBoard() {
      return { board: board(), seq: 10 };
    },
    async claim(_boardId, command) {
      if (command.action.claimedBy === null) return { status: 409 };
      return { status: 200, json: { seq: 11 } };
    },
    async comment() {
      const error = new Error("comment.create -> 429");
      error.status = 429;
      throw error;
    },
    async move() {
      throw new Error("must not move");
    },
  };
  const result = await performAgentCycle({
    client,
    boardId: "b1",
    userId: "u1",
    leaseMs: 60_000,
    commentText: "probe",
  });
  assert.equal(result.actions, 1);
  assert.equal(result.orphan, true);
});

test("recycleDoneCards tolerates a 400/409 release as a no-holder case", async () => {
  let moved = false;
  const result = await recycleDoneCards({
    client: {
      async readBoard() {
        return { board: board(), seq: 10 };
      },
      async claim() {
        return { status: 409 };
      },
      async move() {
        moved = true;
        return { status: 200 };
      },
    },
    boardId: "b1",
  });
  assert.deepEqual(result, { moved: 1, orphans: 0 });
  assert.equal(moved, true);
});

test("recycleDoneCards still stops on a real release failure", async () => {
  let moved = false;
  const result = await recycleDoneCards({
    client: {
      async readBoard() {
        return { board: board(), seq: 10 };
      },
      async claim() {
        return { status: 500 };
      },
      async move() {
        moved = true;
        return { status: 200 };
      },
    },
    boardId: "b1",
  });
  assert.deepEqual(result, { moved: 0, orphans: 1 });
  assert.equal(moved, false);
});

test("a delayed worker reports its first request after the start delay", async () => {
  const { runAgentLoop } = await import("./lib/agent.mjs");
  const starts = [];
  const started = Date.now();
  await runAgentLoop({
    client: {
      async readBoard() {
        return { board: board(), seq: 1 };
      },
    },
    userId: "u1",
    boardId: "b1",
    mode: "idle",
    config: { id: "S4", cadenceMs: 1_000, jitter: 0, idleEndpoint: "board" },
    deadline: started + 220,
    signal: new AbortController().signal,
    random: () => 0.5,
    startDelayMs: 80,
    onFirstRequest: (ts) => starts.push(ts),
  });
  assert.equal(starts.length, 1);
  assert.equal(starts[0] - started >= 70, true);
});

test("jitter and PRNG helpers stay bounded and deterministic", () => {
  assert.equal(
    jitteredDelay(1_000, 0.2, () => 0),
    800,
  );
  assert.equal(
    jitteredDelay(1_000, 0.2, () => 1),
    1_200,
  );
  assert.equal(
    jitteredDelay(100, 0.5, () => 0),
    50,
  );
  const first = mulberry32(7);
  const second = mulberry32(7);
  const values = Array.from({ length: 5 }, () => first());
  assert.deepEqual(
    values,
    Array.from({ length: 5 }, () => second()),
  );
  assert.equal(
    values.every((value) => value >= 0 && value < 1),
    true,
  );
});
