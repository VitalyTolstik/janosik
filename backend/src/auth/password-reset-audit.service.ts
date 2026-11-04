import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class PasswordResetAuditService {
  private readonly logger = new Logger(PasswordResetAuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(action: string, ip: string | null): Promise<void> {
    const now = new Date();
    const aggregateKey = createHash("sha256")
      .update(JSON.stringify([action, ip, Math.floor(now.getTime() / 60_000)]))
      .digest("hex");
    try {
      await this.prisma.adminAuditLog.upsert({
        where: { aggregateKey },
        create: {
          aggregateKey,
          adminEmail: "system",
          action: `user.password_reset_${action}`,
          details: { ip },
          lastOccurredAt: now,
        },
        update: { eventCount: { increment: 1 }, lastOccurredAt: now },
      });
    } catch (error) {
      this.logger.error(
        "Unable to record password recovery security event",
        error,
      );
    }
  }
}
