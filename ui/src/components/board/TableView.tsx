import {
  AlignLeft,
  Archive,
  Check,
  ListChecks,
  MessageSquare,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { DueBadge } from "@/components/board/DueBadge";
import { ComposerLabelPicker } from "@/components/board/ComposerLabelPicker";
import { LabelPicker } from "@/components/board/LabelPicker";
import { DueDatePickerContent } from "@/components/board/CardDueDate";
import { HighlightedText } from "@/components/ui/highlight";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/auth/AuthContext";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";
import { useCardLabels } from "@/hooks/use-card-labels";
import { useBoardMember, useEntityAttribution } from "@/store/board-live";
import { userAvatarVar, userLabel } from "@/utils/avatar";
import { isColumnFull } from "@janosik/shared";
import { cn } from "@/lib/utils";
import { createId } from "@/utils/id";
import { useBoard } from "@/store/BoardContext";
import {
  LABEL_COLOR_CHIP,
  type Card,
  type Column,
  type Label,
  type LabelColor,
  LIMITS,
} from "@janosik/shared";

/** Stable empty list, so the label resolver survives a board-less render. */
const NO_LABELS: Label[] = [];

function checklistProgress(card: Card) {
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  return { done: items.filter((i) => i.done).length, total: items.length };
}

interface TableViewProps {
  /** Per-column card ids with a filter applied — overrides the stored
   *  order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** True while a board filter is active (chooses the empty-state text). */
  isFiltering?: boolean;
  /** Search query highlighted inside titles. */
  highlight?: string;
  /** Fired on a row click — opens the card detail dialog. */
  onCardClick: (cardId: string) => void;
  /** VIEWER mode (TASK-35): inline editors and destructive actions off. */
  readOnly?: boolean;
}

/** Sortable headers (TASK-14.1 item 7). */
type SortKey = "title" | "column" | "due" | "createdAt";

interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

/** Optional columns beyond the four base ones (TASK-14.1 item 11). */
const OPTIONAL_COLUMNS = [
  "checklists",
  "description",
  "createdAt",
  "updatedAt",
  "activity",
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const COLUMNS_STORAGE_KEY = "janosik-table-columns";

function readStoredColumns(): OptionalColumn[] {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((c): c is OptionalColumn =>
          (OPTIONAL_COLUMNS as readonly string[]).includes(c as string),
        );
      }
    }
  } catch {
    /* storage unavailable — the defaults apply */
  }
  return [];
}

/**
 * Table view (TASK-14.1) — a working surface, not just a projection:
 * sortable headers (asc → desc → board order), inline editing of the
 * due date / column / labels / title through the same undoable actions
 * the board uses (WIP limits respected, with the drag toast), a "+ card"
 * composer and show/hide column settings. The active filter applies
 * exactly as on the board.
 */
export function TableView({
  filteredCardIds,
  isFiltering = false,
  highlight,
  onCardClick,
  readOnly = false,
}: TableViewProps) {
  const {
    board,
    addCard,
    updateCard,
    moveCard,
    archiveCard,
    toggleCardLabel,
    addLabel,
    renameLabel,
    setLabelColor,
    deleteLabel,
  } = useBoard();
  const { t, lang } = useI18n();
  const toast = useToast();
  const labelsOf = useCardLabels(board?.labels ?? NO_LABELS);

  const [sort, setSort] = useState<SortState | null>(null);
  const [visibleColumns, setVisibleColumns] =
    useState<OptionalColumn[]>(readStoredColumns);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  // Row archive uses the same two-step confirm as the board card (✓ / ✗).
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  // The "+ card" popover is controlled so the composer's Cancel can close it.
  const [addOpen, setAddOpen] = useState(false);

  // The row callbacks must keep their identity, otherwise `memo` on
  // TableRow never holds (TASK-21.4.1) — so they read the current board
  // from a ref instead of closing over it.
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const submitTitleEdit = useCallback(
    (cardId: string, title: string) => {
      const trimmed = title.trim();
      setEditingTitleId(null);
      if (trimmed && trimmed !== boardRef.current?.cards[cardId]?.title) {
        updateCard(cardId, { title: trimmed });
      }
    },
    [updateCard],
  );

  const cancelTitleEdit = useCallback(() => setEditingTitleId(null), []);

  const handleCreateLabel = useCallback(
    (cardId: string, name: string, color: LabelColor) => {
      const label = { id: createId(), name, color };
      addLabel(label);
      toggleCardLabel(cardId, label.id);
    },
    [addLabel, toggleCardLabel],
  );

  const moveToColumn = useCallback(
    (cardId: string, fromColumnId: string, toColumnId: string) => {
      if (toColumnId === fromColumnId) return;
      const target = boardRef.current?.columns.find(
        (col) => col.id === toColumnId,
      );
      if (!target) return;
      // Both limits respected on inline moves — same toasts as board drag.
      if (isColumnFull(target)) {
        toast.error(
          target.wipLimit !== undefined &&
            target.cardIds.length >= target.wipLimit
            ? t("toast.wipLimitBlocked", {
                title: target.title,
                limit: target.wipLimit,
              })
            : t("limits.maxItems", { limit: LIMITS.cardsPerColumn }),
        );
        return;
      }
      moveCard(cardId, fromColumnId, toColumnId, target.cardIds.length);
    },
    [moveCard, t, toast],
  );

  // Persist the column choice next to the view/scale choices.
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      /* storage unavailable — the choice only lasts the session */
    }
  }, [visibleColumns]);

  if (!board) return null;

  const rows = board.columns.flatMap((column) => {
    const ids = filteredCardIds?.[column.id] ?? column.cardIds;
    return ids
      .map((id) => board.cards[id])
      .filter((card) => card !== undefined)
      .map((card) => ({ card, column }));
  });

  // Sort a copy — the stored board order is never touched (visual only).
  const sortedRows = (() => {
    if (!sort) return rows;
    const columnIndex = new Map(
      board.columns.map((col, index) => [col.id, index]),
    );
    // `dir` multiplies only the numeric comparison of each key. The
    // due-date null handling lives outside it, so undated cards stay last
    // in BOTH sort directions (the reducer's sortColumn semantics).
    const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      switch (sort.key) {
        case "title":
          return (
            a.card.title.localeCompare(b.card.title, lang, {
              sensitivity: "base",
            }) * sort.dir
          );
        case "column":
          return (
            ((columnIndex.get(a.column.id) ?? 0) -
              (columnIndex.get(b.column.id) ?? 0)) *
            sort.dir
          );
        case "due": {
          const aDue =
            typeof a.card.dueDate === "number" ? a.card.dueDate : null;
          const bDue =
            typeof b.card.dueDate === "number" ? b.card.dueDate : null;
          if (aDue === null && bDue === null) return 0;
          if (aDue === null) return 1;
          if (bDue === null) return -1;
          return (aDue - bDue) * sort.dir;
        }
        case "createdAt":
          return (a.card.createdAt - b.card.createdAt) * sort.dir;
      }
    };
    return [...rows].sort(cmp);
  })();

  const cycleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null; // third click resets to the board order
    });
  };

  const optionalCount = visibleColumns.length;

  // The toolbar "+ Add card" is dead weight when every column is full —
  // the popover would only show disabled choices.
  const anyColumnWithRoom = board.columns.some((col) => !isColumnFull(col));

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      {/* Toolbar: + card composer and the column settings (TASK-14.1 item 10/11). */}
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        {readOnly ? null : (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 border-dashed border-primary/40 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/20 hover:text-primary"
                data-testid="table-add-card"
                disabled={!anyColumnWithRoom}
                title={anyColumnWithRoom ? undefined : t("limits.columnsFull")}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("composer.add")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <TableCardComposer
                columns={board.columns.map((col) => ({
                  id: col.id,
                  title: col.title,
                  full: isColumnFull(col),
                  count: col.cardIds.length,
                  wipLimit: col.wipLimit,
                }))}
                labels={board.labels}
                onSubmit={(columnId, title, labelIds) =>
                  addCard(columnId, title, labelIds)
                }
                onCancel={() => setAddOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-xs"
              aria-label={t("view.table.columnsSettings")}
              data-testid="table-columns-settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t("view.table.columnsSettings")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("view.table.columnsSettings")}
            </DropdownMenuLabel>
            {OPTIONAL_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={visibleColumns.includes(column)}
                onCheckedChange={() =>
                  setVisibleColumns((prev) =>
                    prev.includes(column)
                      ? prev.filter((c) => c !== column)
                      : [...prev, column],
                  )
                }
                onSelect={(event) => event.preventDefault()}
              >
                {t(`view.table.${column}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60">
              <SortHeader
                label={t("view.table.title")}
                sortKey="title"
                sort={sort}
                onCycle={cycleSort}
              />
              <SortHeader
                label={t("view.table.column")}
                sortKey="column"
                sort={sort}
                onCycle={cycleSort}
                className="w-40"
              />
              <SortHeader
                label={t("dueDate.label")}
                sortKey="due"
                sort={sort}
                onCycle={cycleSort}
                className="w-48"
              />
              <th
                scope="col"
                className="w-44 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("view.table.labels")}
              </th>
              {visibleColumns.includes("checklists") ? (
                <th
                  scope="col"
                  className="w-24 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("view.table.checklists")}
                </th>
              ) : null}
              {visibleColumns.includes("description") ? (
                <th
                  scope="col"
                  className="w-16 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("view.table.description")}
                </th>
              ) : null}
              {visibleColumns.includes("createdAt") ? (
                <SortHeader
                  label={t("view.table.createdAt")}
                  sortKey="createdAt"
                  sort={sort}
                  onCycle={cycleSort}
                  className="w-28"
                />
              ) : null}
              {visibleColumns.includes("updatedAt") ? (
                <th
                  scope="col"
                  className="w-28 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("view.table.updatedAt")}
                </th>
              ) : null}
              {visibleColumns.includes("activity") ? (
                <th
                  scope="col"
                  className="w-20 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("view.table.activity")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={4 + optionalCount}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {isFiltering ? t("filter.noMatch") : t("view.table.empty")}
                </td>
              </tr>
            ) : (
              sortedRows.map(({ card, column }) => (
                <TableRow
                  key={card.id}
                  card={card}
                  cardLabels={labelsOf(card.labelIds)}
                  columnId={column.id}
                  columnTitle={column.title}
                  columns={board.columns}
                  labels={board.labels}
                  visibleColumns={visibleColumns}
                  highlight={highlight}
                  readOnly={readOnly}
                  isEditingTitle={editingTitleId === card.id}
                  isArchiveConfirm={archiveConfirmId === card.id}
                  onOpen={onCardClick}
                  onStartTitleEdit={setEditingTitleId}
                  onSubmitTitle={submitTitleEdit}
                  onCancelTitle={cancelTitleEdit}
                  onArchiveConfirm={setArchiveConfirmId}
                  onArchive={archiveCard}
                  onMoveToColumn={moveToColumn}
                  onToggleLabel={toggleCardLabel}
                  onCreateLabel={handleCreateLabel}
                  onRenameLabel={renameLabel}
                  onRecolorLabel={setLabelColor}
                  onDeleteLabel={deleteLabel}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TableRowProps {
  card: Card;
  /** Resolved labels of this card (stable — see `useCardLabels`). */
  cardLabels: Label[];
  columnId: string;
  columnTitle: string;
  /** Every column, for the "move to" menu. */
  columns: Column[];
  /** Every board label, for the picker. */
  labels: Label[];
  visibleColumns: OptionalColumn[];
  highlight?: string;
  /** VIEWER mode (TASK-35): no inline editors, no archive, no move menu. */
  readOnly?: boolean;
  isEditingTitle: boolean;
  isArchiveConfirm: boolean;
  onOpen: (cardId: string) => void;
  onStartTitleEdit: (cardId: string) => void;
  /** Commits the inline editor's own (uncontrolled) value. */
  onSubmitTitle: (cardId: string, title: string) => void;
  onCancelTitle: () => void;
  onArchiveConfirm: (cardId: string | null) => void;
  onArchive: (cardId: string) => void;
  onMoveToColumn: (
    cardId: string,
    fromColumnId: string,
    toColumnId: string,
  ) => void;
  onToggleLabel: (cardId: string, labelId: string) => void;
  onCreateLabel: (cardId: string, name: string, color: LabelColor) => void;
  onRenameLabel: (labelId: string, name: string) => void;
  onRecolorLabel: (labelId: string, color: LabelColor) => void;
  onDeleteLabel: (labelId: string) => void;
}

function TableRowBody({
  card,
  cardLabels,
  columnId,
  columnTitle,
  columns,
  labels,
  visibleColumns,
  highlight,
  readOnly = false,
  isEditingTitle,
  isArchiveConfirm,
  onOpen,
  onStartTitleEdit,
  onSubmitTitle,
  onCancelTitle,
  onArchiveConfirm,
  onArchive,
  onMoveToColumn,
  onToggleLabel,
  onCreateLabel,
  onRenameLabel,
  onRecolorLabel,
  onDeleteLabel,
}: TableRowProps) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  // Attribution (TASK-36): who last changed the row, plus the transient
  // foreign highlight — the same ring semantics as the card face.
  const attribution = useEntityAttribution(card.id);
  const authorMember = useBoardMember(
    attribution?.boardId,
    attribution?.userId,
  );
  const foreignAuthor =
    attribution !== undefined && attribution.userId !== user?.id
      ? attribution
      : undefined;
  const foreignColor = userAvatarVar(attribution?.userId ?? "");
  const authorName = userLabel(
    authorMember?.displayName ?? null,
    authorMember?.email ?? "",
  );
  return (
    <tr
      onClick={() => onOpen(card.id)}
      data-testid="table-row"
      className={cn(
        "cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/40",
        attribution?.highlight === true && "janosik-foreign-row",
      )}
      style={
        attribution?.highlight === true
          ? ({ "--janosik-foreign-color": foreignColor } as CSSProperties)
          : undefined
      }
    >
      <td className="relative max-w-0 px-3 py-2">
        {isEditingTitle ? (
          <Input
            autoFocus
            name="table-title-edit"
            defaultValue={card.title}
            maxLength={LIMITS.cardTitle}
            aria-label={t("view.table.rename")}
            data-testid="table-title-input"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => onSubmitTitle(card.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                onSubmitTitle(card.id, event.currentTarget.value);
              if (event.key === "Escape") onCancelTitle();
            }}
            className="h-7 text-sm"
          />
        ) : (
          <span className="group/title block">
            <span
              onDoubleClick={
                readOnly
                  ? undefined
                  : (event) => {
                      event.stopPropagation();
                      onStartTitleEdit(card.id);
                    }
              }
              className={cn(
                "block truncate text-foreground/90",
                !readOnly && "group-hover/title:pr-9",
              )}
            >
              <HighlightedText text={card.title} query={highlight ?? ""} />
            </span>
            {readOnly ? null : isArchiveConfirm ? (
              <span
                data-testid="table-archive-confirm"
                className="absolute right-2 top-1/2 z-10 flex h-6 -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-card/95 px-0.5 shadow-sm backdrop-blur-sm"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label={t("card.archiveConfirmYes")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveConfirm(null);
                    onArchive(card.id);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t("card.archiveConfirmCancel")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveConfirm(null);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={t("card.archive")}
                data-testid="table-archive-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchiveConfirm(card.id);
                }}
                className="no-hover:hidden absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-warning/10 hover:text-warning focus-visible:opacity-100 group-hover/title:opacity-100"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {readOnly ? (
          <span className="inline-flex max-w-full items-center truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
            {columnTitle}
          </span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="table-column-cell"
                title={t("view.table.moveHint")}
                className="inline-flex max-w-full items-center truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {columnTitle}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t("view.table.column")}</DropdownMenuLabel>
              {columns.map((col) => {
                const full = col.id !== columnId && isColumnFull(col);
                return (
                  <DropdownMenuItem
                    key={col.id}
                    disabled={col.id === columnId || full}
                    onSelect={() => onMoveToColumn(card.id, columnId, col.id)}
                  >
                    <span className="truncate">{col.title}</span>
                    {col.wipLimit !== undefined && (
                      <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                        {col.cardIds.length}/{col.wipLimit}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="table-archive-card"
                onSelect={() => onArchive(card.id)}
              >
                <Archive className="h-4 w-4" />
                {t("card.archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {readOnly ? (
          typeof card.dueDate === "number" ? (
            <DueBadge dueDate={card.dueDate} />
          ) : (
            <span className="text-xs text-muted-foreground/60">—</span>
          )
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="table-due-cell"
                className="rounded transition-opacity hover:opacity-80"
                aria-label={t("dueDate.label")}
              >
                {typeof card.dueDate === "number" ? (
                  <DueBadge dueDate={card.dueDate} />
                ) : (
                  <span className="text-xs text-muted-foreground/60">—</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="relative w-auto p-3">
              <DueDatePickerContent cardId={card.id} dueDate={card.dueDate} />
            </PopoverContent>
          </Popover>
        )}
      </td>
      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
        {readOnly ? (
          <span className="flex max-w-44 flex-wrap gap-1">
            {cardLabels.map((label) => (
              <span
                key={label.id}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                  LABEL_COLOR_CHIP[label.color]
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-current"
                  aria-hidden
                />
                {label.name}
              </span>
            ))}
            {cardLabels.length === 0 ? (
              <span className="text-xs text-muted-foreground/60">—</span>
            ) : null}
          </span>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="table-labels-cell"
                className="max-w-44"
                aria-label={t("view.table.labels")}
              >
                {card.labelIds.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {cardLabels.map((label) => (
                      <span
                        key={label.id}
                        className={
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                          LABEL_COLOR_CHIP[label.color]
                        }
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-current"
                          aria-hidden
                        />
                        {label.name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground/60">—</span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3">
              <LabelPicker
                labels={labels}
                selected={card.labelIds}
                onToggle={(labelId) => onToggleLabel(card.id, labelId)}
                onCreate={(name, color) => onCreateLabel(card.id, name, color)}
                onRename={onRenameLabel}
                onRecolor={onRecolorLabel}
                onDelete={onDeleteLabel}
              />
            </PopoverContent>
          </Popover>
        )}
      </td>
      {visibleColumns.includes("checklists") ? (
        <td className="px-3 py-2">
          {(() => {
            const { done, total } = checklistProgress(card);
            return total > 0 ? (
              <span
                data-testid="table-checklist"
                title={t("checklist.badgeTooltip", { done, total })}
                className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                <ListChecks className="h-3 w-3" aria-hidden />
                {done}/{total}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/60">—</span>
            );
          })()}
        </td>
      ) : null}
      {visibleColumns.includes("description") ? (
        <td className="px-3 py-2">
          {card.description ? (
            <AlignLeft
              data-testid="table-description"
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label={t("view.table.description")}
            />
          ) : (
            <span className="text-xs text-muted-foreground/60">—</span>
          )}
        </td>
      ) : null}
      {visibleColumns.includes("createdAt") ? (
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {formatDateOnly(card.createdAt, lang)}
        </td>
      ) : null}
      {visibleColumns.includes("updatedAt") ? (
        <td className="px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {foreignAuthor ? (
              <span
                data-testid="table-last-actor"
                title={t("card.changedBy", { name: authorName })}
                className="inline-flex"
              >
                <UserAvatar
                  userId={foreignAuthor.userId}
                  displayName={authorMember?.displayName ?? null}
                  email={authorMember?.email ?? ""}
                  size="xs"
                  className="h-4 w-4 text-[8px] ring-1 ring-border/60"
                />
              </span>
            ) : null}
            {formatDateOnly(card.updatedAt, lang)}
          </span>
        </td>
      ) : null}
      {visibleColumns.includes("activity") ? (
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {card.activity?.length ?? 0}
          </span>
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Memoized (TASK-21.4.1): the table lists every card of the board, so an
 * edit anywhere used to re-render all of them — measured at 40 rows per
 * keystroke. The props are stable by construction: resolved labels come
 * from `useCardLabels`, `columns`/`labels` straight from the board (both
 * survive card edits), the per-row flags are booleans, and the callbacks
 * take a card id so one handler serves every row. The inline title editor
 * is uncontrolled, so typing in one row does not touch the others.
 */
const TableRow = memo(TableRowBody);

/** Table header cell with the asc → desc → reset click cycle. */
function SortHeader({
  label,
  sortKey,
  sort,
  onCycle,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onCycle: (key: SortKey) => void;
  className?: string;
}) {
  const isSorted = sort?.key === sortKey;
  return (
    <th scope="col" className={cn("px-3 py-2 text-left", className)}>
      <button
        type="button"
        data-testid={`table-sort-${sortKey}`}
        aria-sort={
          isSorted ? (sort?.dir === 1 ? "ascending" : "descending") : "none"
        }
        title={label}
        onClick={() => onCycle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground",
          isSorted ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {/* A neutral icon hints the header is sortable; it turns into the
            direction arrow once sorted. */}
        <span aria-hidden className="text-[10px]">
          {isSorted ? (sort?.dir === 1 ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/** "+ card" composer body: title, column chooser and label chips (TASK-14.1 item 10). */
function TableCardComposer({
  columns,
  labels,
  onSubmit,
  onCancel,
}: {
  /** `full` marks columns that cannot take another card right now; the
   *  counter `count`/`wipLimit` is shown for WIP-limited ones. */
  columns: {
    id: string;
    title: string;
    full: boolean;
    count?: number;
    wipLimit?: number;
  }[];
  labels?: Label[];
  onSubmit: (columnId: string, title: string, labelIds?: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  // Default to the first column that can actually take the card — a full
  // default column would only produce a disabled submit.
  const [columnId, setColumnId] = useState(
    (columns.find((col) => !col.full) ?? columns[0])?.id ?? "",
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };

  const selected = columns.find((col) => col.id === columnId);
  // The reducer refuses an add into a full column — the composer says so
  // up front instead of letting the user type into a dead submit.
  const selectedFull = selected?.full ?? true;
  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || !columnId || selectedFull) return;
    onSubmit(columnId, trimmed, selectedLabels);
    setTitle("");
    setSelectedLabels([]);
  };

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        name="table-composer"
        value={title}
        maxLength={LIMITS.cardTitle}
        data-testid="table-composer-input"
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.add")}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        className="h-8 text-sm"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full justify-start text-xs"
            data-testid="table-composer-column"
          >
            {selected?.title ?? "—"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-44 w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 overflow-y-auto"
        >
          {columns.map((col) => (
            <DropdownMenuItem
              key={col.id}
              onSelect={() => setColumnId(col.id)}
              disabled={col.full}
              title={
                col.full
                  ? t("limits.columnFull", { limit: LIMITS.cardsPerColumn })
                  : undefined
              }
            >
              <span className="truncate">{col.title}</span>
              {col.wipLimit !== undefined && col.count !== undefined && (
                <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                  {col.count}/{col.wipLimit}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ComposerLabelPicker
        labels={labels}
        selected={selectedLabels}
        onToggle={toggleLabel}
        testId="table-composer-labels"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!title.trim() || selectedFull}
          title={
            selectedFull
              ? t("limits.columnFull", { limit: LIMITS.cardsPerColumn })
              : undefined
          }
          onClick={submit}
        >
          {t("composer.submit")}
        </Button>
        {/* Same pair as the board composer: Cancel just closes the popover. */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
