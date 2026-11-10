import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ActorType } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

/** One accountability row outside the board command log (TASK-166). */
export interface SecurityAuditEvent {
  /** Owner of the acted-on resource (the actor's account for self-service). */
  userId: string;
  /** Real actor id; equals `userId` for self-service and browser actions. */
  actorId: string;
  actorType?: ActorType;
  apiTokenId?: string | null;
  agentSessionId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Prisma.InputJsonValue | null;
}

/**
 * Append-only security trail (ADR §6.10). Rows store opaque ids only — never
 * a plaintext token, a token hash or a password. Board content events stay in
 * `Activity`; this table is for account/board lifecycle and credential
 * changes that must survive the resource itself.
 *
 * An audit write must never turn a successful action into a 500, so failures
 * are logged and swallowed.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: SecurityAuditEvent): Promise<void> {
    try {
      await this.prisma.securityAuditLog.create({
        data: {
          userId: event.userId,
          actorId: event.actorId,
          actorType: event.actorType ?? "human",
          apiTokenId: event.apiTokenId ?? null,
          agentSessionId: event.agentSessionId ?? null,
          action: event.action,
          targetType: event.targetType ?? null,
          targetId: event.targetId ?? null,
          details: event.details ?? undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to write security audit ${event.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
