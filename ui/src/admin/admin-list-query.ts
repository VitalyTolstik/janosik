import { ADMIN_PAGE_LIMITS } from "@janosik/shared";

/**
 * Typed URL state for the admin listings (TASK-176.5).
 *
 * One parser/serializer for every page that wants a shareable list:
 * `search`, `status`, `period`, `limit`, `offset` and the structural
 * `boardId`/`columnId`/`labelId`/`cardId` filters (TASK-176.6). Query keys
 * that belong to a hub (`tab`), a detail anchor (`comment`, `attachment`) or a
 * return path (`returnTo`) are left untouched.
 *
 * Nothing here is secret: the list URL only carries filters and a page
 * window, never a token, password or one-time code.
 */

export type AdminListFilterKey = "boardId" | "columnId" | "labelId" | "cardId";

export interface AdminListFilters {
  boardId: string | null;
  columnId: string | null;
  labelId: string | null;
  cardId: string | null;
}

export interface AdminListQueryState {
  search: string;
  status: string;
  /** Preset age window (`any`, `24h`, `7d`, `30d`). */
  period: string;
  limit: number;
  offset: number;
  filters: AdminListFilters;
}

export interface AdminListQueryOptions {
  /** Status values the entity actually supports; `all` is always allowed. */
  statuses?: readonly string[];
  /** Whether the entity has the period tabs. */
  periods?: boolean;
  /** Page size when the URL does not name one. */
  defaultLimit?: number;
}

export const EMPTY_ADMIN_LIST_FILTERS: AdminListFilters = {
  boardId: null,
  columnId: null,
  labelId: null,
  cardId: null,
};

export const ADMIN_LIST_FILTER_KEYS: readonly AdminListFilterKey[] = [
  "boardId",
  "columnId",
  "labelId",
  "cardId",
];

/** Period tabs and their windows; the parser and the fetcher share this set. */
export const PERIOD_WINDOWS_MS: Record<string, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function defaultLimit(options: AdminListQueryOptions): number {
  return options.defaultLimit ?? ADMIN_PAGE_LIMITS.default;
}

function readInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function readId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Parse only the list keys; unknown and unrelated keys stay untouched. */
export function readAdminListQuery(
  params: URLSearchParams,
  options: AdminListQueryOptions = {},
): AdminListQueryState {
  const statuses = new Set<string>(["all", ...(options.statuses ?? [])]);
  const status = params.get("status") ?? "all";
  const period = params.get("period") ?? "any";

  return {
    search: (params.get("search") ?? "").slice(0, 200),
    status: statuses.has(status) ? status : "all",
    period:
      options.periods === true && period in PERIOD_WINDOWS_MS ? period : "any",
    limit: readInt(
      params.get("limit"),
      defaultLimit(options),
      ADMIN_PAGE_LIMITS.min,
      ADMIN_PAGE_LIMITS.max,
    ),
    offset: readInt(params.get("offset"), 0, 0, ADMIN_PAGE_LIMITS.maxOffset),
    filters: {
      boardId: readId(params.get("boardId")),
      columnId: readId(params.get("columnId")),
      labelId: readId(params.get("labelId")),
      cardId: readId(params.get("cardId")),
    },
  };
}

/**
 * Serialize a list state back into the query. Defaults are removed so a clean
 * list has a clean URL; keys owned by the hub/detail are preserved.
 */
export function writeAdminListQuery(
  current: URLSearchParams,
  state: AdminListQueryState,
  options: AdminListQueryOptions = {},
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of [
    "search",
    "status",
    "period",
    "limit",
    "offset",
    ...ADMIN_LIST_FILTER_KEYS,
  ]) {
    next.delete(key);
  }

  if (state.search !== "") next.set("search", state.search);
  if (state.status !== "all") next.set("status", state.status);
  if (state.period !== "any" && state.period in PERIOD_WINDOWS_MS) {
    next.set("period", state.period);
  }
  const limit = defaultLimit(options);
  if (state.limit !== limit) next.set("limit", String(state.limit));
  if (state.offset > 0) next.set("offset", String(state.offset));
  for (const key of ADMIN_LIST_FILTER_KEYS) {
    const value = state.filters[key];
    if (value !== null) next.set(key, value);
  }
  return next;
}

/** Stable comparison key for effects and change detection. */
export function adminListQueryKey(state: AdminListQueryState): string {
  return JSON.stringify(state);
}

export function adminFiltersKey(filters: AdminListFilters): string {
  return ADMIN_LIST_FILTER_KEYS.map((key) => filters[key] ?? "").join("|");
}

export function hasAdminFilters(filters: AdminListFilters): boolean {
  return ADMIN_LIST_FILTER_KEYS.some((key) => filters[key] !== null);
}
