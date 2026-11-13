import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPage } from "@janosik/shared";
import type { AdminListParams } from "./admin-client";
import {
  EMPTY_ADMIN_LIST_FILTERS,
  PERIOD_WINDOWS_MS,
  adminFiltersKey,
  type AdminListFilterKey,
  type AdminListFilters,
  type AdminListQueryState,
} from "./admin-list-query";

/**
 * List state for admin tables (TASK-36): debounced search, status filter,
 * offset pagination and a manual reload — one implementation instead of
 * five slightly different `useEffect`s.
 *
 * TASK-176.5 adds `initialState`/`applyState` and the structural filters so a
 * page wrapper (`useAdminListQuery`) can use the URL as the source of truth
 * and restore it on load/back/forward.
 *
 * Loading is derived from the request key rather than written in the effect
 * body: state is only written when an answer (or a failure) arrives, and a
 * stale answer for an older key can never overwrite a newer one.
 */

const SEARCH_DEBOUNCE_MS = 250;

export { PERIOD_WINDOWS_MS };

export interface AdminListState<T> {
  items: T[];
  total: number;
  /** First response has not arrived yet — show the table skeleton. */
  loading: boolean;
  /** A newer request is in flight while the previous rows stay on screen. */
  refreshing: boolean;
  error: boolean;
  /** Raw input value; updates on every keystroke. */
  search: string;
  /** Committed (debounced) search used for the request and the URL. */
  effectiveSearch: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  /** Age window over `createdAt` ("any" disables the bound). */
  period: string;
  setPeriod: (value: string) => void;
  offset: number;
  setOffset: (value: number) => void;
  limit: number;
  setLimit: (value: number) => void;
  /** Exact id filters shared by every addressable list (TASK-176.6). */
  filters: AdminListFilters;
  setFilter: (key: AdminListFilterKey, value: string | null) => void;
  clearFilters: () => void;
  /** Replace the whole state from the URL (back/forward or a deep link). */
  applyState: (state: AdminListQueryState) => void;
  /** HTTP status of the failed request (`null` when the last answer was ok). */
  errorStatus: number | null;
  reload: () => void;
}

interface ListResult<T> {
  key: string;
  items: T[];
  total: number;
  error: boolean;
  errorStatus?: number | null;
}

export function useAdminList<T>(
  fetcher: (params: AdminListParams) => Promise<AdminPage<T>>,
  options: { limit?: number; initialState?: AdminListQueryState } = {},
): AdminListState<T> {
  const initial = options.initialState;
  const [limit, setLimitState] = useState(
    initial?.limit ?? options.limit ?? 50,
  );
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [rawSearch, setRawSearch] = useState(initial?.search ?? "");
  const [search, setSearch] = useState(initial?.search ?? "");
  const [status, setStatusRaw] = useState(initial?.status ?? "all");
  const [period, setPeriodRaw] = useState(initial?.period ?? "any");
  const [offset, setOffset] = useState(initial?.offset ?? 0);
  const [filters, setFilters] = useState<AdminListFilters>(
    initial?.filters ?? EMPTY_ADMIN_LIST_FILTERS,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ListResult<T> | null>(null);

  useEffect(() => {
    // Do not schedule a reset for the initial (empty) search or for a value
    // that has already been committed: a fast page click right after mount
    // must keep its offset instead of being pulled back to page 1. The same
    // guard keeps `applyState` (URL restore) from bouncing through the
    // debounce.
    if (rawSearch === search) return;
    const timer = setTimeout(() => {
      setSearch(rawSearch);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawSearch, search]);

  const filterKey = adminFiltersKey(filters);
  const requestKey = `${search}|${status}|${period}|${limit}|${offset}|${filterKey}|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    const from =
      period === "any" ? undefined : Date.now() - PERIOD_WINDOWS_MS[period];
    void fetcherRef
      .current({
        search,
        status,
        from,
        limit,
        offset,
        ...(filters.boardId === null ? {} : { boardId: filters.boardId }),
        ...(filters.columnId === null ? {} : { columnId: filters.columnId }),
        ...(filters.labelId === null ? {} : { labelId: filters.labelId }),
        ...(filters.cardId === null ? {} : { cardId: filters.cardId }),
      })
      .then((page) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          items: page.items,
          total: page.total,
          error: false,
          errorStatus: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof (error as { status?: unknown }).status === "number"
            ? (error as { status: number }).status
            : null;
        setResult({
          key: requestKey,
          items: [],
          total: 0,
          error: true,
          errorStatus: status,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, search, status, period, limit, offset, filters, filterKey]);

  // Keep the last successful page while a search/page request is in flight
  // (SKELETON-AUDIT §4.11): the table header and rows must not vanish on
  // every keystroke. Only the very first answer gets a skeleton.
  const loading = result === null;
  const refreshing = result !== null && result.key !== requestKey;

  const setSearchInput = useCallback((value: string) => {
    setRawSearch(value);
  }, []);

  const setStatus = useCallback((value: string) => {
    setStatusRaw(value);
    setOffset(0);
  }, []);

  const setPeriod = useCallback((value: string) => {
    setPeriodRaw(value);
    setOffset(0);
  }, []);

  const setLimit = useCallback((value: number) => {
    setLimitState(value);
    setOffset(0);
  }, []);

  const setFilter = useCallback(
    (key: AdminListFilterKey, value: string | null) => {
      setFilters((current) => {
        const next = value === null || value.trim() === "" ? null : value;
        if (current[key] === next) return current;
        return { ...current, [key]: next };
      });
      setOffset(0);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_ADMIN_LIST_FILTERS);
    setOffset(0);
  }, []);

  const applyState = useCallback((next: AdminListQueryState) => {
    // Commit both values at once: the debounce effect then sees
    // `rawSearch === search` and does not schedule another reset.
    setRawSearch(next.search);
    setSearch(next.search);
    setStatusRaw(next.status);
    setPeriodRaw(next.period);
    setLimitState(next.limit);
    setOffset(next.offset);
    setFilters(next.filters);
  }, []);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return {
    items: result?.items ?? [],
    total: result?.total ?? 0,
    loading,
    refreshing,
    // Keep a previous failure on screen while its retry is in flight; the
    // retry must not masquerade as an empty result.
    error: result?.error ?? false,
    search: rawSearch,
    effectiveSearch: search,
    setSearch: setSearchInput,
    status,
    setStatus,
    period,
    setPeriod,
    offset,
    setOffset,
    limit,
    setLimit,
    filters,
    setFilter,
    clearFilters,
    applyState,
    errorStatus: result?.errorStatus ?? null,
    reload,
  };
}
