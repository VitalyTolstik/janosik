import type { Prisma } from "@prisma/client";

/**
 * TASK-200.11 — batched reads of the heavy command display snapshots.
 *
 * `CommandDetail` is partitioned by `createdAt` and has no FK to `Command` or
 * `CommandKey`: a partitioned FK to `Command` blocks monthly `DROP TABLE`, and
 * a registry cascade would lose the snapshot during a cross-partition
 * `createdAt` move. `boardId` is stored on the row for scoping, the writer
 * inserts it in the same transaction, and the maintenance move trigger keeps
 * it aligned with the command.
 */
export async function commandDetailMap(
  client: Pick<Prisma.TransactionClient, "commandDetail">,
  boardId: string,
  commandIds: readonly string[],
): Promise<Map<string, Prisma.JsonValue>> {
  const ids = [...new Set(commandIds.filter((id) => id !== ""))];
  if (ids.length === 0) return new Map();
  const rows = await client.commandDetail.findMany({
    where: {
      commandId: { in: ids },
      boardId,
    },
    select: { commandId: true, data: true },
  });
  const map = new Map<string, Prisma.JsonValue>();
  for (const row of rows) {
    if (!map.has(row.commandId)) map.set(row.commandId, row.data);
  }
  return map;
}
