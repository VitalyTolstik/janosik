import { useVirtualizer } from "@tanstack/react-virtual";
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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { CardContextMenu } from "@/components/board/CardContextMenu";
import {
  OPTIONAL_COLUMNS,
  SortHeader,
  checklistProgress,
  readStoredColumns,
  writeStoredColumns,
  type OptionalColumn,
  type SortKey,
  type SortState,
} from "@/components/board/table-parts";
import { DueBadge } from "@/components/board/DueBadge";
import { PriorityBadge } from "@/components/board/PriorityBadge";
import { ComposerLabelPicker } from "@/components/board/ComposerLabelPicker";
import { LabelPicker } from "@/components/board/LabelPicker";
import { DueDatePickerContent } from "@/components/board/CardDueDate";
import { HighlightedText } from "@/components/ui/highlight";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
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
import { cardHref, openCardInNewTab } from "@/utils/card-nav";
import {
  useBoardMember,
  useBoardMembersList,
  useEntityAttribution,
} from "@/store/board-live";
import { userAvatarVar, userLabel } from "@/utils/avatar";
import { priorityRank } from "@/utils/priority";
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

/**
 * Row windowing (TASK-139). The full 2400-card table mounted ~49k DOM nodes,
 * ~510 MB heap and blocked the main thread for ~1.9 s; below the threshold a
 * table renders whole (tests, small boards) and drops none of the inline
 * editors into a virtual window.
 */
const VIRTUALIZE_TABLE_FROM = 60;
/** Estimated row height (py-2 + 20px line + border); refined by measurement. */
const TABLE_ROW_ESTIMATE = 37;
/** The sticky-less `<thead>` occupies this much of the scroll offset. */
const TABLE_HEADER_OFFSET = 37;

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
  // The member directory powers the assignee column (name resolution for
  // sorting) — one subscription for the whole table (TASK-49).
  const members = useBoardMembersList(board?.id);
  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(
        member.userId,
        userLabel(member.displayName, member.email).toLowerCase(),
      );
    }
    return map;
  }, [members]);

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
    writeStoredColumns(visibleColumns);
  }, [visibleColumns]);

  // TASK-117: rebuilding the rows/sort on every keystroke was O(n log n) per
  // render; memoize both so a card edit does not recompute the whole table.
  const rows = useMemo(() => {
    if (!board) return [];
    return board.columns.flatMap((column) => {
      const ids = filteredCardIds?.[column.id] ?? column.cardIds;
      return ids
        .map((id) => board.cards[id])
        .filter((card) => card !== undefined)
        .map((card) => ({ card, column }));
    });
  }, [board, filteredCardIds]);

  // Sort a copy — the stored board order is never touched (visual only).
  const sortedRows = useMemo(() => {
    if (!board || !sort) return rows;
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
        case "priority":
          return (
            (priorityRank(a.card.priority) - priorityRank(b.card.priority)) *
            sort.dir
          );
        case "assignee": {
          // Unassigned rows sort last regardless of direction (Jira).
          if (!a.card.assigneeId && !b.card.assigneeId) return 0;
          if (!a.card.assigneeId) return 1;
          if (!b.card.assigneeId) return -1;
          const aName = assigneeNameById.get(a.card.assigneeId) ?? "";
          const bName = assigneeNameById.get(b.card.assigneeId) ?? "";
          return aName.localeCompare(bName) * sort.dir;
        }
        case "createdAt":
          return (a.card.createdAt - b.card.createdAt) * sort.dir;
      }
    };
    return [...rows].sort(cmp);
  }, [board, rows, sort, lang, assigneeNameById]);

  // Row virtualizer (TASK-139): every row is a real <tr>, so the window keeps
  // the table's own column layout and only mounts the rows around the
  // viewport. Spacer rows preserve the scroll height; measured rows refine
  // the estimate for the variable-height label cell.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => TABLE_ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => sortedRows[index]?.card.id ?? index,
    scrollMargin: TABLE_HEADER_OFFSET,
    initialRect: { width: 0, height: 600 },
  });
  const virtualizeRows = sortedRows.length > VIRTUALIZE_TABLE_FROM;
  const virtualRows = virtualizeRows ? rowVirtualizer.getVirtualItems() : [];
  const topSpacer = virtualRows.length
    ? virtualRows[0].start - TABLE_HEADER_OFFSET
    : 0;
  const bottomSpacer = virtualRows.length
    ? rowVirtualizer.getTotalSize() -
      virtualRows[virtualRows.length - 1].end +
      TABLE_HEADER_OFFSET
    : 0;

  const renderRow = (
    { card, column }: (typeof sortedRows)[number],
    rowIndex?: number,
    measureRef?: (node: HTMLTableRowElement | null) => void,
  ) => (
    <TableRow
      key={card.id}
      card={card}
      boardId={board?.id}
      cardLabels={labelsOf(card.labelIds)}
      columnId={column.id}
      columnTitle={column.title}
      columns={board?.columns ?? []}
      labels={board?.labels ?? NO_LABELS}
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
      rowIndex={rowIndex}
      measureRef={measureRef}
    />
  );

  if (!board) return null;

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

      <div
        ref={tableScrollRef}
        data-testid="table-scroll"
        className="flex-1 overflow-y-auto"
      >
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
              {visibleColumns.includes("priority") ? (
                <SortHeader
                  label={t("view.table.priority")}
                  sortKey="priority"
                  sort={sort}
                  onCycle={cycleSort}
                  className="w-28"
                />
              ) : null}
              {visibleColumns.includes("assignee") ? (
                <SortHeader
                  label={t("view.table.assignee")}
                  sortKey="assignee"
                  sort={sort}
                  onCycle={cycleSort}
                  className="w-36"
                />
              ) : null}
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
            {virtualizeRows ? (
              <>
                {topSpacer > 0 ? (
                  <tr aria-hidden>
                    <td
                      colSpan={4 + optionalCount}
                      style={{ height: topSpacer, padding: 0, border: 0 }}
                    />
                  </tr>
                ) : null}
                {virtualRows.map((virtualRow) => {
                  const row = sortedRows[virtualRow.index];
                  return row
                    ? renderRow(
                        row,
                        virtualRow.index,
                        rowVirtualizer.measureElement,
                      )
                    : null;
                })}
                {bottomSpacer > 0 ? (
                  <tr aria-hidden>
                    <td
                      colSpan={4 + optionalCount}
                      style={{ height: bottomSpacer, padding: 0, border: 0 }}
                    />
                  </tr>
                ) : null}
              </>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={4 + optionalCount}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {isFiltering ? t("filter.noMatch") : t("view.table.empty")}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => renderRow(row))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TableRowProps {
  card: Card;
  /** The board id — resolves the assignee cell's member (TASK-49). */
  boardId: string | undefined;
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
  /** TanStack item index — only set for a windowed row. */
  rowIndex?: number;
  /** TanStack row measurement callback — only set for a windowed row. */
  measureRef?: (node: HTMLTableRowElement | null) => void;
}

function TableRowBody({
  card,
  boardId,
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
  rowIndex,
  measureRef,
}: TableRowProps) {
  const { t, lang } = useI18n();
  // Attribution (TASK-36): the transient foreign highlight only — the
  // "who changed it" avatar chip was retired in TASK-49 (owner's call).
  const attribution = useEntityAttribution(card.id);
  const authorMember = useBoardMember(
    attribution?.boardId,
    attribution?.userId,
  );
  const foreignColor = userAvatarVar(
    attribution?.userId ?? "",
    authorMember?.avatarColor,
  );
  return (
    <CardContextMenu
      cardId={card.id}
      readOnly={readOnly}
      onOpen={onOpen}
      onArchive={onArchive}
    >
      <tr
        ref={measureRef}
        data-index={rowIndex}
        onClick={() => onOpen(card.id)}
        onAuxClick={(event) => {
          // Wheel-click (middle button) opens the card in a new tab — the
          // row is a <tr>, so the browser has no href to act on by itself.
          // Ctrl/Cmd+click is already covered: on a plain <tr> the browser
          // has no link semantics, so we route it through the deep link too.
          if (event.button === 1 && boardId) {
            event.preventDefault();
            openCardInNewTab(boardId, card.id);
          }
        }}
        data-testid="table-row"
        data-card-href={boardId ? cardHref(boardId, card.id) : undefined}
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
                  onCreate={(name, color) =>
                    onCreateLabel(card.id, name, color)
                  }
                  onRename={onRenameLabel}
                  onRecolor={onRecolorLabel}
                  onDelete={onDeleteLabel}
                />
              </PopoverContent>
            </Popover>
          )}
        </td>
        {visibleColumns.includes("priority") ? (
          <td className="px-3 py-2" data-testid="table-priority">
            <PriorityBadge priority={card.priority ?? "medium"} showLabel />
          </td>
        ) : null}
        {visibleColumns.includes("assignee") ? (
          <td className="px-3 py-2" data-testid="table-assignee">
            <AssigneeCell boardId={boardId} assigneeId={card.assigneeId} />
          </td>
        ) : null}
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
            {formatDateOnly(card.updatedAt, lang)}
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
    </CardContextMenu>
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

/**
 * One assignee cell (TASK-49): avatar + name from the member directory,
 * initials fallback when the assignee has left the board. `—` keeps the
 * column honest while the card is unassigned.
 */
function AssigneeCell({
  boardId,
  assigneeId,
}: {
  boardId: string | undefined;
  assigneeId?: string;
}) {
  const member = useBoardMember(boardId, assigneeId ?? null);
  if (!assigneeId) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <UserAvatar
        userId={assigneeId}
        displayName={member?.displayName ?? null}
        email={member?.email ?? ""}
        color={member?.avatarColor}
        avatarPath={member?.avatarPath}
        size="xs"
        className="ring-1 ring-border/60"
      />
      {userLabel(member?.displayName ?? null, member?.email ?? "")}
    </span>
  );
}

/** Table header cell with the asc → desc → reset click cycle. */
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
