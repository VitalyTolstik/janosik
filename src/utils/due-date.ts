/**
 * Due-date status classification for card badges.
 *
 * - `overdue`: the deadline has passed;
 * - `soon`: within the next 24 hours;
 * - `later`: everything else.
 */
export type DueStatus = "overdue" | "soon" | "later";

const SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export function dueStatus(due: number, now: number = Date.now()): DueStatus {
  if (due < now) return "overdue";
  if (due - now <= SOON_WINDOW_MS) return "soon";
  return "later";
}
