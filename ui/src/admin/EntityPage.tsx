import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import type {
  AdminEntity,
  AdminEntityRowMap,
  AdminPage,
} from "@janosik/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminList } from "./use-admin-list";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  LoadingState,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * Generic entity listing (TASK-48): one table implementation for every
 * `GET /admin/entities/:entity` variant. A per-entity config supplies the
 * columns, the optional status filter, the row link (into the detail pages)
 * and the moderation actions; the page owns search, pagination, loading and
 * error states so support gets identical behaviour everywhere.
 */

export interface EntityAction {
  label: string;
  destructive?: boolean;
  /** Pure navigation actions do not toast. */
  noToast?: boolean;
  /** Optional confirmation dialog copy. */
  confirmTitle?: string;
  confirmBody?: string;
  run: () => Promise<unknown>;
  /**
   * A custom dialog host (TASK-51: the email-change form) instead of the
   * confirm flow. When present the menu item mounts this node; the action
   * closes itself via `close` and refreshes the list via `reload`. `run`
   * stays unused for such actions.
   */
  renderDialog?: (options: {
    close: () => void;
    reload: () => void;
  }) => ReactNode;
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
  rowTestId?: (row: T) => string;
  toolbar?: (reload: () => void) => ReactNode;
  actions?: (row: T, reload: () => void) => Array<EntityAction>;
  /** Rows without natural actions still align with the action column. */
  skipActions?: boolean;
  /** Enable bulk selection (delete / restore) for entities with `deletedAt`. */
  bulk?: boolean;
}

function RowActions({
  testId,
  actions,
  reload,
}: {
  testId: string;
  actions: Array<EntityAction>;
  reload: () => void;
}) {
  const t = useAdminT();
  const [pending, setPending] = useState<EntityAction | null>(null);
  const [dialog, setDialog] = useState<EntityAction | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const execute = async (action: EntityAction) => {
    setBusy(true);
    try {
      await action.run();
      if (!action.noToast) {
        toast.success(action.label);
        reload();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        toast.error(t("admin.common.forbidden"));
      } else if (error instanceof ApiError && error.status === 0) {
        toast.error(t("admin.common.offline"));
      } else {
        toast.error(t("admin.common.actionFailed"));
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("admin.common.actions")}
            data-testid={testId}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              className={
                action.destructive ? "text-danger focus:text-danger" : undefined
              }
              onSelect={() => {
                if (action.renderDialog) {
                  setDialog(action);
                } else if (action.confirmTitle) {
                  setPending(action);
                } else {
                  void execute(action);
                }
              }}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? (
        <ConfirmDialog
          open
          title={pending.confirmTitle ?? pending.label}
          body={pending.confirmBody ?? ""}
          confirmLabel={pending.label}
          destructive={pending.destructive ?? true}
          busy={busy}
          onConfirm={() => void execute(pending)}
          onClose={() => (busy ? undefined : setPending(null))}
        />
      ) : null}
      {dialog?.renderDialog
        ? dialog.renderDialog({ close: () => setDialog(null), reload })
        : null}
    </>
  );
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
  const bulkEnabled = config.bulk === true;
  const visibleIds = list.items
    .map((row) => rowId(row))
    .filter((id): id is string => id !== null);
  const allSelected =
    bulkEnabled &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selected.has(id));

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

  const runBulk = async (
    action: "delete" | "restore",
    label: string,
  ): Promise<void> => {
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    try {
      await adminApi.bulkEntity(config.entity, ids, action);
      toast.success(label);
      setSelected(new Set());
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        title={config.title}
        subtitle={config.subtitle?.replaceAll("{total}", String(list.total))}
        actions={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} />
            {statusOptions ? (
              <FilterTabs
                value={list.status}
                options={statusOptions}
                onChange={list.setStatus}
              />
            ) : null}
            {periodOptions ? (
              <FilterTabs
                value={list.period}
                options={periodOptions}
                onChange={list.setPeriod}
              />
            ) : null}
            {config.toolbar?.(list.reload)}
          </>
        }
      />
      <Panel className="flex min-h-0 flex-1 flex-col">
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState onRetry={list.reload} />
        ) : list.items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {bulkEnabled && selected.size > 0 ? (
              <div className="flex items-center gap-2 border-b border-divider px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {t("admin.bulk.selected", { count: selected.size })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive"
                  data-testid="admin-bulk-delete"
                  onClick={() => void runBulk("delete", t("admin.bulk.delete"))}
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
                        aria-label={t("admin.bulk.delete")}
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
                    <tr
                      key={rowHrefKey(row, index)}
                      data-testid={testId}
                      className={
                        href
                          ? "cursor-pointer transition-colors hover:bg-hover/50"
                          : undefined
                      }
                      onClick={href ? () => void navigate(href) : undefined}
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
                        <Td key={column.label} className={column.className}>
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
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              total={list.total}
              limit={list.limit}
              offset={list.offset}
              onChange={list.setOffset}
            />
          </>
        )}
      </Panel>
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
