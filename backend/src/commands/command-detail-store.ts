import type { Prisma } from "@prisma/client";

/**
 * TASK-200.11 — batched reads of the heavy command display snapshots.
 *
 * `CommandDetail` is partitioned by `createdAt` and has no FK to `Command`
 * (a partitioned→partitioned FK would make a monthly `DROP TABLE` impossible).
 * Global id uniqueness lives in `CommandKey`, and the detail relation points
 * there, so a read is scoped by `boardId` as well as the ids: even a stale or
 * duplicated id list cannot return another board's diff.
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
      commandKey: { boardId },
    },
    select: { commandId: true, data: true },
  });
  const map = new Map<string, Prisma.JsonValue>();
  for (const row of rows) {
    if (!map.has(row.commandId)) map.set(row.commandId, row.data);
  }
  return map;
}
