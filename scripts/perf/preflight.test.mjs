import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, resolveConfig } from "./lib/config.mjs";
import {
  PreflightError,
  requiredIdentities,
  selectBoards,
  validateTokenIdentity,
} from "./lib/preflight.mjs";

function identity(overrides = {}) {
  return {
    id: "user-1",
    token: "jnk_x",
    tokenIdentity: {
      id: "token-1",
      name: "perf",
      scopePreset: "worker",
      trustedCi: false,
      effectiveTokenScope: "worker",
      boardId: null,
      readOnly: false,
      rateLimitPerMinute: null,
      individualPausedAt: null,
      stopAllPausedAt: null,
      paused: false,
      ...overrides,
    },
  };
}

function board(id, role = "MEMBER", archivedAt = undefined) {
  return {
    id,
    title: id,
    role,
    archivedAt,
    counters: { cards: 1, columns: 1 },
  };
}

test("validateTokenIdentity rejects read-only, paused and observer tokens", () => {
  assert.throws(
    () =>
      validateTokenIdentity(
        identity({ readOnly: true, effectiveTokenScope: "observer" }),
        0,
      ),
    /token 1 is read-only/,
  );
  assert.throws(
    () => validateTokenIdentity(identity({ paused: true }), 1),
    /token 2 is paused/,
  );
  assert.throws(
    () =>
      validateTokenIdentity(
        identity({ scopePreset: "observer", effectiveTokenScope: "observer" }),
        2,
      ),
    /token 3 has token scope observer/,
  );
  assert.throws(
    () =>
      validateTokenIdentity(
        { id: "u", token: "jnk_x", tokenIdentity: null },
        0,
      ),
    /not a personal API token/,
  );
  assert.equal(validateTokenIdentity(identity(), 0).id, "user-1");
});

test("selectBoards validates every token and board, with indexed errors", () => {
  const users = [identity(), { ...identity(), id: "user-2" }];
  assert.deepEqual(
    selectBoards({
      users,
      lists: [
        [board("b1"), board("b2")],
        [board("b1"), board("b2")],
      ],
      explicitBoards: [],
      boardsCount: 2,
    }),
    ["b1", "b2"],
  );

  assert.throws(
    () =>
      selectBoards({
        users,
        lists: [[board("b1"), board("b2")], [board("b1")]],
        explicitBoards: ["b1", "b2"],
        boardsCount: 2,
      }),
    /token 2, board 2 \(b2\): not a member/,
  );
  assert.throws(
    () =>
      selectBoards({
        users,
        lists: [[board("b1", "VIEWER")]],
        explicitBoards: ["b1"],
        boardsCount: 1,
      }),
    /token 1, board 1 \(b1\): role VIEWER cannot write/,
  );
  assert.throws(
    () =>
      selectBoards({
        users,
        lists: [[board("b1", "MEMBER", 123)]],
        explicitBoards: ["b1"],
        boardsCount: 1,
      }),
    /board is archived/,
  );
  assert.throws(
    () =>
      selectBoards({
        users,
        lists: [[]],
        explicitBoards: [],
        boardsCount: 1,
      }),
    PreflightError,
  );
});

test("requiredIdentities uses actual MCP workers, not requested agents", () => {
  const http = resolveConfig(
    parseCli(["--scenario", "S2", "--token", "jnk_x", "--agents", "100"]),
    {},
  );
  assert.equal(requiredIdentities(http), 100);

  const mcp = resolveConfig(
    parseCli([
      "--scenario",
      "S2",
      "--driver",
      "mcp",
      "--token",
      "jnk_x",
      "--agents",
      "100",
      "--mcp-processes",
      "2",
    ]),
    {},
  );
  assert.equal(requiredIdentities(mcp), 2);

  const mcpDefault = resolveConfig(
    parseCli(["--scenario", "S2", "--driver", "mcp", "--token", "jnk_x"]),
    {},
  );
  assert.equal(requiredIdentities(mcpDefault), 100);
});
