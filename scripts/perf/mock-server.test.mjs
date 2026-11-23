import assert from "node:assert/strict";
import test from "node:test";
import { HttpClient } from "./lib/http.mjs";
import { RunMetrics } from "./lib/metrics.mjs";
import { startMockServer } from "./lib/mock-server.mjs";

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
  assert.equal((await client.me()).id.startsWith("mock-user-"), true);
  const boards = await client.listBoards();
  assert.equal(boards.length, 2);
  const { board, seq } = await client.readBoard(boards[0].id);
  assert.equal(board.columns.length, 3);
  assert.equal(seq, 1);

  const cardId = board.columns[0].cardIds[0];
  const claim = await client.claim(boards[0].id, {
    commandId: "claim-test",
    action: {
      type: "CLAIM_CARD",
      cardId,
      claimedBy: "ignored",
      leaseUntil: Date.now() + 60_000,
    },
    ifMatch: 1,
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.json.seq, 2);

  const conflict = await client.claim(boards[0].id, {
    commandId: "claim-stale",
    action: { type: "CLAIM_CARD", cardId, claimedBy: null, leaseUntil: null },
    ifMatch: 1,
  });
  assert.equal(conflict.status, 409);

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
});
