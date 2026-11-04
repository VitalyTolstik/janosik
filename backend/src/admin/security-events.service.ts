import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";

export type SecurityEventReason =
  | "unknown_email"
  | "wrong_password"
  | "disabled"
  | "ip_not_allowed"
  | "invalid_2fa"
  | "locked"
  | "refresh_invalid"
  | "refresh_expired"
  | "refresh_race"
  | "refresh_reuse";
export type SecurityEventStage = "login" | "refresh" | "request";

@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: {
    adminId: string | null;
    email: string;
    ip: string | null;
    reason: SecurityEventReason;
    stage: SecurityEventStage;
  }): Promise<void> {
    const now = new Date();
    // One row per account/address/reason/stage/minute, atomically updated even
    // across application nodes. No credentials or request bodies are stored.
    const aggregateKey = createHash("sha256")
      .update(
        JSON.stringify([
          event.adminId,
          event.email,
          event.ip,
          event.reason,
          event.stage,
          Math.floor(now.getTime() / 60_000),
        ]),
      )
      .digest("hex");
    try {
      await this.prisma.adminAuditLog.upsert({
        where: { aggregateKey },
        create: {
          aggregateKey,
          adminId: event.adminId,
          adminEmail: event.email,
          action:
            event.reason === "locked"
              ? "admin.login_locked"
              : "admin.login_failed",
          details: { reason: event.reason, stage: event.stage, ip: event.ip },
          lastOccurredAt: now,
        },
        update: { eventCount: { increment: 1 }, lastOccurredAt: now },
      });
    } catch (error) {
      // Audit availability must never turn a denied request into access.
      this.logger.error("Unable to record admin security event", error);
    }
  }
}
