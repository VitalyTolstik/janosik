import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AdminEntity,
  AdminEntityRowMap,
  AdminPage,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { RowActions, type EntityAction } from "./row-actions";
import { EntityListSkeleton } from "./skeletons";
import { useAdminList } from "./use-admin-list";
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
  const list = useAdminList<AdminEntityRowMap[E]>(
    (params) =>
      adminApi.listEntity(config.entity, params) as Promise<
        AdminPage<AdminEntityRowMap[E]>
      >,
  );
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const bulkEnabled = config.bulk === true;
  const visibleIds = list.items
    .map((row) => rowId(row))
    .filter((id): id is string => id !== null);
  const selectedOnPage = visibleIds.filter((id) => selected.has(id)).length;
  const allSelected =
    bulkEnabled &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selected.has(id));

  /**
   * The selection contract (TASK-176.1): it survives pagination but not a
   * result-set change. The bar's count, the confirmation and the request all
   * use the same saved set, so a filter must not leave hidden rows selected.
   */
  const withSelectionReset = (apply: () => void) => {
    setSelected(new Set());
    apply();
  };

  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
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
        setSelected(new Set(failed));
      } else {
        toast.success(label);
        setSelected(new Set());
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

  const filtered =
    list.search.trim() !== "" || list.status !== "all" || list.period !== "any";
  const clearFilters = () => {
    withSelectionReset(() => {
      list.setSearch("");
      list.setStatus("all");
      list.setPeriod("any");
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        title={config.title}
        subtitle={config.subtitle?.replaceAll("{total}", String(list.total))}
        actions={
          <>
            <SearchInput
              value={list.search}
              onChange={(value) =>
                withSelectionReset(() => list.setSearch(value))
              }
            />
            {statusOptions ? (
              <FilterTabs
                value={list.status}
                options={statusOptions}
                onChange={(value) =>
                  withSelectionReset(() => list.setStatus(value))
                }
              />
            ) : null}
            {periodOptions ? (
              <FilterTabs
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
        ) : list.error ? (
          <ErrorState
            onRetry={list.reload}
            reference={`${config.entity}:${new Date().toISOString().slice(0, 19)}`}
          />
        ) : list.items.length === 0 ? (
          <EmptyState filtered={filtered} onClear={clearFilters} />
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
                  onClick={() => setSelected(new Set())}
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
                  const href = config.rowHref?.(row);
                  const testId =
                    config.rowTestId?.(row) ??
                    `admin-row-${config.entity}-${index}`;
                  const id = rowId(row);
                  return (
                    <>
                      <tr
                        key={rowHrefKey(row, index)}
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
                        onClick={href ? () => void navigate(href) : undefined}
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
                    </>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              total={list.total}
              limit={list.limit}
              offset={list.offset}
              onChange={list.setOffset}
              onLimitChange={(value) =>
                withSelectionReset(() => list.setLimit(value))
              }
            />
          </>
        )}
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
