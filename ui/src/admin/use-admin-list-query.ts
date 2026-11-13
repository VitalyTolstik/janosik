import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminPage } from "@janosik/shared";
import type { AdminListParams } from "./admin-client";
import {
  adminFiltersKey,
  adminListQueryKey,
  readAdminListQuery,
  writeAdminListQuery,
  type AdminListQueryOptions,
  type AdminListQueryState,
} from "./admin-list-query";
import { useAdminList, type AdminListState } from "./use-admin-list";

/**
 * URL-backed admin list (TASK-176.5). The hooks stays two-way:
 *
 * - URL → list: a deep link, `Back`/`Forward` or a hub tab switch applies
 *   `search/status/period/limit/offset` and the structural filters;
 * - list → URL: a user change writes the same values back, preserving
 *   unrelated keys (`tab`, `comment`, `attachment`, `returnTo`).
 *
 * Typing replaces the current history entry (one entry per committed search,
 * not per keystroke); filters and pagination push a new entry so browser
 * back/forward stays useful.
 */

export function listStateOf<T>(list: AdminListState<T>): AdminListQueryState {
  return {
    search: list.effectiveSearch,
    status: list.status,
    period: list.period,
    limit: list.limit,
    offset: list.offset,
    filters: list.filters,
  };
}

export function useAdminListQuery<T>(
  fetcher: (params: AdminListParams) => Promise<AdminPage<T>>,
  options: AdminListQueryOptions = {},
): AdminListState<T> {
  const [params, setParams] = useSearchParams();
  const statusKey = (options.statuses ?? []).join(",");
  const periods = options.periods === true;
  const defaultLimit = options.defaultLimit;

  const parsed = useMemo(
    () =>
      readAdminListQuery(params, {
        statuses: options.statuses,
        periods,
        defaultLimit,
      }),
    // `statusKey` stands in for the array identity: callers build the list
    // from translations on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, statusKey, periods, defaultLimit],
  );

  const list = useAdminList(fetcher, { initialState: parsed });
  const state = listStateOf(list);
  const listKey = adminListQueryKey(state);
  const urlKey = adminListQueryKey(parsed);
  const lastUrlKey = useRef(urlKey);
  const applyingFromUrl = useRef(false);

  // URL → hook. Our own writes set `lastUrlKey` before navigating, so this
  // effect only reacts to back/forward and deep links.
  useEffect(() => {
    if (urlKey === lastUrlKey.current) return;
    lastUrlKey.current = urlKey;
    applyingFromUrl.current = true;
    list.applyState(parsed);
    // `list.applyState` is stable; `parsed` changes exactly with `urlKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // Hook → URL. Compare with the URL state captured before the user change to
  // decide whether this is a search keystroke (replace) or a new view (push).
  useEffect(() => {
    if (applyingFromUrl.current) {
      // `applyState` schedules a render; hold the URL write until the list
      // matches the URL again. This is what stops a back-navigation from
      // being immediately overwritten by the previous list state.
      if (listKey === lastUrlKey.current) applyingFromUrl.current = false;
      return;
    }
    if (listKey === lastUrlKey.current) return;
    const onlySearch =
      state.status === parsed.status &&
      state.period === parsed.period &&
      state.limit === parsed.limit &&
      state.offset === parsed.offset &&
      adminFiltersKey(state.filters) === adminFiltersKey(parsed.filters) &&
      state.search !== parsed.search;

    lastUrlKey.current = listKey;
    setParams(
      (current) => writeAdminListQuery(current, state, { defaultLimit }),
      { replace: onlySearch },
    );
    // The URL write must run once per list-state change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  return list;
}
