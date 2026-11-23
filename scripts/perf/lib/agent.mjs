// TASK-200.1 — agent behaviour: idle polling and claim → comment → move.

import { randomUUID } from "node:crypto";
import { HttpError, sleep } from "./http.mjs";

const DONE_TITLE = /\b(done|completed?|готово|выполнено|завершено)\b/i;

/** Last column, or the first one whose title looks like Done. */
export function findDoneColumn(board) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  return (
    columns.find((column) => DONE_TITLE.test(String(column?.title ?? ""))) ??
    columns[columns.length - 1] ??
    null
  );
}

/**
 * Pick an unclaimed card outside the Done column. `startIndex` rotates the
 * candidate list so a swarm does not send every agent at the first card.
 */
export function pickWork(board, { now = Date.now(), startIndex = 0 } = {}) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  const done = findDoneColumn(board);
  if (done === null || columns.length < 2) return null;
  const cards = board?.cards ?? {};
  const candidates = [];
  for (const column of columns) {
    if (column.id === done.id) continue;
    const cardIds = Array.isArray(column.cardIds) ? column.cardIds : [];
    for (let index = 0; index < cardIds.length; index += 1) {
      const card = cards[cardIds[index]];
      if (card === undefined || card === null) continue;
      const leased =
        typeof card.claimedBy === "string" &&
        typeof card.leaseUntil === "number" &&
        card.leaseUntil > now;
      if (leased) continue;
      candidates.push({
        cardId: card.id,
        title: card.title,
        fromColumnId: column.id,
        fromIndex: index,
        toColumnId: done.id,
        toIndex: Array.isArray(done.cardIds) ? done.cardIds.length : 0,
      });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.abs(startIndex) % candidates.length];
}

export function buildClaimAction({ cardId, userId, leaseUntil }) {
  return { type: "CLAIM_CARD", cardId, claimedBy: userId, leaseUntil };
}

export function buildMoveAction(work) {
  return {
    type: "MOVE_CARD",
    cardId: work.cardId,
    fromColumnId: work.fromColumnId,
    fromIndex: work.fromIndex,
    toColumnId: work.toColumnId,
    toIndex: work.toIndex,
  };
}

export function buildCommentBody({ text, commandId }) {
  return { text, kind: "note", commandId };
}

export function newCommandId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function statusOf(error) {
  return error instanceof HttpError ? error.status : 0;
}

/**
 * One `read → claim → comment → move`. A 409 is a measured outcome, not a
 * crash: the cycle rereads the board and retries once (`maxConflicts`).
 */
export async function performAgentCycle({
  client,
  boardId,
  userId,
  leaseMs,
  commentText,
  maxConflicts = 2,
  startIndex = 0,
} = {}) {
  let conflicts = 0;
  let actions = 0;
  for (let attempt = 0; attempt <= maxConflicts; attempt += 1) {
    const { board, seq } = await client.readBoard(boardId);
    const work = pickWork(board, { startIndex: startIndex + attempt });
    if (work === null) return { idle: true, conflicts };
    const claim = await client.claim(boardId, {
      commandId: newCommandId("claim"),
      action: buildClaimAction({
        cardId: work.cardId,
        userId,
        leaseUntil: Date.now() + leaseMs,
      }),
      ifMatch: seq,
    });
    if (claim.status === 409) {
      conflicts += 1;
      continue;
    }
    actions += 1;
    const claimSeq = Number(claim.json?.seq ?? seq);

    const commandId = newCommandId("comment");
    await client.comment(
      work.cardId,
      buildCommentBody({ text: commentText, commandId }),
      { idempotencyKey: commandId },
    );
    actions += 1;

    const move = await client.move(boardId, {
      commandId: newCommandId("move"),
      action: buildMoveAction(work),
      ifMatch: claimSeq,
    });
    if (move.status === 409) {
      conflicts += 1;
      continue;
    }
    actions += 1;
    return {
      idle: false,
      cycle: true,
      conflicts,
      actions,
      cardId: work.cardId,
    };
  }
  return { idle: false, cycle: false, conflicts, actions };
}

/** Deterministic PRNG so a run can be replayed with the same jitter. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function jitteredDelay(cadenceMs, jitter, random) {
  const factor = 1 + (random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(cadenceMs * factor));
}

async function idleOnce(client, boardId, endpoint) {
  if (endpoint === "ready") {
    const response = await client.readReady(boardId);
    return response.status !== 404;
  }
  await client.readBoard(boardId);
  return true;
}

/**
 * Run one simulated agent until `deadline`. Errors are counted by the HTTP
 * client and reported through `onError`; one failed cycle never stops the
 * swarm, so a run can measure a 5xx storm instead of dying on the first one.
 */
export async function runAgentLoop({
  client,
  userId,
  boardId,
  agentIndex = 0,
  mode = "work",
  config,
  deadline,
  signal,
  metrics,
  random,
  startDelayMs = 0,
  onError,
}) {
  if (startDelayMs > 0) await sleep(startDelayMs, signal);
  let readyFallback = false;
  while (!signal.aborted && Date.now() < deadline) {
    const cycleStarted = Date.now();
    try {
      if (mode === "idle") {
        const endpoint =
          readyFallback || config.idleEndpoint !== "ready" ? "board" : "ready";
        const supported = await idleOnce(client, boardId, endpoint);
        if (!supported && !readyFallback) {
          readyFallback = true;
          await client.readBoard(boardId);
        }
      } else {
        const result = await performAgentCycle({
          client,
          boardId,
          userId,
          leaseMs: config.leaseMs,
          commentText: `TASK-200.1 perf probe (${config.id})`,
          startIndex: agentIndex,
        });
        if (!result.idle) {
          if (result.actions > 0) metrics.recordAction(result.actions);
          if (result.cycle) metrics.recordCycle();
        }
      }
    } catch (error) {
      if (statusOf(error) === 401 || statusOf(error) === 403) {
        onError?.({ agentIndex, boardId, error, fatal: true });
        return;
      }
      onError?.({ agentIndex, boardId, error, fatal: false });
    }
    const elapsed = Date.now() - cycleStarted;
    const delay = jitteredDelay(config.cadenceMs, config.jitter ?? 0, random);
    if (elapsed < delay) await sleep(delay - elapsed, signal);
  }
}

/** Human-like REST reader for S3: board, plus an activity read every third beat. */
export async function runHumanLoop({
  client,
  boardId,
  workerIndex = 0,
  config,
  deadline,
  signal,
  random,
  onError,
}) {
  let beat = 0;
  while (!signal.aborted && Date.now() < deadline) {
    const started = Date.now();
    try {
      await client.readBoard(boardId);
      if (beat % 3 === 2) await client.readActivity(boardId);
    } catch (error) {
      onError?.({ workerIndex, boardId, error, fatal: false });
    }
    beat += 1;
    const delay = jitteredDelay(config.cadenceMs, config.jitter ?? 0, random);
    const elapsed = Date.now() - started;
    if (elapsed < delay) await sleep(delay - elapsed, signal);
  }
}
