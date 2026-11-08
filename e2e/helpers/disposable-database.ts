import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Mutate only the disposable Compose database created by run-docker.sh. */
async function runSql(sql: string) {
  const project = process.env.E2E_COMPOSE_PROJECT ?? "";
  if (!/^janosik-e2e-[a-f0-9]{12}$/.test(project))
    throw new Error("A disposable E2E Compose project is required");
  await execFileAsync("docker", [
    "exec",
    `${project}-postgres-1`,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "janosik",
    "-d",
    "janosik_e2e",
    "-c",
    sql,
  ]);
}

function validateIds(boardId: string, commandId: string) {
  if (!/^[a-z0-9]+$/i.test(boardId) || !/^[a-f0-9-]{36}$/i.test(commandId))
    throw new Error("Invalid feed identifiers");
}

function validateBoardAndCards(boardId: string, cardIds: string[]) {
  if (!/^[a-z0-9]+$/i.test(boardId) || cardIds.length === 0)
    throw new Error("Invalid board or card identifiers");
  for (const id of cardIds) {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new Error("Invalid card identifier");
  }
}

/** Move a card's creation day back by `days` in the disposable database. */
export async function ageCards(
  boardId: string,
  cardIds: string[],
  days: number,
) {
  validateBoardAndCards(boardId, cardIds);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("Invalid age in days");
  const ids = cardIds.map((id) => `'${id}'`).join(", ");
  await runSql(
    `UPDATE "Card" SET "createdAt" = NOW() - INTERVAL '${days} days' WHERE id IN (${ids}) AND "columnId" IN (SELECT id FROM "Column" WHERE "boardId" = '${boardId}');`,
  );
}

export async function ageFeedEntries(
  boardId: string,
  commandId: string,
  activityId: string,
) {
  validateIds(boardId, commandId);
  if (!/^[a-z0-9]+$/i.test(activityId))
    throw new Error("Invalid activity identifier");
  await runSql(
    `UPDATE "Command" SET "createdAt" = NOW() - INTERVAL '40 days' WHERE id = '${commandId}' AND "boardId" = '${boardId}'; UPDATE "Activity" SET "createdAt" = NOW() - INTERVAL '40 days' WHERE id = '${activityId}' AND "boardId" = '${boardId}';`,
  );
}

/**
 * Move one command's timestamp back by an explicit number of days. The
 * retention boundary test needs 25/35 days, not the fixed 40 of
 * `ageFeedEntries`.
 */
export async function ageCommand(
  boardId: string,
  commandId: string,
  days: number,
) {
  validateIds(boardId, commandId);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("Invalid age in days");
  await runSql(
    `UPDATE "Command" SET "createdAt" = NOW() - INTERVAL '${days} days' WHERE id = '${commandId}' AND "boardId" = '${boardId}';`,
  );
}

export async function clearCommandSnapshot(boardId: string, commandId: string) {
  validateIds(boardId, commandId);
  await runSql(
    `UPDATE "Command" SET details = NULL WHERE id = '${commandId}' AND "boardId" = '${boardId}';`,
  );
}
