import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ApiTokenIdentityDto } from "@janosik/shared";
import type { AuthPrincipal } from "./auth-principal";

/** The level that currently blocks an agent (ADR §9.1). */
export type AgentPauseScope = "board" | "token" | "session";

/** One resolved pause: the level and the stamp the client should show. */
export interface AgentPauseStamp {
  scope: AgentPauseScope;
  at: number | null;
}

/**
 * The pause sources known at a single point in time. Dates are accepted so
 * callers can pass Prisma rows unchanged; numbers are Unix ms.
 */
export interface AgentPauseSnapshot {
  tokenIndividualPausedAt?: Date | number | null;
  tokenStopAllPausedAt?: Date | number | null;
  boardPausedAt?: Date | number | null;
  sessionPausedAt?: Date | number | null;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Control-plane routes stay usable during a pause (ADR §9.2): an agent must
 * be able to heartbeat and end its session. Human-only pause/resume routes
 * are exempt too, so a paused PAT still receives the documented
 * `pat_forbidden` from `SessionOnlyGuard` rather than `agent_paused`.
 */
const PAUSE_EXEMPT =
  /\/agent-sessions\/[^/]+\/(?:heartbeat|end|pause|resume)\/?$/;
const AGENT_CONTROL_EXEMPT =
  /\/agents\/(?:pause|resume|pause-all|resume-all)\/?$/;
const TOKEN_CONTROL_EXEMPT =
  /\/users\/me\/tokens(?:\/[^/]+(?:\/(?:pause|resume))?)?\/?$/;

/** Is this a write method that may be subject to pause? */
export function isWriteMethod(method: string | undefined): boolean {
  return WRITE_METHODS.has((method ?? "GET").toUpperCase());
}

/** Is this one of the control-plane routes pause must not block? */
export function isPauseExemptPath(path: string | undefined): boolean {
  const clean = (path ?? "").split("?")[0];
  return (
    PAUSE_EXEMPT.test(clean) ||
    AGENT_CONTROL_EXEMPT.test(clean) ||
    TOKEN_CONTROL_EXEMPT.test(clean)
  );
}

function stamp(value: Date | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.getTime() : value;
}

function latest(
  first: Date | number | null | undefined,
  second: Date | number | null | undefined,
): number | null {
  const a = stamp(first);
  const b = stamp(second);
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Resolve the effective pause with the fixed precedence token → board →
 * session (ADR §5.2, §9.1). Token pause wins even when the board and session
 * are paused too, so the client sees the scope that has to be resumed first.
 */
export function resolveAgentPause(
  snapshot: AgentPauseSnapshot,
): AgentPauseStamp | null {
  const tokenAt = latest(
    snapshot.tokenIndividualPausedAt,
    snapshot.tokenStopAllPausedAt,
  );
  if (tokenAt !== null) return { scope: "token", at: tokenAt };
  const boardAt = stamp(snapshot.boardPausedAt);
  if (boardAt !== null) return { scope: "board", at: boardAt };
  const sessionAt = stamp(snapshot.sessionPausedAt);
  if (sessionAt !== null) return { scope: "session", at: sessionAt };
  return null;
}

/** The stable `403 agent_paused` shape (ADR §8.2). */
export function agentPausedError(pause: AgentPauseStamp): ForbiddenException {
  return new ForbiddenException({
    message: `Agent access is paused at the ${pause.scope} level; resume it before writing`,
    code: "agent_paused",
    retryable: false,
    pauseScope: pause.scope,
    // Kept alongside `pauseScope` for clients that read the shorter name.
    scope: pause.scope,
    pausedAt: pause.at,
  });
}

/** Refuse a paused PAT write at the authentication/request boundary. */
export function assertTokenNotPaused(
  identity: ApiTokenIdentityDto | undefined,
  method: string | undefined,
  path: string | undefined,
): void {
  if (!isWriteMethod(method) || isPauseExemptPath(path)) return;
  const pause = resolveAgentPause({
    tokenIndividualPausedAt: identity?.individualPausedAt,
    tokenStopAllPausedAt: identity?.stopAllPausedAt,
  });
  if (pause !== null) throw agentPausedError(pause);
}

/** Refuse a PAUSE based on an already-loaded board/session snapshot. */
export function assertAgentNotPaused(snapshot: AgentPauseSnapshot): void {
  const pause = resolveAgentPause(snapshot);
  if (pause !== null) throw agentPausedError(pause);
}

/**
 * Read the pause sources again inside the board-write transaction, after the
 * advisory lock (ADR §9.3). A pause that committed before this read cancels
 * the write; one that commits afterwards leaves the transaction to finish.
 */
export async function assertAgentNotPausedInTransaction(
  tx: Prisma.TransactionClient,
  boardId: string,
  principal: AuthPrincipal | undefined,
  sessionId: string | null | undefined,
): Promise<void> {
  if (principal?.via !== "pat" || principal.apiTokenId === undefined) return;
  const [token, board] = await Promise.all([
    tx.apiToken.findUnique({
      where: { id: principal.apiTokenId },
      select: { individualPausedAt: true, stopAllPausedAt: true },
    }),
    tx.board.findUnique({
      where: { id: boardId },
      select: { agentsPausedAt: true },
    }),
  ]);
  const session =
    sessionId === null || sessionId === undefined
      ? null
      : await tx.agentSession.findUnique({
          where: { id: sessionId },
          select: { pausedAt: true },
        });
  assertAgentNotPaused({
    tokenIndividualPausedAt: token?.individualPausedAt ?? null,
    tokenStopAllPausedAt: token?.stopAllPausedAt ?? null,
    boardPausedAt: board?.agentsPausedAt ?? null,
    sessionPausedAt: session?.pausedAt ?? null,
  });
}

/** The optional third argument of `BoardWriteService.run`. */
export interface AgentPauseGate {
  principal: AuthPrincipal;
  sessionId?: string | null;
}

/** Build the gate only for a PAT; human writes need no second pause read. */
export function pauseGateFor(
  principal: AuthPrincipal | undefined,
  sessionId: string | null | undefined,
): AgentPauseGate | undefined {
  if (principal?.via !== "pat") return undefined;
  return { principal, sessionId };
}
