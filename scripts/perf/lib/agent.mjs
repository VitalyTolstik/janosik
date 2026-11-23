// TASK-200.1 — agent behaviour: idle polling, claim → comment → move and the
// S3 mixed read/write/comment profile.

import { randomUUID } from "node:crypto";
import { HttpError, sleep } from "./http.mjs";

const DONE_WORDS = new Set([
  "done",
  "complete",
  "completed",
  "finished",
  "готово",
  "выполнено",
  "завершено",
]);

/** Unicode-aware Done-title test; `\b` does not work next to Cyrillic. */
export function isDoneTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => DONE_WORDS.has(word));
}

/** First column whose title looks like Done, else the last column. */
export function findDoneColumn(board) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  return (
    columns.find((column) => isDoneTitle(column?.title)) ??
    columns[columns.length - 1] ??
    null
  );
}

function hasLiveClaim(card, now) {
  return (
    typeof card?.claimedBy === "string" &&
    typeof card?.leaseUntil === "number" &&
    card.leaseUntil > now
  );
}

/**
 * Describe the work available on a board. `exhausted` means no card is left
 * outside Done; `stranded` means cards exist but every one is under a live
 * lease. Both are reported so a fast-draining board cannot look like a
 * successful long run.
 */
export function boardWorkState(board, { now = Date.now() } = {}) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  const done = findDoneColumn(board);
  if (done === null || columns.length < 2) {
    return {
      doneColumn: done,
      candidates: [],
      outside: 0,
      liveLeases: 0,
      exhausted: true,
      stranded: false,
    };
  }
  const cards = board?.cards ?? {};
  const candidates = [];
  let outside = 0;
  let liveLeases = 0;
  for (const column of columns) {
    if (done !== null && column.id === done.id) continue;
    const cardIds = Array.isArray(column.cardIds) ? column.cardIds : [];
    for (let index = 0; index < cardIds.length; index += 1) {
      const card = cards[cardIds[index]];
      if (card === undefined || card === null) continue;
      outside += 1;
      if (hasLiveClaim(card, now)) {
        liveLeases += 1;
        continue;
      }
      candidates.push({
        cardId: card.id,
        title: card.title,
        fromColumnId: column.id,
        fromIndex: index,
        toColumnId: done?.id,
        toIndex: Array.isArray(done?.cardIds) ? done.cardIds.length : 0,
      });
    }
  }
  return {
    doneColumn: done,
    candidates,
    outside,
    liveLeases,
    exhausted: outside === 0,
    stranded: outside > 0 && candidates.length === 0,
  };
}

/**
 * Pick an unclaimed card outside the Done column. `startIndex` rotates the
 * candidate list so a swarm does not send every agent at the first card.
 */
export function pickWork(board, { now = Date.now(), startIndex = 0 } = {}) {
  const { candidates } = boardWorkState(board, { now });
  if (candidates.length === 0) return null;
  return candidates[Math.abs(startIndex) % candidates.length];
}

/** A card a comment can be attached to (Done cards are not written to). */
export function pickCommentCard(board, { startIndex = 0 } = {}) {
  const columns = Array.isArray(board?.columns) ? board.columns : [];
  const done = findDoneColumn(board);
  const cards = board?.cards ?? {};
  const ids = [];
  for (const column of columns) {
    if (done !== null && column.id === done.id) continue;
    for (const cardId of Array.isArray(column.cardIds) ? column.cardIds : []) {
      if (cards[cardId] !== undefined) ids.push(cardId);
    }
  }
  if (ids.length === 0) return null;
  return ids[Math.abs(startIndex) % ids.length];
}

export function buildClaimAction({
  cardId,
  userId,
  leaseUntil,
  boardId,
  at = Date.now(),
}) {
  return {
    type: "CLAIM_CARD",
    at,
    ...(boardId !== undefined ? { boardId } : {}),
    cardId,
    claimedBy: userId,
    leaseUntil,
  };
}

export function buildReleaseAction({ cardId, boardId, at = Date.now() }) {
  return {
    type: "CLAIM_CARD",
    at,
    ...(boardId !== undefined ? { boardId } : {}),
    cardId,
    claimedBy: null,
    leaseUntil: null,
  };
}

export function buildMoveAction(work, { boardId, at = Date.now() } = {}) {
  return {
    type: "MOVE_CARD",
    at,
    ...(boardId !== undefined ? { boardId } : {}),
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
  return Number.isInteger(error?.status) ? error.status : 0;
}

export function isAuthError(error) {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

function seqOf(response, fallback) {
  const seq = Number(response?.json?.seq);
  return Number.isFinite(seq) ? seq : fallback;
}

function isLeaseConflict(error) {
  if (statusOf(error) !== 400) return false;
  const body = String(error?.body ?? "");
  return (
    !/Invalid command|Unsupported/i.test(body) &&
    /claimed by another|live claim|lease/i.test(body)
  );
}

/** Release a lease. Returns the HTTP status when one was received. */
export async function tryReleaseClaim({ client, boardId, cardId }) {
  try {
    const response = await client.claim(boardId, {
      commandId: newCommandId("release"),
      action: buildReleaseAction({ cardId, boardId, at: Date.now() }),
    });
    const status = Number.isInteger(response?.status) ? response.status : 0;
    return { released: status >= 200 && status < 300, status };
  } catch (error) {
    return { released: false, status: statusOf(error) };
  }
}

/** Release a lease. Returns true only when the API answered 2xx. */
export async function releaseClaim(options) {
  return (await tryReleaseClaim(options)).released;
}

function failureResult({ error, actions, conflicts, orphan }) {
  return {
    idle: false,
    cycle: false,
    conflicts,
    actions,
    failure: error,
    orphan,
    cardId: null,
  };
}

/**
 * One `read → claim → comment → move`.
 *
 * A successful write is reported through `onAction` immediately, so a later
 * 429/5xx cannot erase it from the action count. A failed comment or move
 * releases the claim before the cycle returns; a 409 releases the claim and
 * starts a fresh cycle instead of leaving an orphan lease behind.
 */
export async function performAgentCycle({
  client,
  boardId,
  userId,
  leaseMs,
  commentText,
  maxConflicts = 2,
  startIndex = 0,
  onAction,
  withComment = true,
  cleanupClient,
} = {}) {
  let conflicts = 0;
  let actions = 0;
  const record = (kind) => {
    actions += 1;
    onAction?.(kind);
  };

  for (let attempt = 0; attempt <= maxConflicts; attempt += 1) {
    const { board, seq } = await client.readBoard(boardId);
    const work = pickWork(board, { startIndex: startIndex + attempt });
    if (work === null) {
      const state = boardWorkState(board);
      return {
        idle: true,
        cycle: false,
        conflicts,
        actions,
        exhausted: state.exhausted,
        stranded: state.stranded,
      };
    }

    const claimCommandId = newCommandId("claim");
    let claim;
    try {
      claim = await client.claim(boardId, {
        commandId: claimCommandId,
        action: buildClaimAction({
          cardId: work.cardId,
          userId,
          leaseUntil: Date.now() + leaseMs,
          boardId,
          at: Date.now(),
        }),
        ifMatch: seq,
      });
    } catch (error) {
      if (statusOf(error) === 409 || isLeaseConflict(error)) {
        conflicts += 1;
        continue;
      }
      if (statusOf(error) === 0 || statusOf(error) === -1) {
        // The server may have committed the lease even though the response
        // was lost (timeout/reset/deadline abort). Use the independent
        // cleanup client; the scenario controller is already aborted at a
        // deadline, so the normal client would fail without trying.
        const cleanup = await tryReleaseClaim({
          client: cleanupClient ?? client,
          boardId,
          cardId: work.cardId,
        });
        const tolerated = cleanup.status === 400 || cleanup.status === 409;
        const harnessAbort =
          statusOf(error) === -1 &&
          (cleanup.status === 0 || cleanup.status === -1);
        const wrapped =
          error instanceof Error ? error : new Error(String(error));
        wrapped.orphan = !cleanup.released && !tolerated;
        wrapped.cleanupAborted = harnessAbort;
        throw wrapped;
      }
      throw error;
    }
    if (claim.status === 409) {
      conflicts += 1;
      continue;
    }
    record("write");
    const claimSeq = seqOf(claim, seq);

    if (withComment) {
      const commandId = newCommandId("comment");
      try {
        await client.comment(
          work.cardId,
          buildCommentBody({ text: commentText, commandId }),
          { idempotencyKey: commandId },
        );
      } catch (error) {
        const released = await releaseClaim({
          client: cleanupClient ?? client,
          boardId,
          cardId: work.cardId,
        });
        return failureResult({
          error,
          actions,
          conflicts,
          orphan: !released,
        });
      }
      record("comment");
    }

    let move;
    try {
      move = await client.move(boardId, {
        commandId: newCommandId("move"),
        action: buildMoveAction(work, { boardId, at: Date.now() }),
        ifMatch: claimSeq,
      });
    } catch (error) {
      const released = await releaseClaim({
        client: cleanupClient ?? client,
        boardId,
        cardId: work.cardId,
      });
      if (statusOf(error) === 409) {
        conflicts += 1;
        if (released) continue;
      }
      return failureResult({
        error,
        actions,
        conflicts,
        orphan: !released,
      });
    }
    if (move.status === 409) {
      conflicts += 1;
      const released = await releaseClaim({
        client: cleanupClient ?? client,
        boardId,
        cardId: work.cardId,
      });
      if (released) continue;
      return failureResult({
        error: new HttpError({
          operation: "command.move",
          path: `/boards/${boardId}/commands`,
          status: 409,
          body: move.text,
        }),
        actions,
        conflicts,
        orphan: true,
      });
    }
    record("write");
    return {
      idle: false,
      cycle: true,
      conflicts,
      actions,
      cardId: work.cardId,
      orphan: false,
    };
  }
  return {
    idle: false,
    cycle: false,
    conflicts,
    actions,
    exhausted: false,
    stranded: false,
  };
}

/** S3 write beat: claim + move without a comment. */
export async function performWriteBeat(options) {
  return performAgentCycle({ ...options, withComment: false });
}

/** S3 comment beat: post one comment; no claim is needed. */
export async function performCommentBeat({
  client,
  boardId,
  startIndex = 0,
  commentText,
  onAction,
}) {
  const { board } = await client.readBoard(boardId);
  const cardId = pickCommentCard(board, { startIndex });
  if (cardId === null) {
    const state = boardWorkState(board);
    return {
      idle: true,
      cycle: false,
      actions: 0,
      exhausted: state.exhausted,
      stranded: state.stranded,
    };
  }
  const commandId = newCommandId("comment");
  await client.comment(
    cardId,
    buildCommentBody({ text: commentText, commandId }),
    { idempotencyKey: commandId },
  );
  onAction?.("comment");
  return { idle: false, cycle: true, actions: 1, cardId };
}

function pickKind(random, mix) {
  const reads = mix?.reads ?? 0.6;
  const writes = mix?.writes ?? 0.3;
  const roll = random();
  if (roll < reads) return "read";
  if (roll < reads + writes) return "write";
  return "comment";
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

async function afterCycle({ deadline, config, random, cycleStarted, signal }) {
  const elapsed = Date.now() - cycleStarted;
  const delay = jitteredDelay(config.cadenceMs, config.jitter ?? 0, random);
  if (elapsed < delay) await sleep(delay - elapsed, signal);
  void deadline;
}

async function waitForStart(startAt, startDelayMs, signal) {
  if (startAt !== undefined) {
    const wait = startAt - Date.now();
    if (wait > 0) await sleep(wait, signal);
    return;
  }
  if (startDelayMs > 0) await sleep(startDelayMs, signal);
}

/**
 * Run one simulated agent until the deadline. Errors are counted by the HTTP
 * client and reported through `onError`; one failed cycle never stops the
 * swarm, so a run measures a 5xx storm instead of dying on the first one.
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
  startAt = undefined,
  onError,
  onNoWork,
  cleanupClient,
  onFirstRequest,
}) {
  await waitForStart(startAt, startDelayMs, signal);
  let readyFallback = false;
  let firstRequest = false;
  while (!signal.aborted && Date.now() < deadline) {
    if (!firstRequest) {
      firstRequest = true;
      onFirstRequest?.(Date.now());
    }
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
          onAction: (kind) => {
            metrics?.recordAction(1, kind);
            metrics?.recordAgentAction(agentIndex);
          },
          cleanupClient,
        });
        if (result.idle) {
          const recycled = (await onNoWork?.(result, boardId)) === true;
          if (recycled) continue;
          metrics?.recordNoWork({
            exhausted: result.exhausted === true,
            stranded: result.stranded === true,
          });
        } else {
          if (result.failure !== undefined) {
            const fatal = isAuthError(result.failure);
            onError?.({
              agentIndex,
              boardId,
              error: result.failure,
              fatal,
              orphan: result.orphan === true,
            });
            if (fatal) return;
          }
          if (result.cycle) metrics?.recordCycle();
        }
      }
    } catch (error) {
      const fatal = isAuthError(error);
      onError?.({
        agentIndex,
        boardId,
        error,
        fatal,
        orphan: error?.orphan === true,
      });
      if (fatal) return;
    }
    await afterCycle({ deadline, config, random, cycleStarted, signal });
  }
}

/**
 * S3 agent loop: a deterministic ~60/30/10 read/write/comment action mix.
 * Board reads are still needed before a write or comment; the reported mix is
 * the chosen action mix, and the request table shows the resulting HTTP mix.
 */
export async function runMixedAgentLoop({
  client,
  userId,
  boardId,
  agentIndex = 0,
  config,
  deadline,
  signal,
  metrics,
  random,
  startDelayMs = 0,
  startAt = undefined,
  onError,
  onNoWork,
  cleanupClient,
  onFirstRequest,
}) {
  await waitForStart(startAt, startDelayMs, signal);
  let beatIndex = 0;
  let firstRequest = false;
  while (!signal.aborted && Date.now() < deadline) {
    if (!firstRequest) {
      firstRequest = true;
      onFirstRequest?.(Date.now());
    }
    const cycleStarted = Date.now();
    const kind = pickKind(random, config.mix);
    try {
      if (kind === "read") {
        await client.readBoard(boardId);
        metrics?.recordActivity("read");
      } else if (kind === "write") {
        const result = await performWriteBeat({
          client,
          boardId,
          userId,
          leaseMs: config.leaseMs,
          startIndex: agentIndex + beatIndex,
          onAction: () => {
            metrics?.recordAction(1, "write");
            metrics?.recordAgentAction(agentIndex);
          },
          cleanupClient,
        });
        if (result.idle) {
          const recycled = (await onNoWork?.(result, boardId)) === true;
          if (recycled) continue;
          metrics?.recordNoWork({
            exhausted: result.exhausted === true,
            stranded: result.stranded === true,
          });
        } else {
          metrics?.recordActivity("write");
          if (result.failure !== undefined) {
            const fatal = isAuthError(result.failure);
            onError?.({
              agentIndex,
              boardId,
              error: result.failure,
              fatal,
              orphan: result.orphan === true,
            });
            if (fatal) return;
          }
          if (result.cycle) metrics?.recordCycle();
        }
      } else {
        const result = await performCommentBeat({
          client,
          boardId,
          startIndex: agentIndex + beatIndex,
          commentText: `TASK-200.1 S3 comment (${config.id})`,
          onAction: () => {
            metrics?.recordAction(1, "comment");
            metrics?.recordAgentAction(agentIndex);
          },
        });
        if (result.idle) {
          const recycled = (await onNoWork?.(result, boardId)) === true;
          if (recycled) continue;
          metrics?.recordNoWork({
            exhausted: result.exhausted === true,
            stranded: result.stranded === true,
          });
        } else {
          metrics?.recordActivity("comment");
        }
      }
    } catch (error) {
      const fatal = isAuthError(error);
      onError?.({
        agentIndex,
        boardId,
        error,
        fatal,
        orphan: error?.orphan === true,
      });
      if (fatal) return;
    }
    beatIndex += 1;
    await afterCycle({ deadline, config, random, cycleStarted, signal });
  }
}

/** Human-like REST reader for S3: board on the Watch cadence, activity every third beat. */
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
      onError?.({ workerIndex, boardId, error, fatal: isAuthError(error) });
      if (isAuthError(error)) return;
    }
    beat += 1;
    const delay = jitteredDelay(
      config.watchCadenceMs ?? config.cadenceMs,
      config.jitter ?? 0,
      random,
    );
    const elapsed = Date.now() - started;
    if (elapsed < delay) await sleep(delay - elapsed, signal);
  }
}

/**
 * Move Done cards back to the first column so a small board can sustain a
 * longer run. The caller uses a dedicated client/metrics collector, so these
 * writes never inflate the agent action counts.
 */
export async function recycleDoneCards({ client, boardId, limit = 100 }) {
  const { board } = await client.readBoard(boardId);
  const done = findDoneColumn(board);
  const first = board.columns?.find((column) => column.id !== done?.id);
  if (done === null || first === undefined) return { moved: 0, orphans: 0 };
  let moved = 0;
  let orphans = 0;
  let remaining = [...(done.cardIds ?? [])].slice(0, limit);
  for (const cardId of [...remaining]) {
    // The recycle PAT must be a board ADMIN: clear the agent's lease first, so
    // the moved-back card is picked up immediately. A 400/409 means the
    // release did not happen; do not move or count the card as recycled.
    let released;
    try {
      released = await client.claim(boardId, {
        commandId: newCommandId("recycle-release"),
        action: buildReleaseAction({ cardId, boardId, at: Date.now() }),
      });
    } catch {
      orphans += 1;
      break;
    }
    if (released.status < 200 || released.status >= 300) {
      orphans += 1;
      break;
    }
    let movedResponse;
    try {
      movedResponse = await client.move(boardId, {
        commandId: newCommandId("recycle"),
        action: {
          type: "MOVE_CARD",
          at: Date.now(),
          boardId,
          cardId,
          fromColumnId: done.id,
          fromIndex: remaining.indexOf(cardId),
          toColumnId: first.id,
          toIndex: 0,
        },
      });
    } catch {
      orphans += 1;
      break;
    }
    if (movedResponse.status < 200 || movedResponse.status >= 300) {
      orphans += 1;
      break;
    }
    remaining = remaining.filter((id) => id !== cardId);
    moved += 1;
  }
  return { moved, orphans };
}
