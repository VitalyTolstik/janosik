import type { Prisma } from "@prisma/client";

/**
 * TASK-200.11 — batched reads of the heavy command display snapshots.
 *
 * `CommandDetail` is partitioned by `createdAt` and deliberately has no FK or
 * Prisma relation to `Command` (a partitioned→partitioned FK makes a monthly
 * `DROP TABLE` impossible without dropping and revalidating the parent
 * constraint). A relation keyed by `(commandId, createdAt)` would also break
 * when the demo seed moves a command's `createdAt`: the side row is no longer
 * in the same month. Reads therefore address the side table by `commandId`
 * alone — the prefix of its primary key — and callers pass only the page they
 * are already returning.
 */
export async function commandDetailMap(
  client: Pick<Prisma.TransactionClient, "commandDetail">,
  commandIds: readonly string[],
): Promise<Map<string, Prisma.JsonValue>> {
  const ids = [...new Set(commandIds.filter((id) => id !== ""))];
  if (ids.length === 0) return new Map();
  const rows = await client.commandDetail.findMany({
    where: { commandId: { in: ids } },
    select: { commandId: true, data: true },
  });
  const map = new Map<string, Prisma.JsonValue>();
  for (const row of rows) {
    if (!map.has(row.commandId)) map.set(row.commandId, row.data);
  }
  return map;
}
