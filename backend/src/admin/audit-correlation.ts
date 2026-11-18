import type { PrismaService } from "@/common/prisma/prisma.service";

/**
 * TASK-176.10 — map command ids to the master audit row that recorded them.
 *
 * A command applied through `POST /admin/boards/:id/commands` is written by
 * the board owner (the command log's actor is a real user), while the actual
 * master is recorded once in `AdminAuditLog.details.commandId`. The panel
 * resolves the link server-side for the page it is about to return; there is
 * no backfill, so historical or user-issued commands answer `null`.
 */
export async function auditIdsForCommands(
  prisma: PrismaService,
  commandIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(commandIds.filter((id) => id !== ""))];
  if (unique.length === 0) return new Map();

  const rows = await prisma.adminAuditLog.findMany({
    where: {
      action: "board.command",
      OR: unique.map((commandId) => ({
        details: { path: ["commandId"], equals: commandId },
      })),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, details: true },
  });

  const byCommandId = new Map<string, string>();
  for (const row of rows) {
    const details = row.details as Record<string, unknown> | null;
    const commandId = details?.commandId;
    if (typeof commandId === "string" && !byCommandId.has(commandId)) {
      byCommandId.set(commandId, row.id);
    }
  }
  return byCommandId;
}
