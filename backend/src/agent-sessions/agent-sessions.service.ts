import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AgentSession } from "@prisma/client";
import { Role } from "@prisma/client";
import {
  AGENT_SESSION_STALE_MS,
  type AgentSessionDto,
  type AgentSessionStatus,
  type BoardAgentPauseDto,
} from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { RealtimeService } from "@/realtime/realtime.service";
import type {
  AgentSessionHeartbeatDto,
  CreateAgentSessionDto,
  EndAgentSessionDto,
} from "./dto/agent-session.dto";

const NON_TERMINAL = new Set<AgentSessionStatus>([
  "active",
  "idle",
  "waiting_approval",
]);
const TERMINAL = new Set<AgentSessionStatus>([
  "completed",
  "failed",
  "cancelled",
]);
const ALL_STATUSES = new Set<AgentSessionStatus>([
  "active",
  "idle",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

/** Why a session is paused (overlay; the DB stores each level separately). */
interface PauseContext {
  tokenPaused: boolean;
  boardPausedAt: Date | null;
}

/**
 * Agent sessions (TASK-166.1): the board-scoped work context of one PAT.
 *
 * A session is an identity/attribution primitive, not an authorization one:
 * it grants no rights beyond the token that owns it. Start/heartbeat/end are
 * deliberately small; pause/resume and kill land in 166.3, approvals in
 * 166.5 and run grouping in 166.7.
 */
@Injectable()
export class AgentSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly realtime: RealtimeService,
  ) {}

  /** `POST /boards/:id/agent-sessions` — start a session for this PAT. */
  async start(
    boardId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
    dto: CreateAgentSessionDto,
  ): Promise<AgentSessionDto> {
    const token = this.requirePat(principal, "start");
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true, agentsPausedAt: true },
    });
    if (!board) throw new NotFoundException("Board not found");

    const session = await this.prisma.$transaction(async (tx) => {
      const row = await tx.agentSession.create({
        data: {
          userId,
          apiTokenId: token.apiTokenId,
          boardId,
          name: clean(dto.name),
          clientName: clean(dto.clientName),
          model: clean(dto.model),
        },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "agent_session_started",
          actorId: userId,
          actorType: "agent",
          apiTokenId: token.apiTokenId,
          agentSessionId: row.id,
          agentName: token.apiTokenName ?? null,
          details: {
            sessionId: row.id,
            name: row.name,
            clientName: row.clientName,
            model: row.model,
          },
        },
      });
      return row;
    });

    this.realtime.publish(boardId, {
      type: "agent",
      op: "started",
      sessionId: session.id,
      at: Date.now(),
    });
    return toAgentSessionDto(
      session,
      {
        tokenPaused: principal?.tokenIdentity?.paused ?? false,
        boardPausedAt: board.agentsPausedAt,
      },
      Date.now(),
    );
  }

  /**
   * `POST .../:sessionId/heartbeat` — same token only. Allowed during a pause
   * (pause enforcement is 166.3; the control-plane exception is the ADR
   * contract this endpoint keeps).
   */
  async heartbeat(
    boardId: string,
    sessionId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
    dto: AgentSessionHeartbeatDto,
  ): Promise<AgentSessionDto> {
    const token = this.requirePat(principal, "heartbeat");
    const session = await this.loadOwned(
      boardId,
      sessionId,
      userId,
      token.apiTokenId,
    );
    if (isTerminal(session)) {
      throw new ForbiddenException({
        message: "Agent session is closed",
        code: "agent_session_closed",
        sessionId,
      });
    }
    if (dto.currentCardId !== undefined && dto.currentCardId !== null) {
      await this.assertCardOnBoard(boardId, dto.currentCardId);
    }
    // Guard the update itself against a concurrent `end`: the row must still
    // be open at write time, not merely when it was read above.
    const now = new Date();
    const changed = await this.prisma.agentSession.updateMany({
      where: {
        id: session.id,
        endedAt: null,
        status: { notIn: [...TERMINAL] },
      },
      data: {
        lastHeartbeatAt: now,
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.currentCardId !== undefined
          ? { currentCardId: dto.currentCardId || null }
          : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      },
    });
    if (changed.count === 0) {
      throw new ForbiddenException({
        message: "Agent session is closed",
        code: "agent_session_closed",
        sessionId,
      });
    }
    // The successful update is the linearization point. Build the response
    // from that snapshot instead of re-reading, so a concurrently committed
    // `end` cannot make this 200 look like an open session with `endedAt` set.
    const updated: AgentSession = {
      ...session,
      lastHeartbeatAt: now,
      status: dto.status ?? session.status,
      currentCardId:
        dto.currentCardId !== undefined
          ? dto.currentCardId || null
          : session.currentCardId,
      summary: dto.summary ?? session.summary,
    };
    return this.toDto(updated, this.tokenPauseContext(principal));
  }

  /**
   * `POST .../:sessionId/end` — same token, or a board ADMIN browser session.
   * Idempotent: a repeated end returns the stored terminal state. Claims held
   * by this session are released in the same board transaction.
   */
  async end(
    boardId: string,
    sessionId: string,
    userId: string,
    principal: AuthPrincipal | undefined,
    boardRole: Role,
    dto: EndAgentSessionDto,
  ): Promise<AgentSessionDto> {
    const session = await this.loadOnBoard(boardId, sessionId);
    const byToken =
      principal?.via === "pat" &&
      principal.apiTokenId === session.apiTokenId &&
      userId === session.userId;
    const byAdmin = principal?.via === "jwt" && boardRole === Role.ADMIN;
    if (!byToken && !byAdmin) {
      throw new ForbiddenException({
        message: "Agent session does not belong to this token and board",
        code: "agent_session_invalid",
        sessionId,
      });
    }

    if (isTerminal(session)) {
      return this.toDto(session, this.tokenPauseContext(principal));
    }

    const status = dto.status ?? "completed";
    const endedAt = new Date();
    const result = await this.boardWrite.run(boardId, async (tx) => {
      // The conditional update is the serialization point: exactly one
      // concurrent end wins, the loser re-reads the stored state and writes
      // no second activity row or SSE frame.
      const changed = await tx.agentSession.updateMany({
        where: { id: session.id, endedAt: null },
        data: {
          status,
          endedAt,
          endReason: status,
          ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
        },
      });
      const row = await tx.agentSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      if (changed.count === 0) {
        return { row, changed: false, releasedClaims: 0 };
      }
      // §9.4: ending a session releases the claims it owns. Legacy claims
      // without a session id keep their lease until it expires.
      const claimed = await tx.card.findMany({
        where: { claimedBySessionId: session.id, column: { boardId } },
        select: { id: true },
      });
      if (claimed.length > 0) {
        await tx.card.updateMany({
          where: { id: { in: claimed.map((card) => card.id) } },
          data: {
            claimedBy: null,
            claimedByTokenId: null,
            claimedBySessionId: null,
            leaseUntil: null,
          },
        });
      }
      await tx.activity.create({
        data: {
          boardId,
          type: "agent_session_ended",
          actorId: userId,
          actorType: byToken ? "agent" : "human",
          ...(byToken
            ? {
                apiTokenId: principal?.apiTokenId ?? null,
                agentSessionId: session.id,
                agentName: principal?.apiTokenName ?? null,
              }
            : {}),
          details: {
            sessionId: session.id,
            status: row.status,
            releasedClaims: claimed.length,
          },
        },
      });
      return { row, changed: true, releasedClaims: claimed.length };
    });

    if (result.changed) {
      this.realtime.publish(boardId, {
        type: "agent",
        op: "ended",
        sessionId: result.row.id,
        at: endedAt.getTime(),
      });
    }
    return this.toDto(result.row, this.tokenPauseContext(principal));
  }

  /**
   * `POST /boards/:id/agent-sessions/:sessionId/pause` (TASK-166.3) —
   * session-only board ADMIN. Pausing only stops writes attributed to this
   * session; it does not release the claims the session holds.
   */
  async pauseSession(
    boardId: string,
    sessionId: string,
    actorId: string,
    reason: string | undefined,
  ): Promise<AgentSessionDto> {
    const session = await this.loadOnBoard(boardId, sessionId);
    if (isTerminal(session)) {
      throw new ForbiddenException({
        message: "Agent session is closed",
        code: "agent_session_closed",
        sessionId,
      });
    }
    const now = new Date();
    const result = await this.boardWrite.run(boardId, async (tx) => {
      const current = await tx.agentSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      if (isTerminal(current)) {
        throw new ForbiddenException({
          message: "Agent session is closed",
          code: "agent_session_closed",
          sessionId,
        });
      }
      if (current.pausedAt !== null) {
        return { row: current, changed: false };
      }
      const row = await tx.agentSession.update({
        where: { id: session.id },
        data: {
          pausedAt: now,
          pausedBy: actorId,
          pausedReason: clean(reason),
        },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "agent_session_paused",
          actorId,
          actorType: "human",
          details: {
            sessionId: session.id,
            reason: row.pausedReason,
            pausedAt: now.getTime(),
          },
        },
      });
      return { row, changed: true };
    });
    return this.toDto(
      result.row,
      await this.tokenPauseContextById(session.apiTokenId),
    );
  }

  /** `POST /boards/:id/agent-sessions/:sessionId/resume` — session only. */
  async resumeSession(
    boardId: string,
    sessionId: string,
    actorId: string,
    reason: string | undefined,
  ): Promise<AgentSessionDto> {
    const session = await this.loadOnBoard(boardId, sessionId);
    if (isTerminal(session)) {
      throw new ForbiddenException({
        message: "Agent session is closed",
        code: "agent_session_closed",
        sessionId,
      });
    }
    const result = await this.boardWrite.run(boardId, async (tx) => {
      const current = await tx.agentSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      if (isTerminal(current)) {
        throw new ForbiddenException({
          message: "Agent session is closed",
          code: "agent_session_closed",
          sessionId,
        });
      }
      if (current.pausedAt === null) {
        return { row: current, changed: false };
      }
      const row = await tx.agentSession.update({
        where: { id: session.id },
        data: { pausedAt: null, pausedBy: null, pausedReason: null },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "agent_session_resumed",
          actorId,
          actorType: "human",
          details: {
            sessionId: session.id,
            reason: clean(reason),
            resumedAt: Date.now(),
          },
        },
      });
      return { row, changed: true };
    });
    return this.toDto(
      result.row,
      await this.tokenPauseContextById(session.apiTokenId),
    );
  }

  /**
   * `POST /boards/:id/agents/pause` — session-only board ADMIN. Every PAT on
   * the board is blocked; the pause stamp lives on the board and is not
   * exported. Claims are untouched.
   */
  async pauseBoard(
    boardId: string,
    actorId: string,
    reason: string | undefined,
  ): Promise<BoardAgentPauseDto> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) throw new NotFoundException("Board not found");
    const now = new Date();
    const row = await this.boardWrite.run(boardId, async (tx) => {
      const current = await tx.board.findUniqueOrThrow({
        where: { id: boardId },
        select: {
          agentsPausedAt: true,
          agentsPausedBy: true,
          agentsPauseReason: true,
        },
      });
      if (current.agentsPausedAt !== null) return current;
      const updated = await tx.board.update({
        where: { id: boardId },
        data: {
          agentsPausedAt: now,
          agentsPausedBy: actorId,
          agentsPauseReason: clean(reason),
        },
        select: {
          agentsPausedAt: true,
          agentsPausedBy: true,
          agentsPauseReason: true,
        },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "agents_paused",
          actorId,
          actorType: "human",
          details: {
            reason: updated.agentsPauseReason,
            pausedAt: now.getTime(),
          },
        },
      });
      return updated;
    });
    return toBoardPauseDto(boardId, row);
  }

  /** `POST /boards/:id/agents/resume` — session-only board ADMIN. */
  async resumeBoard(
    boardId: string,
    actorId: string,
    reason: string | undefined,
  ): Promise<BoardAgentPauseDto> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true },
    });
    if (!board) throw new NotFoundException("Board not found");
    const row = await this.boardWrite.run(boardId, async (tx) => {
      const current = await tx.board.findUniqueOrThrow({
        where: { id: boardId },
        select: {
          agentsPausedAt: true,
          agentsPausedBy: true,
          agentsPauseReason: true,
        },
      });
      if (current.agentsPausedAt === null) return current;
      const updated = await tx.board.update({
        where: { id: boardId },
        data: {
          agentsPausedAt: null,
          agentsPausedBy: null,
          agentsPauseReason: null,
        },
        select: {
          agentsPausedAt: true,
          agentsPausedBy: true,
          agentsPauseReason: true,
        },
      });
      await tx.activity.create({
        data: {
          boardId,
          type: "agents_resumed",
          actorId,
          actorType: "human",
          details: { reason: clean(reason), resumedAt: Date.now() },
        },
      });
      return updated;
    });
    return toBoardPauseDto(boardId, row);
  }

  /** `GET /boards/:id/agent-sessions?active=1` — any board member. */
  async list(boardId: string, active = false): Promise<AgentSessionDto[]> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true, agentsPausedAt: true },
    });
    if (!board) throw new NotFoundException("Board not found");
    const rows = await this.prisma.agentSession.findMany({
      where: {
        boardId,
        ...(active ? { status: { in: [...NON_TERMINAL] } } : {}),
      },
      orderBy: { startedAt: "desc" },
    });
    const tokens = await this.tokenPauseContexts(
      rows.map((row) => row.apiTokenId),
    );
    return rows.map((row) =>
      toAgentSessionDto(
        row,
        {
          tokenPaused: tokens.get(row.apiTokenId) ?? false,
          boardPausedAt: board.agentsPausedAt,
        },
        Date.now(),
      ),
    );
  }

  /** `GET /boards/:id/agent-sessions/:sessionId` — any board member. */
  async get(boardId: string, sessionId: string): Promise<AgentSessionDto> {
    const session = await this.loadOnBoard(boardId, sessionId);
    return this.toDto(
      session,
      await this.tokenPauseContextById(session.apiTokenId),
    );
  }

  private async loadOnBoard(
    boardId: string,
    sessionId: string,
  ): Promise<AgentSession> {
    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException("Agent session not found");
    }
    if (session.boardId !== boardId) {
      throw new ForbiddenException({
        message: "Agent session does not belong to this token and board",
        code: "agent_session_invalid",
        sessionId,
      });
    }
    return session;
  }

  private async loadOwned(
    boardId: string,
    sessionId: string,
    userId: string,
    apiTokenId: string,
  ): Promise<AgentSession> {
    const session = await this.loadOnBoard(boardId, sessionId);
    if (session.userId !== userId || session.apiTokenId !== apiTokenId) {
      throw new ForbiddenException({
        message: "Agent session does not belong to this token and board",
        code: "agent_session_invalid",
        sessionId,
      });
    }
    return session;
  }

  private async assertCardOnBoard(
    boardId: string,
    cardId: string,
  ): Promise<void> {
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, deletedAt: null, column: { boardId } },
      select: { id: true },
    });
    if (!card) {
      throw new NotFoundException("Card not found on this board");
    }
  }

  private requirePat(
    principal: AuthPrincipal | undefined,
    endpoint: "start" | "heartbeat",
  ): {
    apiTokenId: string;
    apiTokenName?: string;
  } {
    if (principal?.via !== "pat" || principal.apiTokenId === undefined) {
      throw new ForbiddenException({
        message: "Agent sessions are available to personal API tokens",
        code: "pat_required",
        endpoint,
      });
    }
    return {
      apiTokenId: principal.apiTokenId,
      apiTokenName: principal.apiTokenName,
    };
  }

  private tokenPauseContext(
    principal: AuthPrincipal | undefined,
  ): PauseContext {
    return {
      tokenPaused: principal?.tokenIdentity?.paused ?? false,
      boardPausedAt: null,
    };
  }

  private async tokenPauseContextById(
    apiTokenId: string,
  ): Promise<PauseContext> {
    const token = await this.prisma.apiToken.findUnique({
      where: { id: apiTokenId },
      select: { individualPausedAt: true, stopAllPausedAt: true },
    });
    return {
      tokenPaused:
        token !== null &&
        (token.individualPausedAt !== null || token.stopAllPausedAt !== null),
      boardPausedAt: null,
    };
  }

  private async tokenPauseContexts(
    apiTokenIds: string[],
  ): Promise<Map<string, boolean>> {
    const unique = [...new Set(apiTokenIds)];
    if (unique.length === 0) return new Map();
    const tokens = await this.prisma.apiToken.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        individualPausedAt: true,
        stopAllPausedAt: true,
      },
    });
    return new Map(
      tokens.map((token) => [
        token.id,
        token.individualPausedAt !== null || token.stopAllPausedAt !== null,
      ]),
    );
  }

  /** The full DTO also needs the board pause overlay. */
  private async toDto(
    session: AgentSession,
    token: PauseContext,
  ): Promise<AgentSessionDto> {
    const board = await this.prisma.board.findUnique({
      where: { id: session.boardId },
      select: { agentsPausedAt: true },
    });
    return toAgentSessionDto(
      session,
      {
        tokenPaused: token.tokenPaused,
        boardPausedAt: board?.agentsPausedAt ?? null,
      },
      Date.now(),
    );
  }
}

/** Pure projection so the stale/pause contract is unit-testable. */
export function toAgentSessionDto(
  row: AgentSession,
  pause: PauseContext,
  now: number,
): AgentSessionDto {
  const status = isAgentSessionStatus(row.status) ? row.status : "active";
  const terminal = TERMINAL.has(status);
  const sessionPaused = !terminal && row.pausedAt !== null;
  const paused =
    !terminal &&
    (pause.tokenPaused || pause.boardPausedAt !== null || sessionPaused);
  return {
    id: row.id,
    userId: row.userId,
    apiTokenId: row.apiTokenId,
    boardId: row.boardId,
    name: row.name,
    clientName: row.clientName,
    model: row.model,
    status,
    currentCardId: row.currentCardId,
    currentRunId: row.currentRunId,
    startedAt: row.startedAt.getTime(),
    lastHeartbeatAt: row.lastHeartbeatAt.getTime(),
    stale:
      !terminal && now - row.lastHeartbeatAt.getTime() > AGENT_SESSION_STALE_MS,
    paused,
    pausedAt: terminal ? null : (row.pausedAt?.getTime() ?? null),
    pausedBy: terminal ? null : row.pausedBy,
    pausedReason: terminal ? null : row.pausedReason,
    pauseScope: terminal
      ? null
      : pause.tokenPaused
        ? "token"
        : pause.boardPausedAt !== null
          ? "board"
          : sessionPaused
            ? "session"
            : null,
    endedAt: row.endedAt?.getTime() ?? null,
    endReason: row.endReason,
    summary: row.summary,
  };
}

function isTerminal(row: AgentSession): boolean {
  return row.endedAt !== null || TERMINAL.has(row.status as AgentSessionStatus);
}

function isAgentSessionStatus(value: string): value is AgentSessionStatus {
  return ALL_STATUSES.has(value as AgentSessionStatus);
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function toBoardPauseDto(
  boardId: string,
  row: {
    agentsPausedAt: Date | null;
    agentsPausedBy: string | null;
    agentsPauseReason: string | null;
  },
): BoardAgentPauseDto {
  return {
    scope: "board",
    boardId,
    paused: row.agentsPausedAt !== null,
    pausedAt: row.agentsPausedAt?.getTime() ?? null,
    pausedBy: row.agentsPausedBy,
    reason: row.agentsPauseReason,
  };
}
