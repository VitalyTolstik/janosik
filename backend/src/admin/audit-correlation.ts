import type { PrismaService } from "@/common/prisma/prisma.service";

/** Minimal command shape the correlation needs; safe to map from any page. */
export interface CommandAuditKey {
  id: string;
  boardId: string;
  seq: number;
}

/**
 * TASK-176.10 — map command ids to the master audit row that recorded them.
 *
 * A command applied through `POST /admin/boards/:id/commands` is written by
 * the board owner (the command log's actor is a real user), while the actual
 * master is recorded once in `AdminAuditLog.details.commandId`. The panel
 * resolves the link server-side for the page it is about to return; there is
 * no backfill, so historical or user-issued commands answer `null`.
 *
 * The lookup is deliberately scoped by board + `seq`, not just by command id:
 * the JSON path is unindexed in Postgres, and keeping the target board and
 * command sequence in the predicate avoids a cross-board or old-generation
 * collision on a reused/copied id. It stays page-bounded — callers pass only
 * the rows they are returning (at most 100).
 */
export async function auditIdsForCommands(
  prisma: PrismaService,
  commands: readonly CommandAuditKey[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Map(
      commands
        .filter((command) => command.id !== "" && command.boardId !== "")
        .map((command) => [command.id, command] as const),
    ).values(),
  ];
  if (unique.length === 0) return new Map();

  const rows = await prisma.adminAuditLog.findMany({
    where: {
      action: "board.command",
      targetType: "board",
      OR: unique.map((command) => ({
        AND: [
          { targetId: command.boardId },
          { details: { path: ["commandId"], equals: command.id } },
          { details: { path: ["seq"], equals: command.seq } },
        ],
      })),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, targetId: true, details: true },
  });

  const expected = new Map(unique.map((command) => [command.id, command]));
  const byCommandId = new Map<string, string>();
  for (const row of rows) {
    const details = row.details as Record<string, unknown> | null;
    const commandId = details?.commandId;
    if (typeof commandId !== "string") continue;
    const command = expected.get(commandId);
    if (
      command === undefined ||
      row.targetId !== command.boardId ||
      Number(details?.seq) !== command.seq ||
      byCommandId.has(commandId)
    ) {
      continue;
    }
    byCommandId.set(commandId, row.id);
  }
  return byCommandId;
}
