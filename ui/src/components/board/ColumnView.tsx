import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical, Lock } from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AddCardZone } from "@/components/board/AddCardZone";
import {
  BacklogCardComposer,
  BacklogEpicFooter,
  BacklogEpicTile,
  BacklogOtherCards,
} from "@/components/board/BacklogEpic";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import type { EpicCollapse } from "@/hooks/use-epic-collapse";
import {
  epicChildrenId,
  type BacklogEpic,
  type BacklogRows,
} from "@/utils/backlog-rows";
import { CardComposer } from "@/components/board/CardComposer";
import { ColumnAccentPicker } from "@/components/board/ColumnAccentPicker";
import { columnAccentVars } from "@/utils/column-accent";
import { ColumnMenu } from "@/components/board/ColumnMenu";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { RenameColumnDialog } from "@/components/board/RenameColumnDialog";
import { SortableCard } from "@/components/board/SortableCard";
import { WipLimitDialog } from "@/components/board/WipLimitDialog";
import { useCardLabels } from "@/hooks/use-card-labels";
import {
  CARD_ROW_HEIGHT,
  COMPACT_CARD_ROW_HEIGHT,
  useCardWindow,
} from "@/hooks/use-card-window";
import type { BoardDensity } from "@/hooks/use-board-density";
import { useDoubleTap } from "@/hooks/use-double-tap";
import type { CardLinkIndex } from "@/utils/links";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import { useCardSelection } from "@/store/board-selection";
import type { Card, Column, Label } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";
import { isColumnFull } from "@janosik/shared";
import {
  DEFAULT_COLUMN_ACCENT_STYLE,
  type ColumnAccentStyle,
} from "@janosik/shared";

/** Stable empty list for an empty column's SortableContext. */
const NO_IDS: string[] = [];
const EPIC_RAIL = "border-x border-(--epic-border) bg-(--epic-surface)";

interface ColumnViewProps {
  column: Column;
  /** The board id — resolves the assignee badge's member (TASK-49). */
  boardId?: string;
  /**
   * The cards to render, in order. Resolved by the caller (`useCardList`)
   * so the array keeps its identity while nothing in this column changes —
   * that is what makes the `memo` below effective (TASK-21.4.1).
   */
  cards: Card[];
  /** The board's labels — card chips and the composer's picker. */
  labels: Label[];
  /**
   * The board's link index (TASK-46): one WeakMap-cached object per
   * `board.cards` snapshot, owned by the caller so the memo below only
   * breaks when the data actually changed.
   */
  linkIndex: CardLinkIndex;
  /** True when `cards` is a filter/drag override of the column's own order. */
  overridden?: boolean;
  className?: string;
  onCardClick?: (cardId: string) => void;
  /** True while a board filter is active (changes the empty-state text). */
  isFiltered?: boolean;
  /** The server comment/attachment lookup for the query is still pending. */
  filterPending?: boolean;
  /** Filter/search query highlighted on the card fronts. */
  highlight?: string;
  /**
   * TASK-200.9: ids the server filter matched in their description. Summary
   * cards need this to tell a description hit from a checklist/comment hit.
   */
  descriptionMatchIds?: ReadonlySet<string>;
  /** The j/k keyboard cursor card — rendered with a focus ring. */
  cursorCardId?: string;
  /**
   * False when the board is at LIMITS.columnsPerBoard — the column menu's
   * "Duplicate column" disables (the reducer would refuse it anyway).
   * A primitive prop on purpose: subscribing the memoized column to the
   * board state would undo TASK-21.4.1.
   */
  canDuplicateColumn?: boolean;
  /** Card density (TASK-142): the compact face uses a shorter window row. */
  density?: BoardDensity;
  /** Board-wide accent shape (TASK-164); ignored when the column has no accent. */
  columnStyle?: ColumnAccentStyle;
  /** VIEWER mode (TASK-35): static header, no menu, no composers, no drag. */
  readOnly?: boolean;
  /**
   * While a card is dragged, the reason this column cannot accept it (a
   * workflow transition, role or condition). Rendered as a dimmed target with
   * a lock and the reason, so a forbidden drop is never a silent no-op.
   */
  workflowBlockedReason?: string;
  backlog?: BacklogRows;
  epics?: ReadonlyMap<string, BacklogEpic>;
  isBacklog?: boolean;
  epicCollapse?: EpicCollapse;
  getCard?: (id: string) => Card | undefined;
}

/**
 * A single column: header (title + count badge + menu), scrollable card list
 * (with an empty state), and a CardComposer footer.
 *
 * - The whole column is droppable (so cards can be dropped anywhere on an
 *   empty column) AND sortable (columns are reorderable by dragging the
 *   header — visible grip handles).
 * - The card list is a SortableContext for vertical card sorting.
 * - Double-click the title or use the menu to rename; menu → Delete column
 *   asks for confirmation (cascades to its cards).
 */
function ColumnViewBody({
  column,
  boardId,
  cards,
  labels,
  linkIndex,
  overridden = false,
  className,
  onCardClick,
  isFiltered = false,
  filterPending = false,
  highlight,
  descriptionMatchIds,
  cursorCardId,
  canDuplicateColumn = true,
  density = "full",
  columnStyle = DEFAULT_COLUMN_ACCENT_STYLE,
  readOnly = false,
  workflowBlockedReason,
  backlog,
  epics,
  isBacklog,
  epicCollapse,
  getCard,
}: ColumnViewProps) {
  const {
    addCard,
    renameColumn,
    deleteColumn,
    duplicateCard,
    archiveCard,
    archiveColumnCards,
    duplicateColumn,
    sortColumn,
    setColumnWipLimit,
    setColumnAccent,
  } = useBoardActions();
  const { t, tp } = useI18n();
  const selection = useCardSelection();
  const [renameOpen, setRenameOpen] = useState(false);
  const openRename = useCallback(() => setRenameOpen(true), []);
  // Touch has no reliable `dblclick` here: the header owns dnd-kit's
  // TouchSensor listeners, so the second tap can be consumed as a pending
  // drag and the browser skips the synthetic `dblclick`. Read the double tap
  // from the pointer stream instead; mouse still uses `onDoubleClick`
  // (TASK-21.11).
  const doubleTapHandlers = useDoubleTap(openRename);
  const [wipLimitOpen, setWipLimitOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchiveCards, setConfirmArchiveCards] = useState(false);
  // Keep the gap attached to the same card as new cards are inserted before it.
  // null is the end of the column; undefined means the composer is closed.
  const [inlineAnchor, setInlineAnchor] = useState<string | null>();
  const [openEpicComposer, setOpenEpicComposer] = useState<string>();
  const revealComposer = useRef<string>();

  // The card callbacks must keep their identity across renders, otherwise
  // `memo` on SortableCard/CardItem never holds (TASK-21.4). They take a
  // card id and read the current cards from a ref instead of closing over
  // one card, so a single handler serves the whole column.
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  const resolveLabels = useCardLabels(labels);

  const handleCardClick = useCallback(
    (cardId: string) => onCardClick?.(cardId),
    [onCardClick],
  );
  const handleCardDuplicate = useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((item) => item.id === cardId);
      duplicateCard(
        cardId,
        card ? t("card.duplicateTitle", { title: card.title }) : undefined,
      );
    },
    [duplicateCard, t],
  );
  // Stable too, so the insert zones can be memoized (TASK-21.4.1): the zone
  // reports the gap it sits in instead of each one closing over its index.
  const handleInsertAt = useCallback(
    (index: number) => setInlineAnchor(column.cardIds[index] ?? null),
    [column.cardIds],
  );

  // `SortableContext`'s `items` must keep its identity: a fresh array there
  // changes dnd-kit's context and re-renders every card in the column,
  // `memo` or not. Keyed by the ids themselves rather than by the array,
  // because an active filter rebuilds its id arrays on every keystroke.
  const idsKey = cards.map((card) => card.id).join(" ");
  const ids = useMemo(
    () => (idsKey === "" ? NO_IDS : idsKey.split(" ")),
    [idsKey],
  );

  const count = cards.length;
  const compact = density === "compact";
  const rowHeight = compact ? COMPACT_CARD_ROW_HEIGHT : CARD_ROW_HEIGHT;
  const { scrollRef, onScroll, range, scrollToIndex, offsetAt } = useCardWindow(
    backlog?.rows.length ?? count,
    rowHeight,
    backlog?.rows,
  );
  // The inline composer is stateful; keep every card mounted while it is open
  // so scrolling cannot unmount the editor and drop its draft (TASK-139).
  const windowed = backlog !== undefined || inlineAnchor === undefined;
  const rowStart = windowed ? range.start : 0;
  const rowEnd = windowed ? range.end : count;
  const cursorIndex = cursorCardId
    ? backlog
      ? backlog.rows.findIndex((row) => row.key === `card:${cursorCardId}`)
      : cards.findIndex((card) => card.id === cursorCardId)
    : -1;
  const lastCursor = useRef<string>();

  // j/k can walk past the mounted window; scroll the column before the
  // cursor's card is looked up for `scrollIntoView` (TASK-139).
  useLayoutEffect(() => {
    if (lastCursor.current === cursorCardId) return;
    lastCursor.current = cursorCardId;
    if (windowed && cursorIndex >= 0) scrollToIndex(cursorIndex);
  }, [cursorCardId, cursorIndex, scrollToIndex, windowed]);

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColumnDragging,
  } = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: readOnly,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: column.id,
  });

  const wipLimit = column.wipLimit;
  const visibleCount = backlog && !isFiltered ? column.cardIds.length : count;
  const atWipLimit = wipLimit !== undefined && visibleCount >= wipLimit;
  const overWipLimit = wipLimit !== undefined && visibleCount > wipLimit;
  // The hover duplicate puts the copy into this column — dead when the
  // real column contents (not the filtered view) cannot take one more.
  const duplicateDisabled = isColumnFull(column);
  const duplicateDisabledReason =
    wipLimit !== undefined && column.cardIds.length >= wipLimit
      ? t("column.wipLimitReached", { limit: wipLimit })
      : t("limits.columnFull", { limit: LIMITS.cardsPerColumn });
  // Hover zones insert into the real column order, so they only make sense
  // when the rendered ids ARE the column order (no filter override, no
  // active card-drag draft) and the column can still take cards.
  const inlineAddAllowed =
    !readOnly && !overridden && !isFiltered && !duplicateDisabled;

  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDroppableRef(node);
  };

  const handleRename = (title: string) => {
    renameColumn(column.id, title);
    setRenameOpen(false);
  };

  const handleDelete = () => {
    deleteColumn(column.id);
    setConfirmDelete(false);
  };

  const renderCard = (card: Card, nested = false) => {
    const entry =
      !nested && card.epicId !== undefined
        ? epics?.get(card.epicId)
        : undefined;
    return (
      <SortableCard
        card={card}
        epicChip={
          isBacklog || entry?.epic.status === "active" ? entry?.chip : undefined
        }
        showEpicTitle={!isBacklog}
        boardId={boardId}
        labels={resolveLabels(card.labelIds)}
        highlight={highlight}
        descriptionMatch={descriptionMatchIds?.has(card.id)}
        isCursor={card.id === cursorCardId}
        linkFacts={linkIndex.factsOf(card.id)}
        onCardClick={onCardClick ? handleCardClick : undefined}
        onCardDuplicate={readOnly ? undefined : handleCardDuplicate}
        onCardArchive={readOnly ? undefined : archiveCard}
        duplicateDisabled={duplicateDisabled}
        duplicateDisabledReason={duplicateDisabledReason}
        compact={compact}
        readOnly={readOnly}
        selected={selection.selectedSet.has(card.id)}
        selectionMode={selection.enabled && selection.mode}
        onToggleSelect={selection.enabled ? selection.toggle : undefined}
      />
    );
  };

  const indices = useMemo(
    () => backlog && new Map(column.cardIds.map((id, index) => [id, index])),
    [backlog, column.cardIds],
  );
  const pinnedKeys = [
    typeof inlineAnchor === "string" ? `card:${inlineAnchor}` : undefined,
    openEpicComposer,
  ];
  useLayoutEffect(() => {
    const key = revealComposer.current;
    if (!key) return;
    revealComposer.current = undefined;
    const index = backlog?.rows.findIndex((row) => row.key === key) ?? -1;
    if (index >= 0) scrollToIndex(index);
  }, [backlog, scrollToIndex]);

  const renderGapComposer = (index: number, key?: string) => (
    <CardComposer
      labels={labels}
      defaultComposing
      inputLabel={t("composer.add")}
      atIndex={index}
      onClose={() => setInlineAnchor(undefined)}
      onSubmit={(title, labelIds, at) => {
        revealComposer.current = key;
        addCard(column.id, title, labelIds, at);
      }}
    />
  );

  function renderBacklogRow(row: BacklogRows["rows"][number], index: number) {
    switch (row.kind) {
      case "epic":
        return (
          <div className="pt-2" style={{ height: row.height }}>
            <BacklogEpicTile
              entry={row.entry}
              getCard={getCard!}
              onCardClick={onCardClick}
              boardId={boardId}
              labels={resolveLabels(row.entry.labelIds)}
              compact={compact}
              expanded={row.expanded}
              toggle={epicCollapse!.toggleEpic}
              filterExpanded={isFiltered}
              dropDisabled={isFiltered || readOnly}
            />
          </div>
        );
      case "child": {
        const card = getCard?.(row.cardId);
        return card ? (
          <li
            key={row.key}
            data-epic-child={row.entry.epic.id}
            className={cn(EPIC_RAIL, "backlog-child pl-3.5 pr-1.5 pt-2")}
          >
            {renderCard(card, true)}
          </li>
        ) : null;
      }
      case "epic-footer":
        return (
          <li key={row.key} style={{ height: row.height }}>
            <BacklogEpicFooter
              entry={row.entry}
              getCard={getCard!}
              onCardClick={onCardClick}
              last={backlog?.rows[index + 1]?.kind !== "epic-add"}
            />
          </li>
        );
      case "epic-add":
        return (
          <li
            key={row.key}
            className={cn(EPIC_RAIL, "rounded-b-lg border-b px-2")}
            style={{ height: row.height }}
          >
            <BacklogCardComposer
              labels={labels}
              epic={row.entry.epic}
              disabled={duplicateDisabled}
              disabledReason={duplicateDisabledReason}
              onOpenChange={(open) =>
                setOpenEpicComposer(open ? row.key : undefined)
              }
              onSubmit={(title, labelIds) => {
                revealComposer.current = row.key;
                addCard(
                  column.id,
                  title,
                  labelIds,
                  undefined,
                  row.entry.epic.id,
                );
              }}
            />
          </li>
        );
      case "other":
        return (
          <li key={row.key} style={{ height: row.height }}>
            <BacklogOtherCards
              count={row.count}
              disabled={isFiltered || readOnly}
            />
          </li>
        );
      case "card": {
        const card = getCard?.(row.cardId);
        if (!card) return null;
        const at = indices?.get(card.id) ?? 0;
        return (
          <Fragment key={row.key}>
            <AddCardZone
              index={at}
              fixedHeight
              interactive={inlineAddAllowed}
              onInsert={handleInsertAt}
            />
            <li>
              {inlineAnchor === card.id ? (
                <Popover
                  open
                  onOpenChange={(open) => {
                    if (!open) setInlineAnchor(undefined);
                  }}
                >
                  <PopoverAnchor asChild>
                    <div>{renderCard(card)}</div>
                  </PopoverAnchor>
                  <PopoverContent
                    aria-label={t("composer.add")}
                    className="p-2"
                  >
                    {renderGapComposer(at, row.key)}
                  </PopoverContent>
                </Popover>
              ) : (
                renderCard(card)
              )}
            </li>
          </Fragment>
        );
      }
      case "completed":
        return (
          <li key={row.key} style={{ height: row.height }} className="pt-1">
            <button
              type="button"
              aria-expanded={epicCollapse?.completedOpen}
              className="flex h-11 w-full items-center gap-1.5 rounded-md px-1 text-left text-ui-label font-semibold text-muted-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"
              onClick={epicCollapse?.toggleCompleted}
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={
                  epicCollapse?.completedOpen ? "rotate-180" : undefined
                }
              />
              {t("epic.completed", { count: row.count })}
            </button>
          </li>
        );
    }
  }

  function renderBacklogRows(model: BacklogRows) {
    const mounted = Array.from(
      { length: range.end - range.start },
      (_, index) => range.start + index,
    );
    for (const key of pinnedKeys) {
      if (!key) continue;
      const index = model.rows.findIndex((row) => row.key === key);
      if (index >= 0 && (index < range.start || index >= range.end))
        mounted.push(index);
    }
    mounted.sort((a, b) => a - b);

    function spacer(start: number, end: number) {
      return start < end ? (
        <li
          key={`gap:${start}`}
          aria-hidden
          style={{ height: offsetAt(end) - offsetAt(start) }}
        />
      ) : null;
    }

    const content: ReactNode[] = [];
    let start = 0;
    for (let i = 0; i < mounted.length; i++) {
      const index = mounted[i];
      const row = model.rows[index];
      const group = model.groups.get(index);
      content.push(spacer(start, group?.start ?? index));
      if (!group) {
        content.push(
          row.kind === "epic" ? (
            <li key={row.key}>{renderBacklogRow(row, index)}</li>
          ) : (
            renderBacklogRow(row, index)
          ),
        );
        start = index + 1;
        continue;
      }

      const { entry } = group;
      const header = index === group.start;
      const children: ReactNode[] = [];
      let next = header ? group.start + 1 : group.start;
      let child = header ? mounted[i + 1] : index;
      if (header && child < group.end) i++;
      while (child < group.end) {
        children.push(
          spacer(next, child),
          renderBacklogRow(model.rows[child], child),
        );
        next = child + 1;
        child = mounted[i + 1];
        if (child < group.end) i++;
      }
      children.push(spacer(next, group.end));
      content.push(
        <li key={`group:${entry.epic.id}`}>
          {header && renderBacklogRow(row, index)}
          <div
            id={epicChildrenId(entry.epic.id)}
            role="group"
            aria-label={t("epic.subtasks", { title: entry.epic.title })}
            hidden={group.end === group.start + 1}
          >
            <ul>{children}</ul>
          </div>
        </li>,
      );
      start = group.end;
    }
    content.push(spacer(start, model.rows.length));
    return content;
  }

  const accent = column.accent;
  const accentActive = accent !== undefined;

  return (
    <>
      <section
        ref={setNodeRef}
        data-column-accent={accent?.value ?? "none"}
        data-column-accent-type={accent?.type ?? "none"}
        data-column-accent-style={accentActive ? columnStyle : "none"}
        data-workflow-blocked={workflowBlockedReason !== undefined || undefined}
        aria-label={
          workflowBlockedReason
            ? `${column.title}: ${workflowBlockedReason}`
            : undefined
        }
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          // Column glass — driven by --janosik-glass-* (BoardGlassProvider).
          // transparency 0 = opaque, 100 = frame only; blur 0 = no frosting.
          // Every accent shape keeps the user's glass settings, including
          // `glass` (which only adds a rail, tint and border ring).
          backgroundColor:
            "color-mix(in oklab, var(--card) calc((100 - var(--janosik-glass-transparency)) * 1%), transparent)",
          backdropFilter: "blur(var(--janosik-glass-blur))",
          ...columnAccentVars(accent),
        }}
        className={cn(
          "flex max-h-full w-[80vw] max-w-72 shrink-0 flex-col rounded-xl border transition-colors sm:w-72 sm:max-w-none",
          accentActive && "janosik-column-accent",
          accentActive && `janosik-column-accent-${columnStyle}`,
          isColumnDragging
            ? "border-primary/60 opacity-50"
            : isOver
              ? "border-primary/60"
              : workflowBlockedReason
                ? "border-danger/40 opacity-60"
                : "border-border",
          className,
        )}
      >
        <header
          className={cn(
            "flex items-center justify-between gap-1 px-2 py-2.5 pl-3",
            accentActive && "janosik-column-accent-head",
            !readOnly &&
              "cursor-grab touch-manipulation active:cursor-grabbing",
          )}
          {...(readOnly ? {} : attributes)}
          {...(readOnly ? {} : listeners)}
          role="group"
          aria-pressed={undefined}
          aria-label={column.title}
          title={readOnly ? undefined : t("column.dragHint")}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="janosik-column-accent-dotmark h-[7px] w-[7px] shrink-0 rounded-full"
            />
            <h2
              className="janosik-column-accent-heading truncate text-ui-body font-semibold text-foreground"
              onDoubleClick={readOnly ? undefined : openRename}
              {...(readOnly ? {} : doubleTapHandlers)}
            >
              {column.title}
            </h2>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span
              data-testid="column-wip"
              title={
                backlog && backlog.hiddenCount > 0
                  ? t("epic.hidden", { count: backlog.hiddenCount })
                  : atWipLimit
                    ? t("column.wipLimitReached", { limit: wipLimit })
                    : undefined
              }
              className={cn(
                "flex h-5 shrink-0 items-center justify-center rounded-full px-1.5 text-ui-micro font-medium",
                overWipLimit
                  ? "bg-danger/15 text-(--chip-red)"
                  : atWipLimit
                    ? "bg-warning/15 text-(--chip-warning)"
                    : "bg-hover text-muted-foreground",
              )}
            >
              {wipLimit !== undefined
                ? `${visibleCount}/${wipLimit}`
                : visibleCount}
            </span>
            {backlog && backlog.epicCount > 0 ? (
              <span
                className="max-w-20 truncate rounded-full border border-(--epic-border) bg-(--epic-surface) px-1.5 text-ui-micro font-bold text-(--epic-ink)"
                title={
                  isFiltered
                    ? t("epic.filterHidden", {
                        count: column.cardIds.length - count,
                      })
                    : backlog.hiddenCount > 0
                      ? t("epic.hidden", { count: backlog.hiddenCount })
                      : undefined
                }
              >
                {tp("epic.codeCount", backlog.epicCount)}
              </span>
            ) : null}
            {readOnly ? null : (
              <>
                <ColumnAccentPicker
                  columnId={column.id}
                  title={column.title}
                  accent={accent}
                  columnStyle={columnStyle}
                  onChange={(next) => setColumnAccent(column.id, next)}
                />
                <ColumnMenu
                  onRename={openRename}
                  onDuplicate={() =>
                    duplicateColumn(
                      column.id,
                      t("column.duplicateTitle", { title: column.title }),
                    )
                  }
                  onDelete={() => setConfirmDelete(true)}
                  onSort={(sortBy) => sortColumn(column.id, sortBy)}
                  onSetWipLimit={() => setWipLimitOpen(true)}
                  onArchiveCards={() => setConfirmArchiveCards(true)}
                  wipLimit={wipLimit}
                  duplicateDisabled={!canDuplicateColumn}
                  duplicateDisabledReason={t("limits.maxColumns", {
                    limit: LIMITS.columnsPerBoard,
                  })}
                />
                <GripVertical
                  aria-hidden
                  className="janosik-column-accent-grip h-4 w-4 shrink-0 text-muted-foreground/60"
                />
              </>
            )}
          </span>
        </header>

        {workflowBlockedReason ? (
          <p
            data-testid={`column-workflow-blocked-${column.id}`}
            className="mx-2 mb-1 flex items-start gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-ui-label leading-snug text-(--chip-red)"
          >
            <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0">{workflowBlockedReason}</span>
          </p>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          data-testid="column-card-scroll"
          className="flex-1 overflow-y-auto px-2 pb-1"
          style={backlog && { overflowAnchor: "none" }}
        >
          {backlog && backlog.rows.length > 0 ? (
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="py-1" data-testid="backlog-rows">
                {renderBacklogRows(backlog)}
                {readOnly || isFiltered ? null : (
                  <li className="h-12 pt-1">
                    <BacklogCardComposer
                      columnId={column.id}
                      labels={labels}
                      disabled={duplicateDisabled}
                      disabledReason={duplicateDisabledReason}
                      onSubmit={(title, labelIds) =>
                        addCard(column.id, title, labelIds)
                      }
                    />
                  </li>
                )}
              </ul>
            </SortableContext>
          ) : count === 0 && inlineAnchor === undefined ? (
            <ul className="flex flex-col">
              <li className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-ui-body text-muted-foreground">
                {isFiltered && filterPending && column.cardIds.length > 0
                  ? t("filter.searchingServer")
                  : isFiltered && (backlog || column.cardIds.length > 0)
                    ? t("filter.noMatch")
                    : t("column.empty")}
              </li>
              {inlineAddAllowed && (
                <AddCardZone index={0} onInsert={handleInsertAt} touchVisible />
              )}
            </ul>
          ) : (
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {/* Spacing comes from the 8px zones/spacers themselves (they
                  render in every mode) — a conditional space-y here would
                  shift the whole column on drag start. */}
              <ul className="py-1">
                {/* Hidden rows keep their exact geometry as spacer <li>s:
                    start × (zone 8 + card 92) above, the rest below. */}
                {rowStart > 0 ? (
                  <li aria-hidden style={{ height: rowStart * rowHeight }} />
                ) : null}
                {cards.slice(rowStart, rowEnd).map((card, offset) => {
                  const i = rowStart + offset;
                  return (
                    <Fragment key={card.id}>
                      {inlineAnchor === card.id ? (
                        <li className="py-1">{renderGapComposer(i)}</li>
                      ) : (
                        <AddCardZone
                          index={i}
                          interactive={inlineAddAllowed}
                          onInsert={handleInsertAt}
                        />
                      )}
                      <li>{renderCard(card)}</li>
                    </Fragment>
                  );
                })}
                {rowEnd < count ? (
                  <li
                    aria-hidden
                    style={{ height: (count - rowEnd) * rowHeight }}
                  />
                ) : null}
                {count > 0 && inlineAnchor !== null && (
                  <AddCardZone
                    index={count}
                    interactive={inlineAddAllowed}
                    onInsert={handleInsertAt}
                    touchVisible
                  />
                )}
                {inlineAnchor === null && (
                  <li className="py-1">{renderGapComposer(count)}</li>
                )}
              </ul>
            </SortableContext>
          )}
        </div>

        {readOnly || backlog ? null : (
          <footer className="px-2 pb-2 pt-1.5">
            <CardComposer
              columnId={column.id}
              labels={labels}
              disabled={
                column.cardIds.length >= LIMITS.cardsPerColumn || atWipLimit
              }
              disabledReason={
                column.cardIds.length >= LIMITS.cardsPerColumn
                  ? t("limits.maxItems", {
                      limit: LIMITS.cardsPerColumn,
                    })
                  : atWipLimit
                    ? t("column.wipLimitReached", { limit: wipLimit })
                    : undefined
              }
              onSubmit={(title, labelIds) =>
                addCard(column.id, title, labelIds)
              }
            />
          </footer>
        )}
      </section>

      <RenameColumnDialog
        open={renameOpen}
        initialTitle={column.title}
        onOpenChange={setRenameOpen}
        onSave={handleRename}
      />

      <WipLimitDialog
        open={wipLimitOpen}
        columnTitle={column.title}
        initialLimit={wipLimit}
        onOpenChange={setWipLimitOpen}
        onSave={(wipLimit) => setColumnWipLimit(column.id, wipLimit)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("column.deleteTitle")}
        description={tp("column.deleteDescription", column.cardIds.length, {
          title: column.title,
        })}
        confirmLabel={t("column.delete")}
        destructive
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmArchiveCards}
        onOpenChange={setConfirmArchiveCards}
        title={t("column.archiveCardsTitle")}
        description={t("column.archiveCardsDescription", {
          title: column.title,
        })}
        confirmLabel={t("column.archiveCards")}
        onConfirm={() => archiveColumnCards(column.id)}
      />
    </>
  );
}

/**
 * Memoized (TASK-21.4.1). Everything it renders — the insert zones, the
 * column menu, the composer, four always-mounted dialogs — used to re-run
 * on every keystroke anywhere on the board, because the column looked its
 * cards up in the store and the store hands out a new board object each
 * time. It now takes them as props (`useCardList` keeps the array stable)
 * and reads only the actions context, which never changes.
 */
export const ColumnView = memo(ColumnViewBody);
