import { DAY_MS } from "@/utils/duration";

/**
 * Due-date status classification for card badges.
 *
 * - `overdue`: the deadline has passed;
 * - `soon`: within the next 24 hours;
 * - `later`: everything else.
 */
export type DueStatus = "overdue" | "soon" | "later";

export function dueStatus(due: number, now: number = Date.now()): DueStatus {
  if (due < now) return "overdue";
  if (due - now <= DAY_MS) return "soon";
  return "later";
}
