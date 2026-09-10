import type { Card } from "@/types/kanban";
import { dueStatus } from "@/utils/due-date";

/**
 * Board filtering model, following the Trello/Linear conventions:
 *
 * - `query` — case-insensitive substring of the card title (Trello "keyword").
 * - `labelIds` — the card must carry ANY of the selected labels ("any match"
 *   semantics: pick two labels → find cards with either).
 * - `noLabel` — include cards without any label. When combined with
 *   `labelIds` it behaves as OR ("no label" OR any selected label).
 * - `created` — creation-date window, mirroring "created in the last …"
 *   filters: today (since local midnight), last 7 days, last 30 days.
 * - `createdOn` — exact local day ("YYYY-MM-DD") the card was created on.
 *   When set it overrides `created` (the UI makes the two mutually
 exclusive).
 * - `due` — deadline facet: overdue, due within the next 24 hours, or
 *   cards without a deadline at all ("none" mirrors the `noLabel` facet).
 *
 * The facets combine with AND. Keeping this module pure (no React, no store)
 * makes the semantics unit-testable and reusable by other views later.
 */

export type CreatedWindow = "any" | "today" | "7d" | "30d";

export type DueFilter = "any" | "overdue" | "soon" | "none";

export interface CardFilter {
 /** Substring of the card title; trimmed before matching. */
 query: string;
 /** Selected label ids — ANY of them must be present on the card. */
 labelIds: string[];
 /** Also include cards without any label (OR-ed with labelIds). */
 noLabel: boolean;
 /** Creation-date window; "any" disables the facet. */
 created: CreatedWindow;
 /** Exact "YYYY-MM-DD" local day; overrides `created` when non-null. */
 createdOn: string | null;
 /** Deadline facet; "any" disables the facet. */
 due: DueFilter;
}

export const EMPTY_FILTER: CardFilter = {
 query: "",
 labelIds: [],
 noLabel: false,
 created: "any",
 createdOn: null,
 due: "any",
};

/** True when at least one facet restricts the board. */
export function isFilterActive(filter: CardFilter): boolean {
 return (
  filter.query.trim() !== "" ||
  filter.labelIds.length > 0 ||
  filter.noLabel ||
  filter.created !== "any" ||
  filter.createdOn !== null ||
  filter.due !== "any"
 );
}

/**
 * Number of independently switchable facets currently set — drives the
 * count badge on the filters button. The label list counts as one facet
 * (plus one for "no label"), as it is a single picker in the UI.
 */
export function activeFacetCount(filter: CardFilter): number {
 let count = 0;
 if (filter.query.trim() !== "") count += 1;
 if (filter.labelIds.length > 0 || filter.noLabel) count += 1;
 if (filter.created !== "any") count += 1;
 if (filter.createdOn !== null) count += 1;
 if (filter.due !== "any") count += 1;
 return count;
}

const DAY_MS = 86_400_000;

/**
 * Start-of-window timestamp for a `created` facet, or null when "any".
 * "today" means since the start of the current local day; 7d/30d are rolling
 * windows ending now.
 */
export function createdFromMs(
 created: CreatedWindow,
 now = Date.now(),
): number | null {
 switch (created) {
  case "any":
   return null;
  case "today":
   return new Date(now).setHours(0, 0, 0, 0);
  case "7d":
   return now - 7 * DAY_MS;
  case "30d":
   return now - 30 * DAY_MS;
 }
}

/**
 * Local-day range [start, start + 1 day) for an exact "YYYY-MM-DD" date,
 * or null when the string is not a valid date. Parsed as local calendar
 * parts (not UTC) so a chosen day never shifts across time zones.
 */
export function createdDayRange(createdOn: string): [number, number] | null {
 const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(createdOn);
 if (!match) return null;
 const [, y, m, d] = match;
 const start = new Date(Number(y), Number(m) - 1, Number(d));
 // Date auto-corrects overflow (e.g. 2025-13-40) — reject unless the
 // components round-trip unchanged, so only real calendar days match.
 if (
  start.getFullYear() !== Number(y) ||
  start.getMonth() !== Number(m) - 1 ||
  start.getDate() !== Number(d)
 )
  return null;
 return [start.getTime(), start.getTime() + DAY_MS];
}

/** Whether a single card passes the `due` deadline facet. */
function matchesDueFilter(
 card: Card,
 due: DueFilter,
 now: number,
): boolean {
 switch (due) {
  case "any":
   return true;
  case "none":
   return card.dueDate === undefined;
  case "overdue":
  case "soon":
   return card.dueDate !== undefined && dueStatus(card.dueDate, now) === due;
 }
}

/** Whether a single card passes the filter (AND across facets). */
export function matchesCardFilter(
 card: Card,
 filter: CardFilter,
 now = Date.now(),
): boolean {
 const query = filter.query.trim().toLowerCase();
 if (query !== "" && !card.title.toLowerCase().includes(query)) return false;

 // An exact day overrides the relative window (mutually exclusive in the UI).
 if (filter.createdOn === null) {
  const from = createdFromMs(filter.created, now);
  if (from !== null && card.createdAt < from) return false;
 } else {
  const range = createdDayRange(filter.createdOn);
  // Invalid date — defensively match nothing (the asked day doesn't exist).
  if (!range) return false;
  if (card.createdAt < range[0] || card.createdAt >= range[1]) return false;
 }

 if (!matchesDueFilter(card, filter.due, now)) return false;

 const hasSelected = card.labelIds.some((id) => filter.labelIds.includes(id));
 if (filter.noLabel) return card.labelIds.length === 0 || hasSelected;
 if (filter.labelIds.length > 0 && !hasSelected) return false;
 return true;
}

/**
 * Filter each column's ordered card ids, preserving the order within a
 * column. Missing cards are dropped. Used to derive the ids passed to
 * ColumnView while a filter is active.
 */
export function filterCardIds(
 columns: Record<string, string[]>,
 cards: Record<string, Card>,
 filter: CardFilter,
 now = Date.now(),
): Record<string, string[]> {
 const result: Record<string, string[]> = {};
 for (const [colId, ids] of Object.entries(columns)) {
  result[colId] = ids.filter((id) => {
   const card = cards[id];
   return card !== undefined && matchesCardFilter(card, filter, now);
  });
 }
 return result;
}
