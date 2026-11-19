import { ForbiddenException, Logger } from "@nestjs/common";
import type { RealtimeService } from "@/realtime/realtime.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";

/** How often a successful write may refresh `AgentSession.lastHeartbeatAt`. */
export const AGENT_SESSION_WRITE_HEARTBEAT_MS = 60_000;
const HEARTBEAT_SSE_INTERVAL_MS = 60_000;

/** Cuid-shaped session ids (same alphabet as every other id). */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const logger = new Logger("AgentSessionContext");

/**
 * Resolve the optional `X-Agent-Session` header of a PAT board write
 * (TASK-166, D15).
 *
 * The session must belong to the *same* user, token and board, and must not
 * be closed. Legacy clients that send no header are unaffected; a browser
 * session never claims agent attribution, so the header is ignored there.
 */
export async function resolveAgentSessionHeader(
  prisma: PrismaService,
  header: string | undefined,
  principal: AuthPrincipal | undefined,
  userId: string,
  boardId: string,
): Promise<AgentSessionContext | null> {
  if (header === undefined || header.trim() === "") return null;
  if (principal?.via !== "pat") return null;

  const sessionId = header.trim();
  if (!SESSION_ID.test(sessionId)) {
    throw new ForbiddenException({
      message: "X-Agent-Session is malformed",
      code: "agent_session_invalid",
      sessionId,
    });
  }

  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      apiTokenId: true,
      boardId: true,
      status: true,
      endedAt: true,
      pausedAt: true,
      lastHeartbeatAt: true,
    },
  });
  if (
    session === null ||
    session.userId !== userId ||
    session.boardId !== boardId ||
    principal.apiTokenId === undefined ||
    session.apiTokenId !== principal.apiTokenId
  ) {
    throw new ForbiddenException({
      message: "Agent session does not belong to this token and board",
      code: "agent_session_invalid",
      sessionId,
    });
  }
  if (session.endedAt !== null || TERMINAL_STATUSES.has(session.status)) {
    throw new ForbiddenException({
      message: "Agent session is closed",
      code: "agent_session_closed",
      sessionId,
    });
  }

  principal.agentSessionId = session.id;
  return session;
}

/** Publish at most once per interval across both heartbeat paths and instances. */
export async function publishAgentHeartbeat(
  prisma: PrismaService,
  realtime: RealtimeService,
  sessionId: string,
  now: Date,
  lastHeartbeatPublishedAt: Date | null = null,
): Promise<void> {
  const publishBefore = new Date(now.getTime() - HEARTBEAT_SSE_INTERVAL_MS);
  if (
    lastHeartbeatPublishedAt !== null &&
    lastHeartbeatPublishedAt > publishBefore
  )
    return;
  try {
    const [session] = await prisma.agentSession.updateManyAndReturn({
      where: {
        id: sessionId,
        endedAt: null,
        OR: [
          { lastHeartbeatPublishedAt: null },
          { lastHeartbeatPublishedAt: { lte: publishBefore } },
        ],
      },
      data: { lastHeartbeatPublishedAt: now },
      select: { boardId: true },
    });
    if (session !== undefined) {
      realtime.publish(session.boardId, {
        type: "agent",
        op: "heartbeat",
        sessionId,
        scope: "session",
        at: now.getTime(),
      });
    }
  } catch (error) {
    logger.warn(
      `agent session ${sessionId}: heartbeat publication failed (${String(error)})`,
    );
  }
}

/**
 * Best-effort write heartbeat: a successful board write carrying a session
 * updates `lastHeartbeatAt` at most once a minute (ADR §6.5). Never fails the
 * write it accompanies.
 */
export async function touchAgentSessionAfterWrite(
  prisma: PrismaService,
  realtime: RealtimeService,
  sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId) return;
  const now = new Date();
  const cutoff = new Date(now.getTime() - AGENT_SESSION_WRITE_HEARTBEAT_MS);
  try {
    await prisma.agentSession.updateMany({
      where: {
        id: sessionId,
        endedAt: null,
        lastHeartbeatAt: { lte: cutoff },
      },
      data: { lastHeartbeatAt: now },
    });
  } catch (error) {
    logger.warn(
      `agent session ${sessionId}: heartbeat stamp failed (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  await publishAgentHeartbeat(prisma, realtime, sessionId, now);
}
