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
  "Comment",
  "Activity",
  "Attachment",
  "ChecklistItem",
  "Checklist",
  "CardLink",
  "CardLabel",
  "Card",
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
  "Announcement",
  "EmailTemplate",
  "User",
] as const;

export async function wipeAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} ` +
      "RESTART IDENTITY CASCADE",
  );
}
