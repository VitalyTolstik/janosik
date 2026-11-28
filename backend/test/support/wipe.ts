import { setTimeout as delay } from "node:timers/promises";
import type { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Truncate every application table in one FK-safe statement (TASK-156).
 *
 * The admin specs used to delete only the tables they touched, so a leftover
 * graph from an earlier suite made them order-dependent. `CASCADE` drops the
 * dependants with their parents and `RESTART IDENTITY` resets sequences, so
 * each suite starts from an empty database. E2E-only: never imported by the
 * application.
 */
const TABLES = [
  "AdminAuditLog",
  "AdminRefreshToken",
  "AdminUser",
  "DataExport",
  "EmailChangeCode",
  "EmailVerificationCode",
  "RefreshToken",
  "ApiToken",
  "AgentRun",
  "AgentSession",
  "ApprovalRequest",
  "AttentionNotification",
  "NotificationMail",
  "CommandDetail",
  "CommandKey",
  "Command",
  "CommandPreimage",
  "SecurityAuditLog",
  "IdempotencyRecord",
  "Comment",
  "Activity",
  "Attachment",
  "ChecklistItem",
  "Checklist",
  "CardLink",
  "CardLabel",
  "Card",
  "Epic",
  "Column",
  "Label",
  "BoardShare",
  "BoardMember",
  "Board",
  "EmailSettings",
  "OAuthProviderSettings",
  "ThrottleSettings",
  "DemoRun",
  "FeatureFlag",
  "OpsSettings",
  "ReminderSent",
  "AnnouncementDismissal",
  "AnnouncementTranslation",
  "Announcement",
  "EmailTemplate",
  "User",
] as const;

const RETRY_DELAYS_MS = [100, 250];

function isRetryableTruncateError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { code?: unknown } };
  // Prisma wraps raw query failures in P2010 with the SQLSTATE in meta.code.
  const sqlState = code === "P2010" ? meta?.code : code;
  return sqlState === "40P01" || sqlState === "40001";
}

export async function wipeAll(
  prisma: Pick<PrismaService, "$executeRawUnsafe">,
): Promise<void> {
  const statement =
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} ` +
    "RESTART IDENTITY CASCADE";

  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(statement);
      return;
    } catch (error) {
      const retryDelay = RETRY_DELAYS_MS.at(attempt);
      if (retryDelay === undefined || !isRetryableTruncateError(error)) {
        throw error;
      }
      await delay(retryDelay);
    }
  }
}
