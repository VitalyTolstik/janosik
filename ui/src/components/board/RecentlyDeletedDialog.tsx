import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  FileText,
  Loader2,
  MessageSquare,
  RotateCcw,
  Rows3,
  StickyNote,
} from "lucide-react";
import type {
  DeletedBoardItemDto,
  DeletedBoardItemsDto,
  DeletedItemType,
} from "@janosik/shared";
import { ApiError, api } from "@/api/client";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, useHour12, useI18n, type MessageKey } from "@/i18n";

const TYPE_ORDER: DeletedItemType[] = [
  "cards",
  "columns",
  "comments",
  "attachments",
];

const TYPE_ICON = {
  cards: StickyNote,
  columns: Rows3,
  comments: MessageSquare,
  attachments: FileText,
} satisfies Record<DeletedItemType, typeof StickyNote>;

interface RecentlyDeletedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId?: string;
}

/**
 * TASK-177.7 — "Recently deleted" (G-15).
 *
 * The board's soft-deleted cards, columns, comments and files, newest first.
 * Restoring is available to board ADMIN/MEMBER while the operator retention
 * window is open; the server re-checks that window under the board lock, so a
 * stale dialog cannot resurrect a purged row. True purge remains the
 * maintenance sweep's job and is not exposed here.
 */
export function RecentlyDeletedDialog({
  open,
  onOpenChange,
  boardId,
}: RecentlyDeletedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] flex-col sm:max-w-2xl">
        {boardId === undefined ? null : (
          <RecentlyDeletedContent boardId={boardId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecentlyDeletedContent({ boardId }: { boardId: string }) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const aliveRef = useRef(true);
  const [data, setData] = useState<DeletedBoardItemsDto | null>(null);
  const [error, setError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.listDeleted(boardId);
      if (!aliveRef.current) return;
      setData(next);
      setError(false);
    } catch {
      if (aliveRef.current) setError(true);
    }
  }, [boardId]);

  const retry = () => {
    setError(false);
    void load();
  };

  useEffect(() => {
    aliveRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page lands after the await, not synchronously
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const restore = async (item: DeletedBoardItemDto) => {
    const key = `${item.type}:${item.id}`;
    setBusyKey(key);
    try {
      await api.restoreDeleted(boardId, item.type, item.id);
      if (!aliveRef.current) return;
      setData((current) =>
        current === null
          ? current
          : {
              ...current,
              items: current.items.filter(
                (row) => !(row.type === item.type && row.id === item.id),
              ),
            },
      );
      toast.success(t("deleted.restored"));
    } catch (cause) {
      if (!aliveRef.current) return;
      if (cause instanceof ApiError && cause.status === 410) {
        setData((current) =>
          current === null
            ? current
            : {
                ...current,
                items: current.items.filter(
                  (row) => !(row.type === item.type && row.id === item.id),
                ),
              },
        );
        toast.error(t("deleted.expired"));
      } else if (cause instanceof ApiError && cause.code === "column_deleted") {
        toast.error(t("deleted.restoreColumnFirst"));
      } else {
        toast.error(t("deleted.restoreError"));
      }
    } finally {
      if (aliveRef.current) setBusyKey(null);
    }
  };

  const sections = TYPE_ORDER.map((type) => ({
    type,
    items: (data?.items ?? []).filter((item) => item.type === type),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("deleted.title")}</DialogTitle>
        <DialogDescription>
          {data === null
            ? t("deleted.loading")
            : t("deleted.description", { days: data.retentionDays })}
        </DialogDescription>
      </DialogHeader>

      <div
        className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6"
        data-testid="deleted-list"
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("deleted.loadError")}
            </p>
            <Button variant="outline" className="max-lg:h-11" onClick={retry}>
              <RotateCcw className="h-4 w-4" />
              {t("deleted.retry")}
            </Button>
          </div>
        ) : data === null ? (
          <div className="space-y-3 py-2" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
              >
                <Skeleton width={32} height={32} />
                <div className="flex-1 space-y-2">
                  <Skeleton width="45%" height={12} />
                  <Skeleton width="30%" height={10} />
                </div>
              </div>
            ))}
          </div>
        ) : sections.length === 0 ? (
          <p className="flex h-full items-center justify-center py-10 text-center text-sm text-muted-foreground">
            {t("deleted.empty")}
          </p>
        ) : (
          <>
            {sections.map(({ type, items }) => {
              const Icon = TYPE_ICON[type];
              return (
                <section key={type} className="pb-2">
                  <h3 className="sticky top-0 z-10 flex items-center gap-1.5 bg-background/95 px-1 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {t(`deleted.type.${type}`)}
                    <span className="tabular-nums">· {items.length}</span>
                  </h3>
                  <ul className="divide-y divide-border/60">
                    {items.map((item) => {
                      const key = `${item.type}:${item.id}`;
                      const meta = rowMeta(item, t, lang, hour12);
                      return (
                        <li
                          key={key}
                          data-testid="deleted-row"
                          className="flex items-center gap-3 px-1.5 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm text-foreground/90"
                              title={item.title}
                            >
                              {item.title || t("deleted.untitled")}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {meta}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="max-lg:h-11 shrink-0"
                            data-testid="deleted-restore"
                            aria-label={t("deleted.restoreItem", {
                              title: item.title || t("deleted.untitled"),
                            })}
                            disabled={busyKey !== null}
                            onClick={() => void restore(item)}
                          >
                            {busyKey === key ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArchiveRestore className="h-3.5 w-3.5" />
                            )}
                            {t("deleted.restore")}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {data.truncated ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t("deleted.truncated")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function rowMeta(
  item: DeletedBoardItemDto,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  lang: string,
  hour12: boolean,
): string {
  const parts = [
    item.cardTitle !== undefined
      ? t("deleted.inCard", { title: item.cardTitle })
      : null,
    item.authorName ? t("deleted.byAuthor", { name: item.authorName }) : null,
    item.sizeBytes !== undefined ? formatSize(item.sizeBytes) : null,
    t("deleted.deletedAt", { date: formatDate(item.deletedAt, lang, hour12) }),
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
