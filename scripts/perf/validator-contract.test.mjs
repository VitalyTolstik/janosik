import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildClaimAction, buildMoveAction } from "./lib/agent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
const check = path.join(here, "validator-check.ts");

function validate(input) {
  const output = execFileSync(tsx, [check, JSON.stringify(input)], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  return JSON.parse(output);
}

test("the built claim and move actions pass the shared command validator", () => {
  const at = Date.now();
  const claim = buildClaimAction({
    cardId: "card-1",
    userId: "user-1",
    leaseUntil: at + 300_000,
    boardId: "board-1",
    at,
  });
  const move = buildMoveAction(
    {
      cardId: "card-1",
      fromColumnId: "col-todo",
      fromIndex: 0,
      toColumnId: "col-done",
      toIndex: 0,
    },
    { boardId: "board-1", at },
  );
  for (const action of [claim, move]) {
    const result = validate(action);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.action.type, action.type);
    assert.equal(result.action.at, at);
    assert.equal(result.action.boardId, "board-1");
  }
});

test("the shared validator rejects exactly the omissions the mock catches", () => {
  const at = Date.now();
  const noAt = {
    type: "CLAIM_CARD",
    boardId: "board-1",
    cardId: "card-1",
    claimedBy: "user-1",
    leaseUntil: at + 300_000,
  };
  const missingAt = validate(noAt);
  assert.equal(missingAt.ok, false);
  assert.equal(missingAt.field, "action.at");

  const missingType = validate({ ...noAt, type: undefined, at });
  assert.equal(missingType.ok, false);
  assert.equal(missingType.field, "action.type");

  const badMove = validate({
    type: "MOVE_CARD",
    at,
    boardId: "board-1",
    cardId: "card-1",
    fromColumnId: "todo",
    fromIndex: -1,
    toColumnId: "done",
    toIndex: 0,
  });
  assert.equal(badMove.ok, false);
  assert.match(badMove.field, /fromIndex/);

  const tooLong = validate({
    ...buildClaimAction({
      cardId: "card-1",
      userId: "user-1",
      leaseUntil: at + 24 * 60 * 60 * 1000 + 1,
      boardId: "board-1",
      at,
    }),
  });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.field, /leaseUntil/);
});
