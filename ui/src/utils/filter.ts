import type {
  Board,
  Card,
  CardPriority,
  Epic,
  Label,
  WorkspaceSearchMatch,
} from "@janosik/shared";
import {
  CARD_PRIORITIES,
  DEFAULT_CARD_PRIORITY,
  LIMITS,
} from "@janosik/shared";
import { dueStatus } from "@/utils/due-date";
import { DAY_MS } from "@/utils/duration";
import { cardLinkIndex } from "@/utils/links";
import { copySearchParamsWithoutLanguageHandoff } from "@/utils/search-params";

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
  /**
   * Selected priorities (TASK-45) — a card matches when its effective
   * priority (unset = "medium") is one of them. Empty = any priority.
   */
  priorities: CardPriority[];
  /**
   * Selected assignees (TASK-49) — user ids; a card matches when its
   * assignee is one of them. Empty = any assignee.
   */
  assignees: string[];
  /**
   * Include unassigned cards (TASK-49) — OR-ed with `assignees`. Only
   * meaningful when at least one of the two facets is set.
   */
  unassigned: boolean;
  /**
   * Jira-style link facets (TASK-46): a card the index flags as blocked
   * (an incoming `blocks` from a live, non-archived card), and a card
   * with at least one link in either direction.
   */
  blocked: boolean;
  hasLinks: boolean;
  epicIds: string[];
  hasEpic: boolean;
  noEpic: boolean;
}

/**
 * A filter update: either the complete next filter or a reducer over the
 * latest one. The reducer form keeps rapid facet picks from overwriting each
 * other — the URL update is a router transition, so the `filter` prop can
 * still describe an older state when the next click arrives.
 */
export type FilterChange = CardFilter | ((current: CardFilter) => CardFilter);

/** Resolve a {@link FilterChange} against the latest filter. */
export function resolveFilterChange(
  change: FilterChange,
  current: CardFilter,
): CardFilter {
  return typeof change === "function" ? change(current) : change;
}

export const EMPTY_FILTER: CardFilter = {
  query: "",
  labelIds: [],
  labelMatch: "any",
  noLabel: false,
  created: "any",
  createdOn: null,
  due: "any",
  priorities: [],
  assignees: [],
  unassigned: false,
  blocked: false,
  hasLinks: false,
  epicIds: [],
  hasEpic: false,
  noEpic: false,
};

/**
 * URL parameter namespace for the board filter. The filter is shareable:
 * `?f.q=release&f.due=overdue` restores the same view after a reload, so a
 * link to "overdue bugs assigned to me" is possible (TASK-162 review, F-02).
 * The prefix keeps the filter from colliding with the card deep link
 * (`?card=`) or future view parameters.
 */
export const FILTER_PARAM_KEYS = [
  "q",
  "due",
  "labels",
  "labelMatch",
  "noLabel",
  "created",
  "createdOn",
  "priority",
  "assignee",
  "unassigned",
  "blocked",
  "links",
  "epic",
  "hasEpic",
  "noEpic",
] as const;

const FILTER_PARAM_PREFIX = "f.";
const DUE_VALUES: readonly DueFilter[] = ["overdue", "soon", "none"];
const CREATED_VALUES: readonly CreatedWindow[] = ["today", "7d", "30d"];

function paramKey(key: (typeof FILTER_PARAM_KEYS)[number]): string {
  return `${FILTER_PARAM_PREFIX}${key}`;
}

function csv(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Read a filter from URL parameters. Invalid or unknown values are ignored
 * (the URL is user-editable), so a hand-typed link can never break the board.
 */
export function readFilterParams(
  params: URLSearchParams,
  knownEpicIds?: ReadonlySet<string>,
): CardFilter {
  const due = params.get(paramKey("due"));
  const created = params.get(paramKey("created"));
  const createdOn = params.get(paramKey("createdOn"));
  const labelMatch = params.get(paramKey("labelMatch"));
  const priority = csv(params.get(paramKey("priority"))).filter(
    (value): value is CardPriority =>
      CARD_PRIORITIES.includes(value as CardPriority),
  );
  return {
    ...EMPTY_FILTER,
    query: (params.get(paramKey("q")) ?? "").slice(0, LIMITS.query),
    due: DUE_VALUES.includes(due as DueFilter) ? (due as DueFilter) : "any",
    labelIds: csv(params.get(paramKey("labels"))),
    labelMatch: labelMatch === "all" ? "all" : "any",
    noLabel: params.get(paramKey("noLabel")) === "1",
    created: CREATED_VALUES.includes(created as CreatedWindow)
      ? (created as CreatedWindow)
      : "any",
    createdOn:
      createdOn !== null && createdDayRange(createdOn) !== null
        ? createdOn
        : null,
    priorities: [...new Set(priority)],
    assignees: csv(params.get(paramKey("assignee"))),
    unassigned: params.get(paramKey("unassigned")) === "1",
    blocked: params.get(paramKey("blocked")) === "1",
    hasLinks: params.get(paramKey("links")) === "1",
    epicIds: [...new Set(csv(params.get(paramKey("epic"))))].filter(
      (id) => knownEpicIds?.has(id) ?? true,
    ),
    hasEpic: params.get(paramKey("hasEpic")) === "1",
    noEpic: params.get(paramKey("noEpic")) === "1",
  };
}

/**
 * Write a filter into URL parameters, preserving unrelated params (`card`,
 * future view state). Omit the transient language handoff and inactive facets.
 */
export function writeFilterParams(
  filter: CardFilter,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = copySearchParamsWithoutLanguageHandoff(base);
  for (const key of FILTER_PARAM_KEYS) params.delete(paramKey(key));
  const query = filter.query.trim() === "" ? "" : filter.query;
  if (query !== "") params.set(paramKey("q"), query);
  if (filter.due !== "any") params.set(paramKey("due"), filter.due);
  if (filter.labelIds.length > 0)
    params.set(paramKey("labels"), filter.labelIds.join(","));
  if (filter.labelMatch === "all") params.set(paramKey("labelMatch"), "all");
  if (filter.noLabel) params.set(paramKey("noLabel"), "1");
  if (filter.created !== "any") params.set(paramKey("created"), filter.created);
  if (filter.createdOn !== null)
    params.set(paramKey("createdOn"), filter.createdOn);
  if (filter.priorities.length > 0)
    params.set(paramKey("priority"), filter.priorities.join(","));
  if (filter.assignees.length > 0)
    params.set(paramKey("assignee"), filter.assignees.join(","));
  if (filter.unassigned) params.set(paramKey("unassigned"), "1");
  if (filter.blocked) params.set(paramKey("blocked"), "1");
  if (filter.hasLinks) params.set(paramKey("links"), "1");
  if (filter.epicIds.length > 0)
    params.set(paramKey("epic"), filter.epicIds.join(","));
  if (filter.hasEpic) params.set(paramKey("hasEpic"), "1");
  if (filter.noEpic) params.set(paramKey("noEpic"), "1");
  return params;
}

export function hasEpicFacet(filter: CardFilter): boolean {
  return filter.epicIds.length > 0 || filter.hasEpic || filter.noEpic;
}

/** True when at least one facet restricts the board. */
export function isFilterActive(filter: CardFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.labelIds.length > 0 ||
    filter.noLabel ||
    filter.created !== "any" ||
    filter.createdOn !== null ||
    filter.due !== "any" ||
    filter.priorities.length > 0 ||
    filter.assignees.length > 0 ||
    filter.unassigned ||
    filter.blocked ||
    filter.hasLinks ||
    hasEpicFacet(filter)
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
  if (filter.priorities.length > 0) count += 1;
  if (filter.assignees.length > 0 || filter.unassigned) count += 1;
  if (filter.blocked) count += 1;
  if (filter.hasLinks) count += 1;
  if (hasEpicFacet(filter)) count += 1;
  return count;
}

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
 * Local-day range [start, next local midnight) for an exact "YYYY-MM-DD" date,
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
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

/** Whether a single card passes the `due` deadline facet. */
function matchesDueFilter(card: Card, due: DueFilter, now: number): boolean {
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
function cardTextMatches(card: Card, labels: Label[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return false;
  if (card.title.toLowerCase().includes(needle)) return true;
  if (card.description?.toLowerCase().includes(needle)) return true;
  // Checklist items are searchable too (TASK-157, D11) — agents park exact
  // commands there, and a human looks for them the same way.
  if (checklistMatch(card, needle) !== null) return true;
  return card.labelIds.some((id) =>
    labels.some(
      (label) => label.id === id && label.name.toLowerCase().includes(needle),
    ),
  );
}

/** The first checklist-item text containing `needle`, or null. */
export function checklistMatch(card: Card, needle: string): string | null {
  for (const list of card.checklists ?? []) {
    for (const item of list.items) {
      if (item.text.toLowerCase().includes(needle)) return item.text;
    }
  }
  return null;
}

/** Whether a single card passes the filter (AND across facets). */
export function matchesCardFilter(
  card: Card,
  filter: CardFilter,
  now = Date.now(),
  labels: Label[] = [],
  /** Link facts (TASK-46), precomputed by the caller when needed. */
  linkFacts?: { blocked: boolean; linked: boolean },
  /** Lowercased title of the live epic, when the card has one. */
  epicTitle?: string,
): boolean {
  const query = filter.query.trim().toLowerCase();
  if (
    query !== "" &&
    !epicTitle?.includes(query) &&
    !cardTextMatches(card, labels, query)
  )
    return false;

  if (hasEpicFacet(filter)) {
    if (epicTitle === undefined) {
      if (!filter.noEpic) return false;
    } else if (!filter.hasEpic && !filter.epicIds.includes(card.epicId!)) {
      return false;
    }
  }

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

  if (filter.blocked && !(linkFacts?.blocked ?? false)) return false;
  if (filter.hasLinks && !(linkFacts?.linked ?? false)) return false;

  if (
    filter.priorities.length > 0 &&
    !filter.priorities.includes(card.priority ?? DEFAULT_CARD_PRIORITY)
  ) {
    return false;
  }

  // Assignee facet (TASK-49): selected member ids (OR) plus the optional
  // "unassigned" pseudo-option — set neither, restrict nobody.
  if (filter.assignees.length > 0 || filter.unassigned) {
    if (card.assigneeId === undefined) {
      if (!filter.unassigned) return false;
    } else if (!filter.assignees.includes(card.assigneeId)) {
      return false;
    }
  }

  const hasSelected =
    filter.labelMatch === "all" && filter.labelIds.length > 0
      ? filter.labelIds.every((id) => card.labelIds.includes(id))
      : card.labelIds.some((id) => filter.labelIds.includes(id));
  if (filter.noLabel) return card.labelIds.length === 0 || hasSelected;
  if (filter.labelIds.length > 0 && !hasSelected) return false;
  return true;
}

/** Index summary card memberships once per board update, before matching. */
export function indexEpicTitlesByCard(
  cards: Readonly<Record<string, Card>>,
  epics: readonly Epic[],
): ReadonlyMap<string, string> {
  const epicTitleByCard = new Map<string, string>();
  if (epics.length === 0) return epicTitleByCard;
  const titles = new Map(
    epics.map(({ id, title }) => [id, title.toLowerCase()]),
  );
  for (const card of Object.values(cards)) {
    const title =
      card.epicId === undefined ? undefined : titles.get(card.epicId);
    if (title !== undefined) epicTitleByCard.set(card.id, title);
  }
  return epicTitleByCard;
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
  /**
   * Card ids the server matched in text the board aggregate cannot see
   * (comments and attachment names, TASK-177.13). They bypass only the query
   * facet; every other facet still applies, so a comment hit is not shown
   * under a contradicting due/label/assignee filter.
   */
  serverMatchIds?: ReadonlySet<string>,
  epicTitleByCard?: ReadonlyMap<string, string>,
): Record<string, string[]> {
  // The link facets need board-wide facts — build them once per run, and
  // only when one of the facets is actually in play.
  const needsLinks = filter.blocked || filter.hasLinks;
  const index = needsLinks ? cardLinkIndex(cards) : null;
  const factsFor = (id: string) => {
    const facts = index?.factsOf(id);
    return {
      blocked: facts?.blocked ?? false,
      linked: (facts?.degree ?? 0) > 0,
    };
  };
  const facetFilter = serverMatchIds ? { ...filter, query: "" } : filter;
  const result: Record<string, string[]> = {};
  for (const [colId, ids] of Object.entries(columns)) {
    result[colId] = ids.filter((id) => {
      const card = cards[id];
      if (card === undefined) return false;
      const facts = needsLinks ? factsFor(id) : undefined;
      const epicTitle = epicTitleByCard?.get(id);
      if (matchesCardFilter(card, filter, now, labels, facts, epicTitle))
        return true;
      return (
        serverMatchIds?.has(id) === true &&
        matchesCardFilter(card, facetFilter, now, labels, facts, epicTitle)
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
  /** Whether the card itself is archived (TASK-18.1) — shows a badge. */
  cardArchived: boolean;
  /** Column the card sits in; `undefined` for archived (off-board) cards. */
  columnTitle?: string;
  /** The board's label catalogue — lets the UI render label chips. */
  boardLabels: Label[];
  card: Card;
  /**
   * Where the query matched, drives the UI (snippet vs title highlight).
   * `description` and `checklist` hits also come from the server when the
   * board is read-model hydrated (TASK-200.9); `comment`/`attachment` hits
   * do so since TASK-177.13. The rest are matched against the loaded board.
   */
  matchIn:
    "title" | "description" | "label" | "checklist" | "comment" | "attachment";
  /** The matching checklist/comment text or attachment file name. */
  matchText?: string;
  /** Exact comment row behind a `comment` hit. */
  commentId?: string;
  /** Exact attachment row behind an `attachment` hit. */
  attachmentId?: string;
}

/** A board whose title matched — secondary group of the results. */
export interface BoardSearchHit {
  kind: "board";
  boardId: string;
  boardTitle: string;
  boardArchived: boolean;
}

export type SearchHit = CardSearchHit | BoardSearchHit;

/** The palette's two result sections plus the pre-cap totals. */
export interface SearchHitGroups {
  cards: CardSearchHit[];
  boards: BoardSearchHit[];
  /** Total card matches before the cap. */
  totalCards: number;
  /** Total board matches before the cap. */
  totalBoards: number;
  /** Whether either group had more hits than the default cap allowed. */
  capped: boolean;
}

export interface GroupSearchHitsOptions {
  /** Return the expanded list (still bounded by `expandedCap`). */
  showAll?: boolean;
  /**
   * Hard ceiling for the expanded list. Defaults to no extra ceiling; the
   * palette always passes its own bound.
   */
  expandedCap?: number;
}

/**
 * Split the flat `searchBoards` result into the palette's `Cards` and
 * `Boards` sections, then cap each section independently (TASK-177.10).
 * Capping after grouping means a board hit can never be pushed out by a
 * long card list. `showAll` expands to `expandedCap`, never to an unbounded
 * list; the palette's header keeps the `shown of total` label in that case.
 */
export function groupSearchHits(
  hits: SearchHit[],
  cap: number,
  {
    showAll = false,
    expandedCap = Number.POSITIVE_INFINITY,
  }: GroupSearchHitsOptions = {},
): SearchHitGroups {
  const cards: CardSearchHit[] = [];
  const boards: BoardSearchHit[] = [];
  for (const hit of hits) {
    if (hit.kind === "card") cards.push(hit);
    else boards.push(hit);
  }
  const limit = showAll ? expandedCap : cap;
  return {
    cards: cards.slice(0, limit),
    boards: boards.slice(0, limit),
    totalCards: cards.length,
    totalBoards: boards.length,
    capped: cards.length > cap || boards.length > cap,
  };
}

/** Field priority for ranking: title beats description beats label/checklist. */
const MATCH_FIELD_ORDER = [
  "title",
  "description",
  "label",
  "checklist",
] as const;

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
    // Precompute label-id → lowercased name once per board, so matching a
    // card's labels is a Map lookup instead of scanning `board.labels`.
    const labelName = new Map(
      board.labels.map((label) => [label.id, label.name.toLowerCase()]),
    );
    const hitFor = (card: Card, columnTitle?: string): CardSearchHit | null => {
      const matched = MATCH_FIELD_ORDER.find((field) => {
        switch (field) {
          case "title":
            return card.title.toLowerCase().includes(needle);
          case "description":
            return card.description?.toLowerCase().includes(needle) ?? false;
          case "label":
            return card.labelIds.some(
              (id) => labelName.get(id)?.includes(needle) ?? false,
            );
          case "checklist":
            return checklistMatch(card, needle) !== null;
        }
      });
      if (!matched) return null;
      const matchText =
        matched === "checklist" ? (checklistMatch(card, needle) ?? "") : "";
      return {
        kind: "card",
        boardId: board.id,
        boardTitle: board.title,
        boardArchived: board.archivedAt !== undefined,
        cardArchived: card.archivedAt !== undefined,
        columnTitle,
        boardLabels: board.labels,
        card,
        matchIn: matched,
        ...(matched === "checklist" ? { matchText } : {}),
      };
    };
    for (const column of board.columns) {
      for (const cardId of column.cardIds) {
        const card = board.cards[cardId];
        if (!card) continue;
        // Legacy exports can leave an archived card in a column. The
        // archived pass below owns it, so skip it here to avoid a duplicate
        // hit (and a duplicate React key).
        if (card.archivedAt !== undefined) continue;
        const hit = hitFor(card, column.title);
        if (hit) cardHits.push(hit);
      }
    }
    // Archived cards sit outside every column — search still finds them.
    for (const card of Object.values(board.cards)) {
      if (card.archivedAt === undefined) continue;
      const hit = hitFor(card);
      if (hit) cardHits.push(hit);
    }
  }

  return [...cardHits, ...boardHits];
}

/**
 * Natural card order used by `searchBoards`: active boards before archived,
 * columns in stored order, then the board's off-column archived cards.
 * Server hits are inserted by this rank so adding one does not move it below
 * an archived local hit (TASK-177.13 review).
 */
function cardSearchRank(boards: Board[]): Map<string, number> {
  const rank = new Map<string, number>();
  const sorted = [...boards].sort(
    (a, b) =>
      Number(a.archivedAt !== undefined) - Number(b.archivedAt !== undefined),
  );
  let index = 0;
  for (const board of sorted) {
    for (const column of board.columns) {
      for (const cardId of column.cardIds) {
        const card = board.cards[cardId];
        if (!card || card.archivedAt !== undefined) continue;
        rank.set(`${board.id}:${cardId}`, index++);
      }
    }
    for (const card of Object.values(board.cards)) {
      if (card.archivedAt === undefined) continue;
      const key = `${board.id}:${card.id}`;
      if (!rank.has(key)) rank.set(key, index++);
    }
  }
  return rank;
}

/**
 * Append server-only content matches to the local palette hits (TASK-177.13,
 * TASK-200.9). Boards and cards must already be loaded — the palette searches
 * the loaded workspace for titles and labels, while descriptions, checklist
 * items, comment text and attachment names come from the server because the
 * read model does not ship them. A card matched in a board that is still
 * hydrating is picked up when that board arrives. One row per card: a local
 * title/label hit wins over a server hit, and the first server hit wins over
 * later ones.
 */
export function mergeWorkspaceSearchHits(
  hits: SearchHit[],
  boards: Board[],
  matches: readonly WorkspaceSearchMatch[],
): SearchHit[] {
  const boardById = new Map(boards.map((board) => [board.id, board]));
  const seen = new Set(
    hits
      .filter((hit): hit is CardSearchHit => hit.kind === "card")
      .map((hit) => `${hit.boardId}:${hit.card.id}`),
  );
  const extra: CardSearchHit[] = [];
  for (const match of matches) {
    const key = `${match.boardId}:${match.cardId}`;
    if (seen.has(key)) continue;
    const board = boardById.get(match.boardId);
    const card = board?.cards[match.cardId];
    if (!board || !card) continue;
    seen.add(key);
    const columnTitle = board.columns.find((column) =>
      column.cardIds.includes(card.id),
    )?.title;
    extra.push({
      kind: "card",
      boardId: board.id,
      boardTitle: board.title,
      boardArchived: board.archivedAt !== undefined,
      cardArchived: card.archivedAt !== undefined,
      columnTitle,
      boardLabels: board.labels,
      card,
      matchIn: match.matchIn,
      ...(match.text === undefined ? {} : { matchText: match.text }),
      ...(match.matchIn === "comment" ? { commentId: match.commentId } : {}),
      ...(match.matchIn === "attachment"
        ? { attachmentId: match.attachmentId }
        : {}),
    });
  }
  if (extra.length === 0) return hits;

  const rank = cardSearchRank(boards);
  const rankOf = (hit: SearchHit) =>
    hit.kind === "card"
      ? (rank.get(`${hit.boardId}:${hit.card.id}`) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
  const cards = [...hits.filter((hit) => hit.kind === "card"), ...extra].sort(
    (a, b) => rankOf(a) - rankOf(b),
  );
  const boardHits = hits.filter((hit) => hit.kind === "board");
  return [...cards, ...boardHits];
}

/** The visible type badge for a hit: `Card`, `Board`, `Comment`, `Attachment`. */
export function searchHitBadge(
  hit: SearchHit,
): "card" | "board" | "comment" | "attachment" {
  if (hit.kind === "board") return "board";
  return hit.matchIn === "comment" || hit.matchIn === "attachment"
    ? hit.matchIn
    : "card";
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
    segments.push({
      match: true,
      text: text.slice(index, index + needle.length),
    });
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
