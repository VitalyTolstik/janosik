import {
  ADMIN_FILTER_KEYS,
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  ADMIN_PAGE_LIMITS,
  ENTITY_FILTERS,
  ENTITY_STATUS_VALUES,
  adminFilterEntries,
  adminFilterLimitError,
  adminFilterValueLimit,
  canonicalAdminFilterValues,
  normalizeAdminStatus,
  parseAdminFilterValue,
  type AdminFilterKey,
  type AdminFilters,
  type AdminFilterValues,
  type AdminListSurface,
} from "@janosik/shared";

/** The TASK-176.6 chips still use this subset until the new filter bar lands. */
export const ADMIN_LIST_FILTER_KEYS = [
  "boardId",
  "columnId",
  "labelId",
  "cardId",
  "commandId",
] as const;
export type AdminListFilterKey = (typeof ADMIN_LIST_FILTER_KEYS)[number];

export type AdminListFilters = {
  [Key in AdminListFilterKey]: AdminFilterValues[Key] | null;
} & Partial<Omit<AdminFilterValues, AdminListFilterKey>>;

export interface AdminListQueryState {
  search: string;
  status: string;
  period: string;
  limit: number;
  offset: number;
  filters: AdminListFilters;
  filterError?: string;
}

export interface AdminListQueryOptions {
  surface?: AdminListSurface;
  statuses?: readonly string[];
  periods?: boolean;
  defaultLimit?: number;
}

export const EMPTY_ADMIN_LIST_FILTERS: AdminListFilters = {
  boardId: null,
  columnId: null,
  labelId: null,
  cardId: null,
  commandId: null,
};

export const PERIOD_WINDOWS_MS: Record<string, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
};

function defaultLimit(options: AdminListQueryOptions): number {
  return options.defaultLimit ?? ADMIN_PAGE_LIMITS.default;
}

function singleValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function readInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function supportedKeys(
  surface: AdminListSurface | undefined,
): readonly AdminFilterKey[] {
  return surface === undefined ? [] : ENTITY_FILTERS[surface].implemented;
}

function allowsStatus(
  status: string,
  { surface, statuses }: AdminListQueryOptions,
): boolean {
  return (
    (surface === undefined || ENTITY_STATUS_VALUES[surface].includes(status)) &&
    (statuses === undefined || statuses.includes(status))
  );
}

function allowsPeriod(
  { surface, periods }: AdminListQueryOptions,
  fallback: boolean,
): boolean {
  return (
    (periods ?? (surface === undefined ? fallback : true)) &&
    (surface === undefined || ENTITY_FILTERS[surface].period)
  );
}

function readFilters(
  params: URLSearchParams,
  surface: AdminListSurface | undefined,
) {
  const filters: AdminListFilters = { ...EMPTY_ADMIN_LIST_FILTERS };
  let filterError: string | undefined;

  for (const key of supportedKeys(surface)) {
    const values = params.getAll(key);
    if (values.length === 0) continue;
    const max = adminFilterValueLimit(key);
    if (max === 1) {
      if (values.length > 1) {
        // Repeated card labels belong to a later rollout wave.
        if (surface !== "cards" || key !== "labelId") {
          filterError ??= `${key} accepts one value. Remove the repeated filter.`;
        }
        continue;
      }
      const value = parseAdminFilterValue(key, values[0], surface);
      if (value !== undefined) Object.assign(filters, { [key]: value });
    } else {
      const valid = canonicalAdminFilterValues(
        values.filter(
          (value) => parseAdminFilterValue(key, value, surface) !== undefined,
        ),
      );
      if (valid.length > max) {
        filterError ??= `${key} accepts up to ${max} values. Remove some values to continue.`;
      } else if (valid.length > 0) {
        Object.assign(filters, { [key]: valid });
      }
    }
  }

  if (
    filters.labelMatch === "any" ||
    !Array.isArray(filters.labelId) ||
    filters.labelId.length < 2
  ) {
    delete filters.labelMatch;
  }
  if (filters.unassigned === false) delete filters.unassigned;
  filterError ??= adminFilterLimitError(adminFilterEntries(filters, surface));
  return { filters, filterError };
}

/** Parse list keys and leave hub and detail parameters to their owners. */
export function readAdminListQuery(
  params: URLSearchParams,
  options: AdminListQueryOptions = {},
): AdminListQueryState {
  const { surface } = options;
  const status = normalizeAdminStatus(
    surface,
    singleValue(params, "status") ?? "all",
  );
  const period = singleValue(params, "period") ?? "any";
  const { filters, filterError } = readFilters(params, surface);
  const repeated = ["search", "status", "period", "limit", "offset"].find(
    (key) => params.getAll(key).length > 1,
  );
  const error =
    filterError ??
    (repeated === undefined
      ? undefined
      : `${repeated} accepts one value. Remove the repeated parameter.`);

  return {
    search: (singleValue(params, "search") ?? "").slice(
      0,
      ADMIN_FILTER_QUERY_MAX_LENGTH,
    ),
    status:
      (surface !== undefined || options.statuses !== undefined) &&
      allowsStatus(status, options)
        ? status
        : "all",
    period:
      allowsPeriod(options, false) && Object.hasOwn(PERIOD_WINDOWS_MS, period)
        ? period
        : "any",
    limit: readInt(
      singleValue(params, "limit"),
      defaultLimit(options),
      ADMIN_PAGE_LIMITS.min,
      ADMIN_PAGE_LIMITS.max,
    ),
    offset: readInt(
      singleValue(params, "offset"),
      0,
      0,
      ADMIN_PAGE_LIMITS.maxOffset,
    ),
    filters,
    ...(error === undefined ? {} : { filterError: error }),
  };
}

export function adminListRequestFilters(
  filters: AdminListFilters,
  surface?: AdminListSurface,
): AdminFilters {
  if (surface === undefined) return {};
  const params = new URLSearchParams(adminFilterEntries(filters, surface));
  const request: AdminFilters = {};
  for (const key of new Set(
    params.keys() as IterableIterator<AdminFilterKey>,
  )) {
    const values = params.getAll(key);
    const value =
      adminFilterValueLimit(key) > 1
        ? values
        : parseAdminFilterValue(key, values[0], surface);
    Object.assign(request, { [key]: value });
  }
  return request;
}

export function listFilterError(
  filters: AdminListFilters,
  surface?: AdminListSurface,
): string | undefined {
  if (surface === undefined) return undefined;
  for (const key of supportedKeys(surface)) {
    const value = filters[key];
    const max = adminFilterValueLimit(key);
    if (
      Array.isArray(value) &&
      max > 1 &&
      canonicalAdminFilterValues(value).length > max
    ) {
      return `${key} accepts up to ${max} values. Remove some values to continue.`;
    }
  }
  return adminFilterLimitError(adminFilterEntries(filters, surface));
}

/** Write only the list-owned parameters and preserve unrelated context. */
export function writeAdminListQuery(
  current: URLSearchParams,
  state: AdminListQueryState,
  options: AdminListQueryOptions = {},
): URLSearchParams {
  const { surface } = options;
  const filterError =
    state.filterError ?? listFilterError(state.filters, surface);
  if (filterError !== undefined) throw new Error(filterError);

  const next = new URLSearchParams(current);
  for (const key of [
    "search",
    "status",
    "period",
    "limit",
    "offset",
    ...ADMIN_FILTER_KEYS,
  ]) {
    next.delete(key);
  }

  if (state.search !== "") next.set("search", state.search);
  const status = normalizeAdminStatus(surface, state.status);
  if (status !== "all" && allowsStatus(status, options))
    next.set("status", status);
  if (
    allowsPeriod(options, true) &&
    Object.hasOwn(PERIOD_WINDOWS_MS, state.period)
  ) {
    next.set("period", state.period);
  }
  if (state.limit !== defaultLimit(options))
    next.set("limit", String(state.limit));
  if (state.offset > 0) next.set("offset", String(state.offset));
  if (surface !== undefined) {
    for (const [key, value] of adminFilterEntries(state.filters, surface)) {
      next.append(key, value);
    }
  }
  return next;
}

export function adminListQueryKey(state: AdminListQueryState): string {
  return JSON.stringify([
    state.search,
    state.status,
    state.period,
    state.limit,
    state.offset,
    adminFiltersKey(state.filters),
    state.filterError,
  ]);
}

export function adminFiltersKey(filters: AdminListFilters): string {
  return new URLSearchParams(adminFilterEntries(filters)).toString() || "||||";
}

export function hasAdminFilters(filters: AdminListFilters): boolean {
  return adminFilterEntries(filters).length > 0;
}
