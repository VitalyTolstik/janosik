import type { Queue } from "bullmq";

export const SCHEDULE_RECONCILE_MS = 30_000;

/** Preserve a healthy scheduler's next run while repairing missing or changed schedules. */
export async function reconcileScheduler<Data>(
  queue: Queue<Data, unknown, string, Data, unknown, string>,
  id: string,
  every: number,
  job: { name: string; data: Data },
): Promise<void> {
  const current = await queue.getJobScheduler(id);
  if (every <= 0) {
    if (current) await queue.removeJobScheduler(id);
  } else if (current?.every !== every || current.next === null) {
    await queue.upsertJobScheduler(
      id,
      { every },
      {
        ...job,
        opts: { removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
