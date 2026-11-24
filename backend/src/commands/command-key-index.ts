import { Prisma } from "@prisma/client";

export type CommandKeyIndexState = "absent" | "valid" | "invalid";

/**
 * TASK-200.11 — is the board-scoped registry index usable?
 *
 * `to_regclass(...)` only proves the name exists. An interrupted
 * `CREATE INDEX CONCURRENTLY` leaves an invalid index that the planner ignores,
 * so a board/demo purge would still seq-scan a 100M-row registry. The guard
 * must read `pg_index.indisvalid`; the maintenance job repairs invalid
 * leftovers.
 */
export async function commandKeyBoardIndexState(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
): Promise<CommandKeyIndexState> {
  const rows = await client.$queryRaw<Array<{ valid: boolean | null }>>(
    Prisma.sql`
      SELECT i.indisvalid AS "valid"
        FROM pg_class c
        LEFT JOIN pg_index i ON i.indexrelid = c.oid
       WHERE c.relname = 'CommandKey_boardId_idx'
         AND c.relnamespace = current_schema()::regnamespace
    `,
  );
  if (rows.length === 0) return "absent";
  return rows[0]?.valid === true ? "valid" : "invalid";
}
