import type { ActivityChange, ActivityFeedEntry } from "@janosik/shared";

/**
 * Per-keystroke edits collapse like in the activity timeline: consecutive
 * quiet `UPDATE_CARD` commands of one author within this window render as a
 * single row whose diff runs from the first old value to the last new one.
 */
export const FOLD_WINDOW_MS = 2_000;

/**
 * Fold consecutive quiet edits of one author into one row (TASK-37): the
 * newest entry stays, its diff runs from the oldest old value to the newest
 * new one. `TOUCH_CARD` rows are timestamp bookkeeping and disappear here.
 */
export function foldHistory(entries: ActivityFeedEntry[]): ActivityFeedEntry[] {
  const folded: ActivityFeedEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "TOUCH_CARD") continue;
    const previous = folded[folded.length - 1];
    if (
      previous !== undefined &&
      previous.type === "UPDATE_CARD" &&
      entry.type === "UPDATE_CARD" &&
      previous.actorId === entry.actorId &&
      previous.at - entry.at <= FOLD_WINDOW_MS
    ) {
      folded[folded.length - 1] = {
        ...previous,
        changes: mergeChanges(previous.changes, entry.changes),
      };
      continue;
    }
    folded.push(entry);
  }
  return folded;
}

/** Older `from` + newer `to` per field; new fields in the newer entry win. */
function mergeChanges(
  newer: ActivityChange[] | undefined,
  older: ActivityChange[] | undefined,
): ActivityChange[] | undefined {
  if (newer === undefined && older === undefined) return undefined;
  const byField = new Map<string, ActivityChange>();
  for (const change of older ?? []) byField.set(change.field, { ...change });
  for (const change of newer ?? []) {
    const existing = byField.get(change.field);
    if (existing) existing.to = change.to;
    else byField.set(change.field, { ...change });
  }
  return [...byField.values()];
}
