import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type {
  AdminEntity,
  AdminEntityRowMap,
  AdminPage,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import {
  ADMIN_LIST_FILTER_KEYS,
  EMPTY_ADMIN_LIST_FILTERS,
  adminFiltersKey,
  hasAdminFilters,
  listFilterError,
  readAdminListQuery,
  writeAdminListQuery,
  type AdminListFilterKey,
  type AdminListFilters,
  type AdminListQueryState,
} from "./admin-list-query";
import { currentAdminPath, withReturnTo } from "./admin-navigation";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { AdminFilterBar } from "./filters/AdminFilterBar";
import {
  BOARD_DEPENDENTS,
  FILTER_BAR_TITLES,
  filterLabel,
  removeListFilter,
  type FilterBarSurface,
  type FilterKey,
} from "./filters/filter-registry";
import { useListFilterOptions } from "./filters/use-list-filter-options";
import { RowActions, type EntityAction } from "./row-actions";
import { EntityListSkeleton } from "./skeletons";
import { useAdminListQuery } from "./use-admin-list-query";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  ForbiddenState,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Table,
  Td,
  Th,
} from "./ui";

export type { EntityAction } from "./row-actions";

/**
 * Generic entity listing (TASK-48): one table implementation for every
 * `GET /admin/entities/:entity` variant. A per-entity config supplies the
 * columns, the optional status filter, the row link (into the detail pages)
 * and the moderation actions; the page owns search, pagination, loading and
 * error states so support gets identical behaviour everywhere.
 */

/**
 * Backend `AdminBulkDto` caps one request at 500 ids. The UI keeps the same
 * number so a large cross-page selection fails with a readable message here
 * instead of a generic 400 from validation (TASK-176.1).
 */
const ADMIN_BULK_LIMIT = 500;

/** Stable empty set for a selection that belongs to an older result set. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

interface BulkSelection {
  /** Search/status/period/page-size/filter signature the ids belong to. */
  scope: string;
  ids: Set<string>;
}

export interface EntityColumn<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface EntityListConfig<T> {
  entity: AdminEntity;
  title: string;
  subtitle?: string;
  /** Optional server-side status filter tabs. */
  statuses?: Array<{ value: string; label: string }>;
  /** Show the createdAt age-window tabs (24h / 7d / 30d / any). */
  periods?: boolean;
  columns: Array<EntityColumn<T>>;
  /** Click target for a row — the entity's detail page when one exists. */
  rowHref?: (row: T) => string;
  filterTargetHref?: (filters: AdminListFilters, rows: T[]) => string | null;
  rowTestId?: (row: T) => string;
  toolbar?: (reload: () => void) => ReactNode;
  actions?: (row: T, reload: () => void) => Array<EntityAction>;
  /** Rows without natural actions still align with the action column. */
  skipActions?: boolean;
  /** Enable bulk selection (delete / restore) for entities with `deletedAt`. */
  bulk?: boolean;
}

export function EntityPage<E extends AdminEntity>({
  config,
}: {
  config: EntityListConfig<AdminEntityRowMap[E]>;
}) {
  const t = useAdminT();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = currentAdminPath(location);
  const { entity } = config;
  const filterSurface = Object.hasOwn(FILTER_BAR_TITLES, entity)
    ? (entity as FilterBarSurface)
    : undefined;
  const list = useAdminListQuery<AdminEntityRowMap[E]>(
    (params) =>
      adminApi.listEntity(config.entity, params) as Promise<
        AdminPage<AdminEntityRowMap[E]>
      >,
    {
      surface: filterSurface,
      statuses: config.statuses?.map((status) => status.value),
      periods: config.periods === true,
    },
  );
  const toast = useToast();
  const [bulkPending, setBulkPending] = useState(false);
  const bulkEnabled = config.bulk === true;

  /**
   * A result-set change invalidates the selection, including one that arrived
   * via the URL (browser back/forward, a shared link). The ids are tagged with
   * the scope they were picked in, so stale ids are ignored immediately
   * instead of being cleared by a racing effect; offset/reload keep the same
   * scope, exactly as the 176.1 contract says.
   */
  const selectionScopeKey = [
    list.effectiveSearch,
    list.status,
    list.period,
    list.limit,
    adminFiltersKey(list.filters),
  ].join("|");
  const [selection, setSelection] = useState<BulkSelection>(() => ({
    scope: selectionScopeKey,
    ids: new Set(),
  }));
  if (selection.scope !== selectionScopeKey) {
    setSelection({ scope: selectionScopeKey, ids: new Set() });
  }
  const selected =
    selection.scope === selectionScopeKey ? selection.ids : EMPTY_SELECTION;
  const visibleIds = list.items
    .map((row) => rowId(row))
    .filter((id): id is string => id !== null);
  const selectedOnPage = visibleIds.filter((id) => selected.has(id)).length;
  const allSelected =
    bulkEnabled &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selected.has(id));

  /** Apply a change to the ids of the current scope only. */
  const updateSelection = (update: (current: Set<string>) => Set<string>) => {
    setSelection((current) => {
      const base =
        current.scope === selectionScopeKey ? current.ids : EMPTY_SELECTION;
      return {
        scope: selectionScopeKey,
        ids: update(new Set(base)),
      };
    });
  };

  const clearSelection = () => {
    setSelection({ scope: selectionScopeKey, ids: new Set() });
  };

  /**
   * The selection contract (TASK-176.1): it survives pagination but not a
   * result-set change. The bar's count, the confirmation and the request all
   * use the same saved set, so a filter must not leave hidden rows selected.
   */
  const withSelectionReset = (apply: () => void) => {
    clearSelection();
    apply();
  };

  const toggleRow = (id: string) => {
    updateSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    updateSelection((current) => {
      if (allSelected) {
        const next = new Set(current);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...current, ...visibleIds]);
    });
  };

  const bulkTooLarge = (): boolean => {
    if (selected.size <= ADMIN_BULK_LIMIT) return false;
    toast.error(
      t("admin.bulk.tooMany", {
        count: selected.size,
        limit: ADMIN_BULK_LIMIT,
      }),
    );
    return true;
  };

  const openBulkDelete = () => {
    if (bulkTooLarge()) return;
    setBulkPending(true);
  };

  const runBulk = async (
    action: "delete" | "restore",
    label: string,
  ): Promise<void> => {
    setBulkPending(false);
    // The panel, the dialog and the body all count the same saved ids. Sending
    // only `visibleIds` made "2 selected" delete one row (TASK-176.1).
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (bulkTooLarge()) return;
    try {
      const result = await adminApi.bulkEntity(config.entity, ids, action);
      const sent = new Set(ids);
      // Keep only ids the server actually refused, and only ones that were
      // part of this request (TASK-156 review).
      const failed = (result.failed ?? []).filter((id) => sent.has(id));
      if (failed.length > 0) {
        toast.error(t("admin.bulk.partial", { count: failed.length }));
        setSelection({ scope: selectionScopeKey, ids: new Set(failed) });
      } else {
        toast.success(label);
        clearSelection();
      }
      list.reload();
    } catch {
      toast.error(t("admin.common.actionFailed"));
    }
  };

  const statusOptions =
    config.statuses === undefined
      ? undefined
      : [
          { value: "all", label: t("admin.filter.all") },
          ...config.statuses.map((status) => ({
            value: status.value,
            label: status.label,
          })),
        ];

  const periodOptions = config.periods
    ? [
        { value: "any", label: t("admin.filter.period.any") },
        { value: "24h", label: t("admin.filter.period.24h") },
        { value: "7d", label: t("admin.filter.period.7d") },
        { value: "30d", label: t("admin.filter.period.30d") },
      ]
    : undefined;

  const filterLabelKeys: Record<AdminListFilterKey, AdminMessageKey> = {
    boardId: "admin.filter.board",
    columnId: "admin.filter.column",
    labelId: "admin.filter.label",
    cardId: "admin.filter.card",
    commandId: "admin.filter.commandId",
  };
  const activeFilters = ADMIN_LIST_FILTER_KEYS.filter(
    (key) => list.filters[key] !== null,
  );

  const filtered =
    (filterSurface ? list.effectiveSearch : list.search).trim() !== "" ||
    list.status !== "all" ||
    list.period !== "any" ||
    hasAdminFilters(list.filters);
  const resolvedFilters = useListFilterOptions(
    filterSurface ? list.filters : undefined,
    filterSurface,
  );
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterChipRowRef = useRef<HTMLDivElement>(null);
  const lookupPending = resolvedFilters.some(({ loading }) => loading);
  const lookupFailed = resolvedFilters.some(({ error }) => error);
  const rejectedFilter = filterSurface
    ? unsupportedFilter(list.errorBody)
    : undefined;
  const rejectedLabel =
    rejectedFilter &&
    filterSurface &&
    filterLabel(rejectedFilter, filterSurface);
  const rejectedName = rejectedLabel ? t(rejectedLabel) : rejectedFilter;

  const pendingFilterView = useRef<{
    query: string;
    state: AdminListQueryState;
  }>();
  useLayoutEffect(() => {
    pendingFilterView.current = undefined;
  }, [location.key]);

  const currentFilterView = () =>
    pendingFilterView.current?.state ??
    readAdminListQuery(new URLSearchParams(location.search), {
      surface: filterSurface,
    });

  const commitFilterView = (next: AdminListQueryState) => {
    const current = new URLSearchParams(location.search);
    const query = writeAdminListQuery(current, next, {
      surface: filterSurface,
    }).toString();
    if (query === (pendingFilterView.current?.query ?? current.toString())) {
      list.applyState(next);
    } else {
      // A second chip action can run before the router renders the first.
      pendingFilterView.current = { query, state: next };
      void navigate({ search: query, hash: location.hash });
    }
  };

  const changeFilters = (
    patch: Partial<AdminListFilters>,
    view = currentFilterView(),
  ) => {
    const filters = { ...view.filters, ...patch };
    const cleared =
      filterSurface !== "commands" && filters.boardId !== view.filters.boardId
        ? BOARD_DEPENDENTS.filter((dependent) => filters[dependent] !== null)
        : [];
    for (const dependent of cleared) filters[dependent] = null;
    if (filters.labelId === null) delete filters.labelMatch;
    if (adminFiltersKey(view.filters) === adminFiltersKey(filters)) return;
    if (listFilterError(filters, filterSurface)) {
      toast.error(t("admin.filters.limit"));
      return;
    }
    withSelectionReset(() => {
      commitFilterView({
        ...view,
        search: list.search,
        offset: 0,
        filters,
        filterError: undefined,
      });
      const clearedMode =
        cleared.includes("labelId") && view.filters.labelMatch === "all";
      const count = cleared.length + Number(clearedMode);
      if (count > 0) {
        toast.info(t("admin.filters.boardCleared", { count }));
      }
    });
  };

  const removeFilter = (key: FilterKey, value?: string) => {
    const view = currentFilterView();
    const patch = removeListFilter(view.filters, key, value);
    const buttons = Array.from(
      filterChipRowRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-filter-key]",
      ) ?? [],
    );
    const removes = (button: HTMLButtonElement) =>
      button.dataset.filterKey === key &&
      (value === undefined || button.dataset.filterValue === value);
    const index = buttons.findIndex(removes);
    const removedKeys: readonly string[] =
      key === "boardId" && filterSurface !== "commands"
        ? [...BOARD_DEPENDENTS, "labelMatch"]
        : key === "labelId" && patch.labelMatch === undefined
          ? ["labelMatch"]
          : [];
    const neighbor =
      index >= 0
        ? [
            ...buttons.slice(index + 1),
            ...buttons.slice(0, index).reverse(),
          ].find(
            (button) =>
              !removes(button) &&
              !removedKeys.includes(button.dataset.filterKey ?? ""),
          )
        : undefined;
    (neighbor ?? filterTriggerRef.current)?.focus();
    changeFilters(patch, view);
  };

  const clearAllFilters = () => {
    withSelectionReset(() => {
      if (filterSurface) {
        filterTriggerRef.current?.focus();
        commitFilterView({
          search: "",
          status: "all",
          period: "any",
          limit: list.limit,
          offset: 0,
          filters: EMPTY_ADMIN_LIST_FILTERS,
        });
        return;
      }
      list.setSearch("");
      list.setStatus("all");
      list.setPeriod("any");
      list.clearFilters();
    });
  };

  const tabsClassName =
    "admin-tab-strip max-w-full max-sm:h-auto max-sm:overflow-x-auto max-sm:[&_button]:h-11 max-sm:[&_button]:shrink-0";
  const renderHeader = (filterTrigger?: ReactNode) => (
    <PageHeader
      title={config.title}
      subtitle={config.subtitle?.replaceAll("{total}", String(list.total))}
      actionsClassName="max-w-full max-sm:w-full"
      actions={
        <>
          <SearchInput
            value={list.search}
            className={
              filterSurface
                ? "max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-40"
                : "max-sm:w-full"
            }
            onChange={(value) =>
              withSelectionReset(() => list.setSearch(value))
            }
          />
          {filterTrigger}
          {statusOptions ? (
            <FilterTabs
              className={tabsClassName}
              value={list.status}
              options={statusOptions}
              onChange={(value) =>
                withSelectionReset(() => list.setStatus(value))
              }
            />
          ) : null}
          {periodOptions ? (
            <FilterTabs
              className={tabsClassName}
              value={list.period}
              options={periodOptions}
              onChange={(value) =>
                withSelectionReset(() => list.setPeriod(value))
              }
            />
          ) : null}
          {config.toolbar?.(list.reload)}
        </>
      }
    />
  );
  const pagination = (
    <Pagination
      total={list.total}
      limit={list.limit}
      offset={list.offset}
      onChange={list.setOffset}
      onLimitChange={(limit) => withSelectionReset(() => list.setLimit(limit))}
    />
  );
  const clearAction = (
    <Button
      variant="outline"
      size="sm"
      className="h-11 sm:h-8"
      onClick={clearAllFilters}
    >
      {t("admin.filters.clearAll")}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      {filterSurface ? (
        <AdminFilterBar
          renderHeader={renderHeader}
          surface={filterSurface}
          triggerRef={filterTriggerRef}
          chipRowRef={filterChipRowRef}
          filters={list.filters}
          targetHref={config.filterTargetHref?.(list.filters, list.items)}
          resolved={resolvedFilters}
          filtered={filtered}
          canClear={
            filtered ||
            list.search.trim() !== "" ||
            list.filterError !== undefined
          }
          total={
            list.loading || list.refreshing || list.error
              ? undefined
              : list.total
          }
          onChange={changeFilters}
          onRemove={removeFilter}
          onClear={clearAllFilters}
        />
      ) : (
        renderHeader()
      )}
      {!filterSurface && activeFilters.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="admin-filter-banner"
        >
          {activeFilters.map((key) => (
            <span
              key={key}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-hover/40 px-2 text-[11px] text-muted-foreground"
              data-testid={`admin-filter-${key}`}
            >
              <span>{t(filterLabelKeys[key])}</span>
              <span className="max-w-[12rem] truncate font-mono text-foreground">
                {list.filters[key]}
              </span>
              <button
                type="button"
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("admin.filter.clearOne", {
                  filter: t(filterLabelKeys[key]),
                })}
                data-testid={`admin-filter-clear-${key}`}
                onClick={() =>
                  withSelectionReset(() => list.setFilter(key, null))
                }
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            data-testid="admin-filter-clear"
            onClick={clearAllFilters}
          >
            {t("admin.common.clearFilters")}
          </Button>
        </div>
      ) : null}
      <Panel
        className="flex min-h-0 flex-1 flex-col"
        data-testid="admin-entity-panel"
        aria-busy={list.loading || list.refreshing}
      >
        {list.loading ? (
          <EntityListSkeleton
            columns={
              config.columns.length +
              (config.actions || !config.skipActions ? 1 : 0)
            }
            bulk={bulkEnabled}
            testId={`admin-${config.entity}-skeleton`}
          />
        ) : list.errorStatus === 403 ? (
          <ForbiddenState onBack={() => navigate("/admin")} />
        ) : rejectedFilter && rejectedName ? (
          <EmptyState
            announce
            message={t("admin.filters.unsupported", { facet: rejectedName })}
            action={
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => {
                  if (rejectedLabel) {
                    removeFilter(rejectedFilter as FilterKey);
                    return;
                  }
                  filterTriggerRef.current?.focus();
                  const query = new URLSearchParams(location.search);
                  if (query.has(rejectedFilter)) {
                    query.delete(rejectedFilter);
                    void navigate({
                      search: query.toString(),
                      hash: location.hash,
                    });
                  }
                  // The unsupported key may already have been dropped by URL canonicalization.
                  list.reload();
                }}
              >
                {t("admin.filters.removeUnsupported", { facet: rejectedName })}
              </Button>
            }
          />
        ) : filterSurface && list.filterError !== undefined ? (
          <EmptyState
            announce
            message={t("admin.filters.invalid")}
            action={clearAction}
          />
        ) : list.error ? (
          <ErrorState
            onRetry={list.reload}
            reference={`${config.entity}:${new Date().toISOString().slice(0, 19)}`}
          />
        ) : list.items.length === 0 ? (
          filterSurface ? (
            !list.refreshing && !lookupFailed && !lookupPending ? (
              <EmptyState
                message={
                  list.total > 0
                    ? t(
                        filterSurface === "cards"
                          ? "admin.filters.emptyPage"
                          : "admin.filters.emptyPage.moderation",
                      )
                    : filtered
                      ? t(
                          filterSurface === "comments" ||
                            filterSurface === "attachments"
                            ? `admin.filters.noMatches.${filterSurface}`
                            : filterSurface === "cards"
                              ? "admin.filters.noMatches"
                              : "admin.common.emptyFiltered",
                        )
                      : undefined
                }
                action={filtered ? clearAction : undefined}
              />
            ) : null
          ) : (
            <EmptyState filtered={filtered} onClear={clearAllFilters} />
          )
        ) : (
          <>
            {bulkEnabled && selected.size > 0 ? (
              <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-card/95 px-3 py-2 text-xs backdrop-blur">
                <span className="text-muted-foreground">
                  {t("admin.bulk.selected", {
                    count: selected.size,
                    visible: selectedOnPage,
                  })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive"
                  data-testid="admin-bulk-delete"
                  onClick={openBulkDelete}
                >
                  {t("admin.bulk.delete")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  data-testid="admin-bulk-restore"
                  onClick={() =>
                    void runBulk("restore", t("admin.bulk.restore"))
                  }
                >
                  {t("admin.bulk.restore")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2 text-xs"
                  onClick={() => clearSelection()}
                >
                  {t("admin.bulk.clear")}
                </Button>
              </div>
            ) : null}
            <Table>
              <thead>
                <tr>
                  {bulkEnabled ? (
                    <Th className="w-8">
                      <Checkbox
                        aria-label={t("admin.common.selectAll")}
                        data-testid="admin-select-all"
                        checked={allSelected}
                        disabled={filterSurface && list.refreshing}
                        onCheckedChange={toggleAll}
                      />
                    </Th>
                  ) : null}
                  {config.columns.map((column) => (
                    <Th key={column.label} className={column.className}>
                      {column.label}
                    </Th>
                  ))}
                  {config.actions || !config.skipActions ? (
                    <Th className="w-10 text-right">
                      <span className="sr-only">
                        {t("admin.common.actions")}
                      </span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.items.map((row, index) => {
                  const plannedHref = config.rowHref?.(row);
                  const href =
                    plannedHref === undefined
                      ? undefined
                      : withReturnTo(plannedHref, returnTo);
                  const testId =
                    config.rowTestId?.(row) ??
                    `admin-row-${config.entity}-${index}`;
                  const id = rowId(row);
                  return (
                    <Fragment key={rowHrefKey(row, index)}>
                      <tr
                        data-testid={testId}
                        data-clickable={href ? "true" : undefined}
                        data-selected={
                          id !== null && selected.has(id) ? "true" : undefined
                        }
                        tabIndex={href ? 0 : undefined}
                        className={
                          href
                            ? "cursor-pointer transition-colors hover:bg-hover/50"
                            : undefined
                        }
                        onClick={
                          href
                            ? (event) => {
                                // A cell can be its own link (board, card,
                                // identity) or button. The row must not steal
                                // that click and navigate to the row target
                                // (TASK-176.5 review, 176.6 column links).
                                const target = event.target;
                                if (
                                  target instanceof Element &&
                                  target.closest(
                                    "a,button,input,select,textarea,label,[role='button']",
                                  ) !== null
                                ) {
                                  return;
                                }
                                void navigate(href);
                              }
                            : undefined
                        }
                        onKeyDown={
                          href
                            ? (event) => {
                                if (event.target !== event.currentTarget)
                                  return;
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void navigate(href);
                                } else if (
                                  event.key === " " &&
                                  bulkEnabled &&
                                  !(filterSurface && list.refreshing) &&
                                  id !== null
                                ) {
                                  event.preventDefault();
                                  toggleRow(id);
                                }
                              }
                            : undefined
                        }
                      >
                        {bulkEnabled && id !== null ? (
                          <Td className="w-8">
                            <span onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                aria-label={id}
                                data-testid={`admin-select-${id}`}
                                checked={selected.has(id)}
                                disabled={filterSurface && list.refreshing}
                                onCheckedChange={() => toggleRow(id)}
                              />
                            </span>
                          </Td>
                        ) : bulkEnabled ? (
                          <Td className="w-8" />
                        ) : null}
                        {config.columns.map((column) => (
                          <Td
                            key={column.label}
                            label={column.label}
                            className={column.className}
                          >
                            {column.render(row)}
                          </Td>
                        ))}
                        {config.actions || !config.skipActions ? (
                          <Td className="text-right">
                            {config.actions ? (
                              <div
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                <RowActions
                                  testId={`admin-row-actions-${rowHrefKey(row, index).replaceAll(":", "-")}`}
                                  actions={config.actions(row, list.reload)}
                                  reload={list.reload}
                                />
                              </div>
                            ) : null}
                          </Td>
                        ) : null}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
        {!list.loading &&
        !list.error &&
        (list.items.length > 0 || list.total > 0)
          ? pagination
          : null}
      </Panel>
      {bulkPending ? (
        <ConfirmDialog
          open
          title={t("admin.bulk.confirm.title", { count: selected.size })}
          body={t("admin.bulk.confirm.body")}
          confirmLabel={t("admin.bulk.delete")}
          destructive
          onConfirm={() => void runBulk("delete", t("admin.bulk.delete"))}
          onClose={() => setBulkPending(false)}
        />
      ) : null}
    </div>
  );
}

function unsupportedFilter(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    body.code === "unsupported_filter" &&
    "filter" in body &&
    typeof body.filter === "string"
  ) {
    return body.filter;
  }
}

function rowHrefKey(row: unknown, index: number): string {
  const composite = row as {
    id?: string;
    cardId?: string;
    labelId?: string;
  };
  if (composite.id) return composite.id;
  if (composite.cardId && composite.labelId) {
    return `${composite.cardId}:${composite.labelId}`;
  }
  return String(index);
}

/** Stable id for bulk selection (composite rows opt out — no id). */
function rowId(row: unknown): string | null {
  const candidate = row as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : null;
}
