import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENTITY_FILTERS,
  ENTITY_STATUS_VALUES,
  normalizeAdminStatus,
  type AdminFilterKey,
  type AdminFilterValues,
  type AdminListSurface,
  type AdminPage,
} from "@janosik/shared";
import type { AdminListParams } from "./admin-client";
import { ApiError } from "@/api/client";
import {
  EMPTY_ADMIN_LIST_FILTERS,
  PERIOD_WINDOWS_MS,
  adminFiltersKey,
  adminListRequestFilters,
  listFilterError,
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
  /**
   * Offset/limit echoed by the response that produced `items` — not the
   * pending request. A count label can pair these with `items.length` without
   * mixing a new page number with the previous page's rows.
   */
  pageOffset: number;
  pageLimit: number;
  /** First response has not arrived yet — show the table skeleton. */
  loading: boolean;
  /** A newer request is in flight while the previous rows stay on screen. */
  refreshing: boolean;
  error: boolean;
  filterError?: string;
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
  setFilter: <Key extends AdminFilterKey>(
    key: Key,
    value: AdminFilterValues[Key] | null,
  ) => void;
  clearFilters: () => void;
  /** Replace the whole state from the URL (back/forward or a deep link). */
  applyState: (state: AdminListQueryState) => void;
  /** HTTP status of the failed request (`null` when the last answer was ok). */
  errorStatus: number | null;
  errorBody?: unknown;
  reload: () => void;
}

interface ListResult<T> {
  key: string;
  items: T[];
  total: number;
  /** Offset/limit echoed by the server for this page. */
  offset: number;
  limit: number;
  error: boolean;
  errorStatus?: number | null;
  errorBody?: unknown;
}

export function useAdminList<T>(
  fetcher: (params: AdminListParams) => Promise<AdminPage<T>>,
  options: {
    limit?: number;
    initialState?: AdminListQueryState;
    surface?: AdminListSurface;
  } = {},
): AdminListState<T> {
  const { initialState: initial, surface } = options;
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
    (surface === undefined ? undefined : initial?.filters) ??
      EMPTY_ADMIN_LIST_FILTERS,
  );
  const [urlFilterError, setUrlFilterError] = useState(
    surface === undefined ? undefined : initial?.filterError,
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

  const filterError = urlFilterError ?? listFilterError(filters, surface);
  const requestKey = JSON.stringify([
    surface,
    search,
    status,
    period,
    limit,
    offset,
    adminFiltersKey(filters),
    reloadKey,
  ]);

  useEffect(() => {
    if (filterError !== undefined) return;
    let cancelled = false;
    const window = Object.hasOwn(PERIOD_WINDOWS_MS, period)
      ? PERIOD_WINDOWS_MS[period]
      : undefined;
    const from =
      window !== undefined &&
      surface !== undefined &&
      ENTITY_FILTERS[surface].dateRange
        ? Date.now() - window
        : undefined;
    void fetcherRef
      .current({
        search,
        status,
        from,
        limit,
        offset,
        ...adminListRequestFilters(filters, surface),
      })
      .then((page) => {
        if (cancelled) return;
        // A page can fall out of range when rows are removed between
        // requests. Clamp to the last real page instead of showing an empty
        // page whose offset is past the server total.
        const lastPageOffset =
          page.total > 0
            ? Math.max(
                0,
                Math.floor((page.total - 1) / Math.max(1, page.limit)) *
                  page.limit,
              )
            : 0;
        if (
          page.total > 0 &&
          page.items.length === 0 &&
          page.offset > lastPageOffset
        ) {
          setOffset(lastPageOffset);
          return;
        }
        setResult({
          key: requestKey,
          items: page.items,
          total: page.total,
          offset: page.offset,
          limit: page.limit,
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
          offset: 0,
          limit,
          error: true,
          errorStatus: status,
          errorBody: error instanceof ApiError ? error.body : undefined,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    requestKey,
    search,
    status,
    period,
    limit,
    offset,
    filters,
    surface,
    filterError,
  ]);

  // Keep the last successful page while a search/page request is in flight
  // (SKELETON-AUDIT §4.11): the table header and rows must not vanish on
  // every keystroke. Only the very first answer gets a skeleton.
  const loading = result === null && filterError === undefined;
  const refreshing =
    result !== null && result.key !== requestKey && filterError === undefined;

  const setSearchInput = useCallback((value: string) => {
    setRawSearch(value);
  }, []);

  const setStatus = useCallback(
    (value: string) => {
      const normalized = normalizeAdminStatus(surface, value);
      if (
        surface !== undefined &&
        !ENTITY_STATUS_VALUES[surface].includes(normalized)
      )
        return;
      setStatusRaw(normalized);
      setOffset(0);
    },
    [surface],
  );

  const setPeriod = useCallback((value: string) => {
    setPeriodRaw(value);
    setOffset(0);
  }, []);

  const setLimit = useCallback((value: number) => {
    setLimitState(value);
    setOffset(0);
  }, []);

  const setFilter = useCallback(
    <Key extends AdminFilterKey>(
      key: Key,
      value: AdminFilterValues[Key] | null,
    ) => {
      if (
        surface === undefined ||
        !ENTITY_FILTERS[surface].implemented.includes(key)
      )
        return;
      setFilters((current) => {
        const next =
          typeof value === "string" && value.trim() === "" ? null : value;
        if (current[key] === next) return current;
        const updated = { ...current };
        if (next === null && !(key in EMPTY_ADMIN_LIST_FILTERS)) {
          delete updated[key];
        } else {
          Object.assign(updated, { [key]: next });
        }
        return updated;
      });
      setUrlFilterError(undefined);
      setOffset(0);
    },
    [surface],
  );

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_ADMIN_LIST_FILTERS);
    setUrlFilterError(undefined);
    setOffset(0);
  }, []);

  const applyState = useCallback(
    (next: AdminListQueryState) => {
      // Commit both values at once: the debounce effect then sees
      // `rawSearch === search` and does not schedule another reset.
      setRawSearch(next.search);
      setSearch(next.search);
      setStatusRaw(next.status);
      setPeriodRaw(next.period);
      setLimitState(next.limit);
      setOffset(next.offset);
      setFilters(
        surface === undefined ? EMPTY_ADMIN_LIST_FILTERS : next.filters,
      );
      setUrlFilterError(surface === undefined ? undefined : next.filterError);
    },
    [surface],
  );

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return {
    items: filterError === undefined ? (result?.items ?? []) : [],
    total: filterError === undefined ? (result?.total ?? 0) : 0,
    pageOffset: filterError === undefined ? (result?.offset ?? 0) : 0,
    pageLimit: filterError === undefined ? (result?.limit ?? limit) : limit,
    loading,
    refreshing,
    // Keep a previous failure on screen while its retry is in flight; the
    // retry must not masquerade as an empty result.
    error: filterError !== undefined || (result?.error ?? false),
    filterError,
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
    errorStatus:
      filterError === undefined ? (result?.errorStatus ?? null) : null,
    errorBody: result?.key === requestKey ? result.errorBody : undefined,
    reload,
  };
}
