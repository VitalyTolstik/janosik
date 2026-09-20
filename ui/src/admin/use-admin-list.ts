import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPage } from "@janosik/shared";
import type { AdminListParams } from "./admin-client";

/**
 * List state for admin tables (TASK-36): debounced search, status filter,
 * offset pagination and a manual reload — one implementation instead of
 * five slightly different `useEffect`s.
 *
 * Loading is derived from the request key rather than written in the effect
 * body: state is only written when an answer (or a failure) arrives, and a
 * stale answer for an older key can never overwrite a newer one.
 */

const SEARCH_DEBOUNCE_MS = 250;

/** Preset windows behind the period tabs (`from` = now − window). */
export const PERIOD_WINDOWS_MS: Record<string, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

export interface AdminListState<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: boolean;
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  /** Age window over `createdAt` ("any" disables the bound). */
  period: string;
  setPeriod: (value: string) => void;
  offset: number;
  setOffset: (value: number) => void;
  limit: number;
  reload: () => void;
}

interface ListResult<T> {
  key: string;
  items: T[];
  total: number;
  error: boolean;
}

export function useAdminList<T>(
  fetcher: (params: AdminListParams) => Promise<AdminPage<T>>,
  options: { limit?: number } = {},
): AdminListState<T> {
  const limit = options.limit ?? 50;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatusRaw] = useState("all");
  const [period, setPeriodRaw] = useState("any");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ListResult<T> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(rawSearch);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawSearch]);

  const requestKey = `${search}|${status}|${period}|${limit}|${offset}|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    const from =
      period === "any" ? undefined : Date.now() - PERIOD_WINDOWS_MS[period];
    void fetcherRef
      .current({ search, status, from, limit, offset })
      .then((page) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          items: page.items,
          total: page.total,
          error: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ key: requestKey, items: [], total: 0, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, search, status, period, limit, offset]);

  const loading = result === null || result.key !== requestKey;

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

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return {
    items: loading ? [] : (result?.items ?? []),
    total: loading ? 0 : (result?.total ?? 0),
    loading,
    error: !loading && (result?.error ?? false),
    search: rawSearch,
    setSearch: setSearchInput,
    status,
    setStatus,
    period,
    setPeriod,
    offset,
    setOffset,
    limit,
    reload,
  };
}
