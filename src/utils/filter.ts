import type { Board, Card, Label } from "@/types/kanban";
import { dueStatus } from "@/utils/due-date";

/**
 * Board filtering model, following the Trello/Linear conventions:
 *
 * - `query` — case-insensitive substring matched against the card title,
 *   its description and the names of its labels (Notion-style "titles +
 *   properties" quick filter; Trello keeps the keyword narrow, but our
 *   roadmap explicitly includes descriptions and labels).
 * - `labelIds` — the card must carry the selected labels, combined per
 *   `labelMatch`: "any" (default — at least one) or "all" (every one).
 * - `noLabel` — include cards without any label. When combined with
 *   `labelIds` it behaves as OR ("no label" OR the label match).
 * - `created` — creation-date window, mirroring "created in the last …"
 *   filters: today (since local midnight), last 7 days, last 30 days.
 * - `createdOn` — exact local day ("YYYY-MM-DD") the card was created on.
 *   When set it overrides `created` (the UI makes the two mutually
 *  exclusive).
 * - `due` — deadline facet: overdue, due within the next 24 hours, or
 *   cards without a deadline at all ("none" mirrors the `noLabel` facet).
 *
 * The facets combine with AND. Keeping this module pure (no React, no store)
 * makes the semantics unit-testable and reusable by other views later.
 */

export type CreatedWindow = "any" | "today" | "7d" | "30d";

export type DueFilter = "any" | "overdue" | "soon" | "none";

/** How multiple selected labels combine: at least one (ANY) or all of them (ALL). */
export type LabelMatch = "any" | "all";

export interface CardFilter {
 /** Substring of the card title; trimmed before matching. */
 query: string;
  /** Selected label ids — matched according to `labelMatch`. */
  labelIds: string[];
  /** Label match mode: "any" (default, OR) or "all" (every selected label). */
  labelMatch: LabelMatch;
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
  labelMatch: "any",
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

/**
 * The searchable text facets of a card — title, description and the names
 * of its labels. Shared by the board filter and the global search so both
 * surfaces agree on what a query matches.
 */
export function cardTextMatches(
  card: Card,
  labels: Label[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return false;
  if (card.title.toLowerCase().includes(needle)) return true;
  if (card.description?.toLowerCase().includes(needle)) return true;
  return card.labelIds.some((id) =>
    labels.some((label) => label.id === id && label.name.toLowerCase().includes(needle)),
  );
}

/** Whether a single card passes the filter (AND across facets). */
export function matchesCardFilter(
  card: Card,
  filter: CardFilter,
  now = Date.now(),
  labels: Label[] = [],
): boolean {
  const query = filter.query.trim().toLowerCase();
  if (query !== "" && !cardTextMatches(card, labels, query)) return false;

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

  const hasSelected =
    filter.labelMatch === "all"
      ? filter.labelIds.every((id) => card.labelIds.includes(id))
      : card.labelIds.some((id) => filter.labelIds.includes(id));
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
  labels: Label[] = [],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [colId, ids] of Object.entries(columns)) {
    result[colId] = ids.filter((id) => {
      const card = cards[id];
      return (
        card !== undefined && matchesCardFilter(card, filter, now, labels)
      );
    });
  }
  return result;
}

// --- Global search across boards -------------------------------------------

/** One matching card in the global search results. */
export interface CardSearchHit {
  kind: "card";
  boardId: string;
  boardTitle: string;
  /** Whether the board is archived — archived hits rank last. */
  boardArchived: boolean;
  columnTitle: string;
  /** The board's label catalogue — lets the UI render label chips. */
  boardLabels: Label[];
  card: Card;
  /** Where the query matched, drives the UI (snippet vs title highlight). */
  matchIn: "title" | "description" | "label";
}

/** A board whose title matched — secondary group of the results. */
export interface BoardSearchHit {
  kind: "board";
  boardId: string;
  boardTitle: string;
  boardArchived: boolean;
}

export type SearchHit = CardSearchHit | BoardSearchHit;

/** Field priority for ranking: title beats description beats label. */
const MATCH_FIELD_ORDER = ["title", "description", "label"] as const;

/**
 * Search every board's cards (and board titles) for a query.
 * Deterministic, relevance-free ordering — the natural reading order:
 * active boards first (in their stored order), archived last; within a
 * board, columns in order; within a column, cards in order. Match field
 * does not reorder rows, it only picks the presentation
 * (`matchIn: "description"` renders a snippet). Board-title matches are
 * appended after all card hits, active before archived.
 */
export function searchBoards(boards: Board[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const sorted = [...boards].sort((a, b) => {
    if (a.archivedAt !== b.archivedAt) return a.archivedAt ? 1 : -1;
    return 0;
  });

  const cardHits: CardSearchHit[] = [];
  const boardHits: BoardSearchHit[] = [];

  for (const board of sorted) {
    if (board.title.toLowerCase().includes(needle)) {
      boardHits.push({
        kind: "board",
        boardId: board.id,
        boardTitle: board.title,
        boardArchived: board.archivedAt !== undefined,
      });
    }
    for (const column of board.columns) {
      for (const cardId of column.cardIds) {
        const card = board.cards[cardId];
        if (!card) continue;
        const matched = MATCH_FIELD_ORDER.find((field) => {
          switch (field) {
            case "title":
              return card.title.toLowerCase().includes(needle);
            case "description":
              return card.description?.toLowerCase().includes(needle) ?? false;
            case "label":
              return card.labelIds.some((id) =>
                board.labels.some(
                  (label) =>
                    label.id === id &&
                    label.name.toLowerCase().includes(needle),
                ),
              );
          }
        });
        if (matched) {
          cardHits.push({
            kind: "card",
            boardId: board.id,
            boardTitle: board.title,
            boardArchived: board.archivedAt !== undefined,
            columnTitle: column.title,
            boardLabels: board.labels,
            card,
            matchIn: matched,
          });
        }
      }
    }
  }

  return [...cardHits, ...boardHits];
}

// --- Match highlighting -----------------------------------------------------

/**
 * Split `text` into segments for substring highlighting: plain parts stay
 * strings, matches are `{ match: true, text }` objects. Case-insensitive,
 * first occurrence of each non-overlapping match. Empty query → no splits.
 */
export type HighlightSegment = string | { match: true; text: string };

export function splitHighlight(
  text: string,
  query: string,
): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [text];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.toLowerCase().indexOf(needle, cursor);
    if (index === -1) {
      segments.push(text.slice(cursor));
      break;
    }
    if (index > cursor) segments.push(text.slice(cursor, index));
    segments.push({ match: true, text: text.slice(index, index + needle.length) });
    cursor = index + needle.length;
  }
  return segments.length > 0 ? segments : [text];
}

/**
 * A Google-style snippet around the first match in a long text: at most
 * `radius` characters of context on each side, ellipses where text was
 * cut, and the matched substring itself. `null` when there is no match.
 */
export function descriptionSnippet(
  text: string,
  query: string,
  radius = 60,
): HighlightSegment[] | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  const segments: HighlightSegment[] = [];
  if (start > 0) segments.push("…");
  for (const segment of splitHighlight(text.slice(start, end), query)) {
    segments.push(segment);
  }
  if (end < text.length) segments.push("…");
  return segments;
}
