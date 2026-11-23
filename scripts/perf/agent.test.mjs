import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaimAction,
  buildCommentBody,
  buildMoveAction,
  findDoneColumn,
  jitteredDelay,
  mulberry32,
  newCommandId,
  performAgentCycle,
  pickWork,
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

test("findDoneColumn recognises English and Russian titles, else takes last", () => {
  assert.equal(findDoneColumn(board()).id, "done");
  assert.equal(
    findDoneColumn({
      columns: [
        { id: "a", title: "Todo" },
        { id: "b", title: "Готово" },
      ],
    }).id,
    "b",
  );
  assert.equal(findDoneColumn({ columns: [{ id: "a" }, { id: "b" }] }).id, "b");
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

test("pickWork allows expired leases and returns null when empty", () => {
  const leased = board();
  leased.cards.c1.leaseUntil = Date.now() - 1_000;
  const work = pickWork(leased, { startIndex: 0, now: Date.now() });
  assert.equal(work.cardId, "c1");

  const empty = board();
  empty.columns = [
    { id: "todo", title: "Todo", cardIds: [] },
    { id: "done", title: "Done", cardIds: [] },
  ];
  assert.equal(pickWork(empty), null);
});

test("command bodies match the shared reducer shapes", () => {
  assert.deepEqual(
    buildClaimAction({ cardId: "c1", userId: "u1", leaseUntil: 123 }),
    { type: "CLAIM_CARD", cardId: "c1", claimedBy: "u1", leaseUntil: 123 },
  );
  const work = {
    cardId: "c1",
    fromColumnId: "todo",
    fromIndex: 2,
    toColumnId: "done",
    toIndex: 5,
  };
  assert.deepEqual(buildMoveAction(work), {
    type: "MOVE_CARD",
    cardId: "c1",
    fromColumnId: "todo",
    fromIndex: 2,
    toColumnId: "done",
    toIndex: 5,
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
      calls.push(`claim:${command.ifMatch}`);
      if (claimCalls === 1) return { status: 409, json: {} };
      return { status: 200, json: { seq: 11 } };
    },
    async comment(cardId, body) {
      calls.push(`comment:${cardId}:${body.commandId.startsWith("comment-")}`);
      return { status: 201 };
    },
    async move(_boardId, command) {
      calls.push(`move:${command.ifMatch}`);
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
  });
  assert.deepEqual(calls, [
    "read",
    "claim:10",
    "read",
    "claim:10",
    "comment:c3:true",
    "move:11",
  ]);
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
