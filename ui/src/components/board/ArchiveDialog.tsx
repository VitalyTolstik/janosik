import { useId, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { routes } from "@/routes";
import { useBoard, useBoardAccess } from "@/store/BoardContext";
import { LIMITS, type BoardAction, type Card } from "@janosik/shared";
import { createId } from "@/utils/id";
import { restoreTargetBlockReason } from "@/utils/workflow";

interface ArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 25;

function bulkAction(
  kind: "delete" | "restore",
  boardId: string,
  cardId: string,
  columnId?: string,
): BoardAction {
  const at = Date.now();
  return kind === "delete"
    ? { type: "DELETE_CARD", boardId, cardId, at }
    : {
        type: "UNARCHIVE_CARD",
        boardId,
        cardId,
        columnId,
        activityIds: [createId()],
        at,
      };
}

function subscribeToResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function archivePageSize() {
  const rowHeight = window.innerWidth < 640 ? 64 : 41;
  return Math.max(
    MIN_PAGE_SIZE,
    Math.min(MAX_PAGE_SIZE, Math.floor((window.innerHeight - 300) / rowHeight)),
  );
}

/**
 * Board card archive (TASK-18.1): search, restore to a picked column and
 * delete-forever for the active board's archived cards. Opened from the
 * data menu — a full dialog keeps the dropdown light even with hundreds
 * of archived cards.
 */
export function ArchiveDialog({ open, onOpenChange }: ArchiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] sm:max-w-5xl xl:max-w-6xl">
        {/* Search query and the inline delete confirm live inside
            `DialogContent`: Radix unmounts it on close, so every open starts
            clean without an `open` effect (AGENT.md: reset by remount). */}
        <ArchiveContent onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

interface ArchiveContentProps {
  onOpenChange: (open: boolean) => void;
}

function ArchiveContent({ onOpenChange }: ArchiveContentProps) {
  const { board, unarchiveCard, deleteCard, archiveBatch, startArchiveBatch } =
    useBoard();
  const { role } = useBoardAccess();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const navigate = useNavigate();
  const selectAllId = useId();
  const pageSize = useSyncExternalStore(
    subscribeToResize,
    archivePageSize,
    () => 10,
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  if (!board) return null;

  const busy = archiveBatch !== null;
  const currentBatch = archiveBatch?.boardId === board.id ? archiveBatch : null;
  const pendingIds = new Set(currentBatch?.cardIds ?? []);
  const archived = Object.values(board.cards)
    .filter(
      (card): card is Card =>
        card.archivedAt !== undefined && !pendingIds.has(card.id),
    )
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? archived.filter((card) => card.title.toLowerCase().includes(needle))
    : archived;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageCards = visible.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const selected = archived.filter((card) => selectedIds.has(card.id));
  const visibleIds = new Set(visible.map((card) => card.id));
  const hiddenSelectedCount = selected.filter(
    (card) => !visibleIds.has(card.id),
  ).length;
  const allVisibleSelected =
    visible.length > 0 && visible.every((card) => selectedIds.has(card.id));
  const canManage = role !== undefined && role !== "VIEWER";

  const runBulk = (kind: "delete" | "restore", columnId?: string) => {
    if (busy || selected.length === 0) return;
    const actions = selected.map((card) =>
      bulkAction(kind, board.id, card.id, columnId),
    );
    if (startArchiveBatch(board.id, actions)) {
      setSelectedIds(new Set());
    }
  };

  const openCard = (cardId: string) => {
    onOpenChange(false);
    navigate(`${routes.board(board.id)}?card=${cardId}`);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("archive.title")}</DialogTitle>
        <DialogDescription>
          {t("archive.subtitle", {
            board: board.title,
            count: archived.length,
          })}
        </DialogDescription>
      </DialogHeader>

      {archived.length > 0 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="archive-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={t("archive.searchPlaceholder")}
            data-testid="archive-search"
            className="h-8 pl-8 text-sm"
          />
        </div>
      ) : null}

      {canManage && (archived.length > 0 || busy) && (
        <div className="space-y-2" data-testid="archive-bulk-controls">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap px-2.5">
            <Checkbox
              id={selectAllId}
              checked={allVisibleSelected}
              className={
                allVisibleSelected ? undefined : "border-muted-foreground"
              }
              disabled={busy || visible.length === 0}
              aria-label={t("archive.selectVisible")}
              onCheckedChange={(checked) =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  for (const card of visible) {
                    if (checked) next.add(card.id);
                    else next.delete(card.id);
                  }
                  return next;
                })
              }
            />
            <label
              htmlFor={selectAllId}
              className="cursor-pointer text-xs text-foreground"
            >
              {t(needle ? "archive.selectMatching" : "archive.selectAll")}
            </label>
            <span className="text-xs text-muted-foreground">
              {t("archive.selected", { count: selected.length })}
            </span>
            {selected.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setSelectedIds(new Set())}
              >
                {t("archive.clearSelection")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || selected.length === 0}
                >
                  <ArchiveRestore className="h-4 w-4" />
                  {t("archive.restoreSelected")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{t("card.restoreTo")}</DropdownMenuLabel>
                {board.columns.map((column) => {
                  const reason =
                    selected
                      .map((card) =>
                        restoreTargetBlockReason(board, card, column, role, t),
                      )
                      .find((value) => value !== null) ??
                    (column.cardIds.length + selected.length >
                    Math.min(
                      column.wipLimit ?? LIMITS.cardsPerColumn,
                      LIMITS.cardsPerColumn,
                    )
                      ? t("archive.restoreCapacity")
                      : null);
                  return (
                    <DropdownMenuItem
                      key={column.id}
                      disabled={reason !== null}
                      title={reason ?? undefined}
                      onSelect={() => void runBulk("restore", column.id)}
                    >
                      <span className="truncate">{column.title}</span>
                      {column.wipLimit !== undefined && (
                        <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                          {column.cardIds.length}/{column.wipLimit}
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || selected.length === 0}
              onClick={() => setConfirmBulkDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t("archive.deleteSelected")}
            </Button>
          </div>
          {currentBatch && (
            <p role="status" className="px-2.5 text-xs text-muted-foreground">
              {t("archive.progress", {
                done: currentBatch.done,
                total: currentBatch.total,
              })}
            </p>
          )}
          {busy && !currentBatch && (
            <p role="status" className="px-2.5 text-xs text-muted-foreground">
              {t("archive.backgroundOtherBoard")}
            </p>
          )}
          {hiddenSelectedCount > 0 && !busy && (
            <p className="px-2.5 text-xs text-muted-foreground">
              {t("archive.hiddenSelected", { count: hiddenSelectedCount })}
            </p>
          )}
        </div>
      )}

      <div
        className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6"
        data-testid="archive-list"
      >
        {archived.length === 0 ? (
          <p className="flex h-full items-center justify-center py-8 text-center text-sm text-muted-foreground">
            {t(currentBatch ? "archive.backgroundEmpty" : "archive.empty")}
          </p>
        ) : visible.length === 0 ? (
          <p className="flex h-full items-center justify-center py-8 text-center text-sm text-muted-foreground">
            {t("archive.noMatches")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {pageCards.map((card) => {
              const confirming = confirmDeleteId === card.id;
              return (
                <li
                  key={card.id}
                  data-testid="archive-row"
                  className="flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-hover/60"
                >
                  {canManage && (
                    <Checkbox
                      checked={selectedIds.has(card.id)}
                      disabled={busy}
                      aria-label={t("archive.selectCard", {
                        title: card.title,
                      })}
                      onCheckedChange={(checked) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(card.id);
                          else next.delete(card.id);
                          return next;
                        })
                      }
                      className={
                        selectedIds.has(card.id)
                          ? undefined
                          : "border-muted-foreground"
                      }
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                    <button
                      type="button"
                      data-testid="archive-row-title"
                      onClick={() => openCard(card.id)}
                      disabled={busy}
                      className="min-w-0 flex-1 truncate text-left text-sm text-foreground/90 transition-colors hover:text-primary"
                      title={card.title}
                    >
                      {card.title}
                    </button>
                    <div className="shrink-0 text-[11px] text-muted-foreground sm:w-[22rem]">
                      {t("archive.created", {
                        date: formatDate(card.createdAt, lang, hour12),
                      })}
                      {" · "}
                      {t("archive.archivedAt", {
                        date: formatDate(card.archivedAt ?? 0, lang, hour12),
                      })}
                    </div>
                  </div>
                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <span className="text-xs text-muted-foreground">
                        {t("archive.deleteConfirm")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-success hover:text-success"
                        aria-label={t("archive.deleteConfirmYes")}
                        disabled={busy}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          deleteCard(card.id);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
                        aria-label={t("archive.deleteConfirmCancel")}
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            aria-label={t("card.unarchive")}
                            data-testid="archive-restore"
                            disabled={busy}
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>
                            {t("card.restoreTo")}
                          </DropdownMenuLabel>
                          {board.columns.map((column) => {
                            const reason = restoreTargetBlockReason(
                              board,
                              card,
                              column,
                              role,
                              t,
                            );
                            return (
                              <DropdownMenuItem
                                key={column.id}
                                disabled={reason !== null}
                                title={reason ?? undefined}
                                onSelect={() =>
                                  unarchiveCard(card.id, column.id)
                                }
                              >
                                <span className="truncate">{column.title}</span>
                                {column.wipLimit !== undefined && (
                                  <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                                    {column.cardIds.length}/{column.wipLimit}
                                  </span>
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        aria-label={t("archive.delete")}
                        data-testid="archive-delete"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(card.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {visible.length > pageSize && (
        <div
          className="flex items-center justify-between gap-3 border-t pt-3"
          data-testid="archive-pagination"
        >
          <span className="text-xs text-muted-foreground">
            {t("archive.page", { page: currentPage + 1, total: pageCount })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={t("archive.previousPage")}
              disabled={busy || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={t("archive.nextPage")}
              disabled={busy || currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={t("archive.bulkDeleteTitle")}
        description={t("archive.bulkDeleteDescription", {
          count: selected.length,
        })}
        confirmLabel={t("archive.deleteSelected")}
        destructive
        onConfirm={() => void runBulk("delete")}
      />
    </>
  );
}
