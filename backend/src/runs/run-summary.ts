import type { Prisma } from "@prisma/client";
import type { AgentRunCommandSummary } from "@janosik/shared";

/**
 * TASK-179 pixel parity: the run list needs a human title. The run row has no
 * stored summary, so derive one read-only hint from the first page of its
 * commands: the distinct action types in order plus the first explicit title.
 * This never changes the run, plan hash or rollback contract.
 */
export async function loadCommandSummaries(
  client: Prisma.TransactionClient,
  runIds: string[],
): Promise<Map<string, AgentRunCommandSummary>> {
  const result = new Map<string, AgentRunCommandSummary>();
  if (runIds.length === 0) return result;
  const rows = await client.command.findMany({
    where: { runId: { in: runIds } },
    select: { runId: true, payload: true },
    orderBy: { seq: "asc" },
  });
  const titles = new Map<string, string>();
  for (const row of rows) {
    const runId = row.runId ?? "";
    if (runId === "") continue;
    const payload =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {};
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "") continue;
    const existing = result.get(runId);
    if (existing === undefined) {
      result.set(runId, { actionTypes: [type], title: null });
    } else if (!existing.actionTypes.includes(type)) {
      existing.actionTypes.push(type);
    }
    const title = payload.title;
    if (
      !titles.has(runId) &&
      typeof title === "string" &&
      title.trim() !== ""
    ) {
      titles.set(runId, title);
    }
  }
  for (const [runId, summary] of result) {
    summary.title = titles.get(runId) ?? null;
  }
  return result;
}
