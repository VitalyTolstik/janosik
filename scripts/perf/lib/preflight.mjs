// TASK-200.1 — fail before load when an identity or board cannot write.
//
// A 500-agent run is expensive; discovering at cycle 1 that token 37 is a
// read-only observer, or that token 12 is not a member of board 3, wastes the
// whole ramp. This module validates every token identity and every selected
// board/token pair before the first scenario starts.

import { scenarioConfig } from "./config.mjs";

export class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}

const WRITE_SCOPES = new Set(["worker", "reviewer", "admin"]);
const WRITE_ROLES = new Set(["ADMIN", "MEMBER"]);

/** How many distinct identities the write scenarios actually start. */
export function requiredIdentities(config) {
  let required = 0;
  for (const id of config.scenarioIds) {
    if (!["S2", "S3", "S4"].includes(id)) continue;
    const scenario = scenarioConfig(config, id);
    const agents = scenario.agents ?? 0;
    const usesMcp =
      config.driver === "mcp" && ["S1", "S2", "S3", "S4"].includes(id);
    const actual = usesMcp
      ? config.mode === "smoke"
        ? Math.min(config.mcpProcesses ?? agents, 2)
        : (config.mcpProcesses ?? agents)
      : agents;
    required = Math.max(required, actual);
  }
  return required;
}

export function validateTokenIdentity(user, index) {
  const label = `token ${index + 1}`;
  const token = user?.tokenIdentity;
  if (token === null || token === undefined) {
    throw new PreflightError(
      `${label} is not a personal API token (GET /auth/me returned no token identity)`,
    );
  }
  if (token.readOnly === true) {
    throw new PreflightError(
      `${label} is read-only and cannot run the write path`,
    );
  }
  if (
    token.paused === true ||
    (token.individualPausedAt !== null &&
      token.individualPausedAt !== undefined) ||
    (token.stopAllPausedAt !== null && token.stopAllPausedAt !== undefined)
  ) {
    throw new PreflightError(`${label} is paused`);
  }
  const scope = token.effectiveTokenScope ?? token.scopePreset;
  if (!WRITE_SCOPES.has(scope)) {
    throw new PreflightError(
      `${label} has token scope ${scope ?? "unknown"}; worker or higher is required`,
    );
  }
  if (typeof token.boardId === "string" && token.boardId !== "") {
    // Informational: the per-board membership check still has to pass, but a
    // board-scoped token can never satisfy a multi-board selection.
    user.boardScope = token.boardId;
  }
  return user;
}

export function selectBoards({ users, lists, explicitBoards, boardsCount }) {
  let ids;
  if (explicitBoards.length > 0) {
    ids = [...explicitBoards];
  } else {
    ids = (lists[0] ?? [])
      .filter(
        (board) =>
          board?.archivedAt === undefined || board?.archivedAt === null,
      )
      .map((board) => board?.id)
      .filter((id) => typeof id === "string")
      .slice(0, boardsCount);
    if (ids.length === 0) {
      throw new PreflightError(
        "no boards visible to token 1; pass --board <id> or create one",
      );
    }
  }

  for (let tokenIndex = 0; tokenIndex < users.length; tokenIndex += 1) {
    const summaries = new Map(
      (lists[tokenIndex] ?? []).map((board) => [board?.id, board]),
    );
    for (let boardIndex = 0; boardIndex < ids.length; boardIndex += 1) {
      const boardId = ids[boardIndex];
      const label = `token ${tokenIndex + 1}, board ${boardIndex + 1} (${boardId})`;
      const summary = summaries.get(boardId);
      if (summary === undefined) {
        throw new PreflightError(
          `${label}: not a member (or the board does not exist)`,
        );
      }
      if (summary.archivedAt !== undefined && summary.archivedAt !== null) {
        throw new PreflightError(`${label}: board is archived`);
      }
      if (!WRITE_ROLES.has(summary.role)) {
        throw new PreflightError(
          `${label}: role ${summary.role ?? "unknown"} cannot write; ADMIN or MEMBER is required`,
        );
      }
    }
  }
  return ids;
}
