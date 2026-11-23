import assert from "node:assert/strict";
import test from "node:test";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { startMockServer } from "./lib/mock-server.mjs";

function command(client, boardId, body) {
  return client.request("command", `/boards/${boardId}/commands`, {
    method: "POST",
    body,
    allowStatuses: [400, 409],
  });
}

test("mock server exercises the routes used by the harness", async (t) => {
  const mock = await startMockServer({ boardCount: 2, cardsPerBoard: 6 });
  t.after(() => mock.close());
  const metrics = new RunMetrics("mock");
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-test-token",
    metrics,
  });

  assert.equal((await client.health()).status, 200);
  const me = await client.me();
  assert.equal(me.id.startsWith("mock-user-"), true);
  const boards = await client.listBoards();
  assert.equal(boards.length, 2);
  const { board, seq } = await client.readBoard(boards[0].id);
  assert.equal(board.columns.length, 3);
  assert.equal(seq, 1);
  assert.equal((await client.readReady(boards[0].id)).status, 200);

  const cardId = board.columns[0].cardIds[0];
  const claimBody = {
    commandId: "claim-test",
    action: {
      type: "CLAIM_CARD",
      at: Date.now(),
      boardId: boards[0].id,
      cardId,
      claimedBy: me.id,
      leaseUntil: Date.now() + 60_000,
    },
    ifMatch: 1,
  };
  const claim = await client.claim(boards[0].id, claimBody);
  assert.equal(claim.status, 200);
  assert.equal(claim.json.seq, 2);
  assert.equal(Object.keys(claim.json.versions).length > 0, true);

  // A replay of the same command id + payload is idempotent.
  const replay = await client.claim(boards[0].id, claimBody);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.seq, 2);

  const conflict = await client.claim(boards[0].id, {
    commandId: "claim-stale",
    action: {
      type: "CLAIM_CARD",
      at: Date.now(),
      boardId: boards[0].id,
      cardId,
      claimedBy: null,
      leaseUntil: null,
    },
    ifMatch: 1,
  });
  assert.equal(conflict.status, 409);

  const missingAt = await command(client, boards[0].id, {
    commandId: "missing-at",
    action: {
      type: "CLAIM_CARD",
      boardId: boards[0].id,
      cardId,
      claimedBy: null,
      leaseUntil: null,
    },
    ifMatch: 2,
  });
  assert.equal(missingAt.status, 400);
  assert.equal(missingAt.json.field, "action.at");

  const missingType = await command(client, boards[0].id, {
    commandId: "missing-type",
    action: {
      at: Date.now(),
      boardId: boards[0].id,
      cardId,
      claimedBy: null,
      leaseUntil: null,
    },
    ifMatch: 2,
  });
  assert.equal(missingType.status, 400);
  assert.equal(missingType.json.field, "action.type");

  const missingCommandId = await command(client, boards[0].id, {
    action: {
      type: "CLAIM_CARD",
      at: Date.now(),
      boardId: boards[0].id,
      cardId,
      claimedBy: null,
      leaseUntil: null,
    },
    ifMatch: 2,
  });
  assert.equal(missingCommandId.status, 400);
  assert.equal(missingCommandId.json.field, "commandId");

  // The real API answers a live lease held by another identity with 400, not
  // 409; the mock has to do the same or it trains the harness to ignore 400s.
  const other = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-other-token",
    metrics,
  });
  const leaseConflict = await command(other, boards[0].id, {
    commandId: "claim-other",
    action: {
      type: "CLAIM_CARD",
      at: Date.now(),
      boardId: boards[0].id,
      cardId,
      claimedBy: (await other.me()).id,
      leaseUntil: Date.now() + 60_000,
    },
    ifMatch: 2,
  });
  assert.equal(leaseConflict.status, 400);
  assert.match(leaseConflict.json.message, /claimed by another member/);

  const comment = await client.comment(cardId, {
    text: "probe",
    kind: "note",
    commandId: "comment-test",
  });
  assert.equal(comment.status, 201);

  const activity = await client.readActivity(boards[0].id);
  assert.equal(activity.status, 200);

  const sse = await client.openSse({ boardId: boards[0].id });
  assert.equal(sse.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await sse.close();
  assert.equal(metrics.sse.opened, 1);
  assert.equal(metrics.sse.current, 0);
  assert.equal(metrics.sse.closed, 1);
  assert.equal(mock.stats().statuses["400"] >= 4, true);
});

test("mock rejects a move with a missing boardId or bad indexes", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-test-token",
    metrics: new RunMetrics("mock"),
  });
  const { board } = await client.readBoard("board-1");
  const cardId = board.columns[0].cardIds[0];
  const missingBoard = await command(client, "board-1", {
    commandId: "move-missing-board",
    action: {
      type: "MOVE_CARD",
      at: Date.now(),
      cardId,
      fromColumnId: board.columns[0].id,
      fromIndex: 0,
      toColumnId: board.columns[2].id,
      toIndex: 0,
    },
  });
  assert.equal(missingBoard.status, 400);
  assert.equal(missingBoard.json.field, "action.boardId");

  const badIndex = await command(client, "board-1", {
    commandId: "move-bad-index",
    action: {
      type: "MOVE_CARD",
      at: Date.now(),
      boardId: "board-1",
      cardId,
      fromColumnId: board.columns[0].id,
      fromIndex: -1,
      toColumnId: board.columns[2].id,
      toIndex: 0,
    },
  });
  assert.equal(badIndex.status, 400);
  assert.equal(badIndex.json.field, "action.fromIndex");
});

test("mock exposes injectable 429/5xx/SSE failure modes", async (t) => {
  const mock = await startMockServer({
    boardCount: 1,
    cardsPerBoard: 4,
    commandStatus: 429,
    commentStatus: 500,
    sseStatus: 503,
  });
  t.after(() => mock.close());
  const metrics = new RunMetrics("inject");
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-inject-token",
    metrics,
  });
  const { board } = await client.readBoard("board-1");
  const cardId = board.columns[0].cardIds[0];
  const claim = await client.request(
    "command.claim",
    "/boards/board-1/commands",
    {
      method: "POST",
      body: {
        commandId: "inject-claim",
        action: {
          type: "CLAIM_CARD",
          at: Date.now(),
          boardId: "board-1",
          cardId,
          claimedBy: "u1",
          leaseUntil: Date.now() + 60_000,
        },
      },
      allowStatuses: [429],
    },
  );
  assert.equal(claim.status, 429);

  const comment = await client.request(
    "comment.create",
    `/cards/${cardId}/comments`,
    {
      method: "POST",
      body: { text: "inject" },
      allowStatuses: [500],
    },
  );
  assert.equal(comment.status, 500);

  await assert.rejects(client.openSse({ boardId: "board-1" }), /503/);
  assert.equal(metrics.sse.failed, 1);
});

test("resetBoards gives the next smoke scenario a full board again", async (t) => {
  const mock = await startMockServer({ boardCount: 1, cardsPerBoard: 4 });
  t.after(() => mock.close());
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-reset-token",
    metrics: new RunMetrics("reset"),
  });
  const before = await client.readBoard("board-1");
  const cardId = before.board.columns[0].cardIds[0];
  await client.claim("board-1", {
    commandId: "reset-claim",
    action: {
      type: "CLAIM_CARD",
      at: Date.now(),
      boardId: "board-1",
      cardId,
      claimedBy: "u1",
      leaseUntil: Date.now() + 60_000,
    },
    ifMatch: before.seq,
  });
  const mid = await client.readBoard("board-1");
  assert.equal(mid.seq, 2);
  mock.resetBoards();
  const after = await client.readBoard("board-1");
  assert.equal(after.seq, 1);
  assert.equal(after.board.cards[cardId].claimedBy, undefined);
});

test("a 200-then-immediate-close SSE counts as an early close", async (t) => {
  const mock = await startMockServer({
    boardCount: 1,
    cardsPerBoard: 2,
    sseCloseImmediately: true,
  });
  t.after(() => mock.close());
  const metrics = new RunMetrics("sse-early");
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-sse-early",
    metrics,
  });
  const handle = await client.openSse({ boardId: "board-1" });
  await handle.done;
  assert.equal(metrics.sse.opened, 1);
  assert.equal(metrics.sse.closed, 1);
  assert.equal(metrics.sse.closedEarly, 1);
  assert.equal(metrics.sse.current, 0);
});

test("an SSE open with no response headers times out", async (t) => {
  const mock = await startMockServer({
    boardCount: 1,
    cardsPerBoard: 2,
    sseHang: true,
  });
  t.after(() => mock.close());
  const metrics = new RunMetrics("sse-hang");
  const client = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-sse-hang",
    metrics,
  });
  await assert.rejects(
    client.openSse({ boardId: "board-1", openTimeoutMs: 100 }),
    /timed out/,
  );
  assert.equal(metrics.sse.failed, 1);
  assert.equal(metrics.sse.current, 0);
});

test("mock enforces token board access and role for preflight tests", async (t) => {
  const mock = await startMockServer({ boardCount: 2, cardsPerBoard: 2 });
  t.after(() => mock.close());
  const metrics = new RunMetrics("access");
  const board1 = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-board1only",
    metrics,
  });
  const viewer = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-viewer",
    metrics,
  });
  const readOnly = new HttpClient({
    baseUrl: mock.baseUrl,
    token: "perf-readonly",
    metrics,
  });
  assert.deepEqual(
    (await board1.listBoards()).map((board) => board.id),
    ["board-1"],
  );
  assert.equal((await viewer.listBoards())[0].role, "VIEWER");
  const me = await readOnly.me();
  assert.equal(me.token.readOnly, true);
  assert.equal(me.token.effectiveTokenScope, "observer");
  assert.equal((await viewer.readBoard("board-2")).status, 200);
  const denied = await board1.request("board.read", "/boards/board-2", {
    allowStatuses: [403],
  });
  assert.equal(denied.status, 403);
});
